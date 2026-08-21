import { readFileSync, writeFileSync } from "node:fs";

for (const file of ["tests/save-manager.test.ts", "tests/mock-save-sync-server.test.ts"]) {
  const source = readFileSync(file, "utf8");
  writeFileSync(file, source.replace(/\r\n/g, "\n"));
}

await import("./reconcile-pwa-regression-baseline.mjs");
