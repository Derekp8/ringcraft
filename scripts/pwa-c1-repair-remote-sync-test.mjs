import { readFileSync, writeFileSync } from "node:fs";

const path = "tests/mock-save-sync-server.test.ts";
let source = readFileSync(path, "utf8").replace(/\r\n/g, "\n");

function replaceOnce(label, before, after) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one target, found ${count}.`);
  source = source.replace(before, after);
}

replaceOnce(
  "bundleWithOneSave",
  '    saves: [{ key: "asw91-campaign-save-demo", value: "{\\"saveId\\":\\"demo\\",\\"campaignId\\":\\"campaign-demo\\"}" }],',
  '    saves: [{ key: "asw91-campaign-save-demo", value: savePayload("demo", "Demo", "campaign-demo", "2099-01-01T00:00:00.000Z", "{\\"demo\\":1}") }],',
);

const legacyDemoLine = source.split("\n").find((line) => line.includes('storage.setItem("asw91-campaign-save-demo", JSON.stringify({ saveId: "demo"'));
if (!legacyDemoLine) throw new Error("full-sync lifecycle: legacy fake demo payload line not found.");
replaceOnce(
  "full-sync lifecycle demo",
  legacyDemoLine,
  '    storage.setItem("asw91-campaign-save-demo", savePayload("demo", "Demo", "campaign-demo", "2099-01-01T00:00:00.000Z", "{\\"demo\\":1}"));',
);

replaceOnce(
  "full-sync lifecycle second save",
  '    storage.setItem("asw91-campaign-save-second", storage.getItem("asw91-campaign-save-demo")!);',
  '    storage.setItem("asw91-campaign-save-second", savePayload("second", "Second", "campaign-second", "2099-01-01T00:00:00.000Z", "{\\"second\\":1}"));',
);

replaceOnce(
  "alpha local save id",
  '    const alphaT1 = savePayload("alpha-v1", "Alpha", "campaign-alpha", t1, "{\\"alpha\\":1}");',
  '    const alphaT1 = savePayload("alpha", "Alpha", "campaign-alpha", t1, "{\\"alpha\\":1}");',
);

replaceOnce(
  "alpha remote save id",
  '    const alphaRemote = savePayload("alpha-v2", "Alpha (device)", "campaign-alpha", t2, "{\\"alpha\\":2}");',
  '    const alphaRemote = savePayload("alpha-remote", "Alpha (device)", "campaign-alpha", t2, "{\\"alpha\\":2}");',
);

replaceOnce(
  "beta save id",
  '    const beta = savePayload("beta-v1", "Beta", "campaign-beta", t1, "{\\"beta\\":1}");',
  '    const beta = savePayload("beta", "Beta", "campaign-beta", t1, "{\\"beta\\":1}");',
);

replaceOnce(
  "gamma save id",
  '    const gamma = savePayload("gamma-v1", "Gamma", "campaign-gamma", t1, "{\\"gamma\\":1}");',
  '    const gamma = savePayload("gamma", "Gamma", "campaign-gamma", t1, "{\\"gamma\\":1}");',
);

writeFileSync(path, source);
console.log("PWA-C1 remote-sync test fixtures now use canonical key/saveId pairs and valid Campaign-backed payloads.");
