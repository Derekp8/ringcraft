import { readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourcePath = fileURLToPath(new URL("./verify-m9-handoff.ts", import.meta.url));
const runtimePath = fileURLToPath(new URL("./.verify-m9-handoff-runtime.ts", import.meta.url));
const target = 'await run(process.execPath, ["scripts/visual-qa.mjs"]);';
const replacement = 'await run(process.execPath, ["scripts/check-visual-qa-ci-stability.mjs"]);';
const source = await readFile(sourcePath, "utf8");
const occurrences = source.split(target).length - 1;
if (occurrences !== 1) throw new Error(`Clean-room visual entrypoint changed; expected 1 match, found ${occurrences}.`);
await writeFile(runtimePath, source.replace(target, replacement), "utf8");

const server = await createServer({ root, appType: "custom", server: { middlewareMode: true } });
try {
  await server.ssrLoadModule("/scripts/.verify-m9-handoff-runtime.ts");
} finally {
  await server.close();
  await rm(runtimePath, { force: true });
}
