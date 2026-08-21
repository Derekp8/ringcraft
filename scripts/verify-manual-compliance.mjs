import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { resolve } from "node:path";

const registryPath = resolve("docs/manual-compliance/registry.json");
const allowedClassifications = new Set([
  "source-rule",
  "source-table",
  "source-example",
  "source-edge-case",
  "adjudicated-extension",
  "digital-only-extension",
  "unverified-source",
]);
const sourceClassifications = new Set(["source-rule", "source-table", "source-example", "source-edge-case"]);

const registry = JSON.parse(await readFile(registryPath, "utf8"));
const errors = [];
if (registry.schema !== "ringcraft-manual-compliance-v1") errors.push(`Unsupported compliance schema: ${registry.schema ?? "missing"}`);
if (!Array.isArray(registry.records) || registry.records.length === 0) errors.push("Compliance registry must contain at least one record.");

const ids = new Set();
const ensurePath = async (path, label, ruleId) => {
  if (typeof path !== "string" || !path.trim()) {
    errors.push(`${ruleId}: ${label} contains an empty path.`);
    return;
  }
  try {
    await access(resolve(path), fsConstants.R_OK);
  } catch {
    errors.push(`${ruleId}: ${label} path does not exist or is unreadable: ${path}`);
  }
};

for (const record of registry.records ?? []) {
  const id = record.ruleId;
  if (typeof id !== "string" || !id.trim()) {
    errors.push("Record is missing ruleId.");
    continue;
  }
  if (ids.has(id)) errors.push(`Duplicate ruleId: ${id}`);
  ids.add(id);

  if (typeof record.name !== "string" || !record.name.trim()) errors.push(`${id}: missing name.`);
  if (!allowedClassifications.has(record.classification)) errors.push(`${id}: unsupported classification ${record.classification}.`);
  if (typeof record.status !== "string" || !record.status.trim()) errors.push(`${id}: missing status.`);
  for (const flag of ["affectsRng", "affectsLegality", "affectsMatchOutcome", "affectsCampaign"]) {
    if (typeof record[flag] !== "boolean") errors.push(`${id}: ${flag} must be boolean.`);
  }

  if (!Array.isArray(record.implementation) || record.implementation.length === 0) errors.push(`${id}: implementation must list at least one path.`);
  if (!Array.isArray(record.tests) || record.tests.length === 0) errors.push(`${id}: tests must list at least one path.`);
  for (const path of record.implementation ?? []) await ensurePath(path, "implementation", id);
  for (const path of record.tests ?? []) await ensurePath(path, "test", id);

  if (record.classification === "adjudicated-extension" && (typeof record.adjudication !== "string" || !record.adjudication.trim())) {
    errors.push(`${id}: adjudicated-extension requires an adjudication reference.`);
  }

  if (sourceClassifications.has(record.classification) && record.status === "verified") {
    if (!record.source?.document) errors.push(`${id}: verified source record requires source.document.`);
    if (record.source?.page == null && !record.source?.section) errors.push(`${id}: verified source record requires page or section provenance.`);
    if (!record.tests?.length) errors.push(`${id}: verified source record requires automated coverage.`);
  }

  if (record.classification === "unverified-source" && record.status === "verified") {
    errors.push(`${id}: unverified-source cannot claim verified status.`);
  }
}

const counts = Object.fromEntries([...allowedClassifications].map((classification) => [classification, 0]));
for (const record of registry.records ?? []) counts[record.classification] = (counts[record.classification] ?? 0) + 1;

if (errors.length) {
  console.error(`manual-compliance: ${errors.length} failure(s)`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`manual-compliance: ${registry.records.length} record(s) verified structurally`);
console.log(`manual-compliance classifications: ${Object.entries(counts).filter(([, count]) => count).map(([key, count]) => `${key}=${count}`).join(", ")}`);
console.log(`manual-compliance source gate: ${registry.sourceGate?.status ?? "unspecified"}`);
