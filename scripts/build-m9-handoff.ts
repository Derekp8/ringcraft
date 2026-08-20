import { createHash } from "node:crypto";
import { lstat, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  M9_ARCHIVE_NAME,
  M9_EXCLUDED_PREFIXES,
  M9_REQUIRED_FILES,
  M9_REQUIRED_ROOTS,
  M9_REVIEWED_SCREENSHOTS,
  isAllowedM9Path,
  normalizeM9Path,
} from "./m9-packaging-contracts";

const projectRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const outputDirectory = join(projectRoot, "output", "m9");
const archivePath = join(outputDirectory, M9_ARCHIVE_NAME);

function crc32(data: Buffer): number {
  let value = 0xffffffff;
  for (const byte of data) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function zipEntry(name: string, data: Buffer, offset: number): { local: Buffer; central: Buffer } {
  const filename = Buffer.from(name, "utf8");
  const checksum = crc32(data);
  const local = Buffer.alloc(30 + filename.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt16LE(0, 10);
  local.writeUInt16LE(33, 12);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(filename.length, 26);
  filename.copy(local, 30);

  const central = Buffer.alloc(46 + filename.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(33, 14);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(filename.length, 28);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(offset, 42);
  filename.copy(central, 46);
  return { local: Buffer.concat([local, data]), central };
}

async function filesUnder(relativeRoot: string): Promise<string[]> {
  const absoluteRoot = join(projectRoot, relativeRoot);
  const entries = await readdir(absoluteRoot, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const child = join(relativeRoot, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`M9 handoff rejects symbolic link: ${child}`);
    if (entry.isDirectory()) files.push(...await filesUnder(child));
    else if (entry.isFile()) files.push(normalizeM9Path(child));
  }
  return files;
}

async function assertRequiredFiles(): Promise<void> {
  for (const path of [...M9_REQUIRED_FILES, ...M9_REQUIRED_ROOTS, ...M9_REVIEWED_SCREENSHOTS]) {
    const absolute = join(projectRoot, path);
    try {
      const entry = await lstat(absolute);
      if (entry.isSymbolicLink()) throw new Error(`M9 handoff rejects symbolic link: ${path}`);
    } catch (error) {
      if (error instanceof Error && error.message.includes("symbolic link")) throw error;
      throw new Error(`M9 handoff is missing required path: ${path}`);
    }
  }
}

async function buildZip(staging: string, files: string[]): Promise<Buffer> {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const name of files) {
    const entry = zipEntry(name, await readFile(join(staging, name)), offset);
    locals.push(entry.local);
    centrals.push(entry.central);
    offset += entry.local.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDirectory, end]);
}

await assertRequiredFiles();
const discoveredFiles: string[] = [];
for (const root of M9_REQUIRED_ROOTS) discoveredFiles.push(...await filesUnder(root));
const files = [...M9_REQUIRED_FILES, ...discoveredFiles, ...M9_REVIEWED_SCREENSHOTS]
  .map(normalizeM9Path)
  .filter((path, index, all) => all.indexOf(path) === index)
  .sort();
const invalid = files.filter((path) => !isAllowedM9Path(path));
if (invalid.length) throw new Error(`M9 allowlist rejected paths:\n${invalid.join("\n")}`);
if (files.some((path) => M9_EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix)))) throw new Error("M9 archive includes an excluded path.");

await mkdir(outputDirectory, { recursive: true });
const staging = await mkdtemp(join(tmpdir(), "ringcraft-m9-stage-"));
try {
  for (const path of files) {
    const destination = join(staging, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, await readFile(join(projectRoot, path)));
  }
  const archive = await buildZip(staging, files);
  await writeFile(archivePath, archive);
  const evidence = {
    archiveName: M9_ARCHIVE_NAME,
    archivePath: relative(projectRoot, archivePath).replaceAll("\\", "/"),
    bytes: archive.length,
    sha256: createHash("sha256").update(archive).digest("hex"),
    files,
    excludedPrefixes: [...M9_EXCLUDED_PREFIXES],
    generatedAt: new Date().toISOString(),
  };
  await writeFile(join(outputDirectory, "m9-build.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await rm(staging, { recursive: true, force: true });
}
