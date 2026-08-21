import { readFileSync, writeFileSync } from "node:fs";

const path = "scripts/visual-qa.mjs";
let source = readFileSync(path, "utf8").replace(/\r\n/g, "\n");

function replaceOnce(label, before, after) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one target, found ${count}.`);
  source = source.replace(before, after);
}

replaceOnce(
  "canonical replay badge",
  'if (!(await page.locator("footer .verified", { hasText: "REPLAY VERIFIED" }).count())) errors.push("m10-difficulty-exhibition: replay verification badge missing on the completed match");',
  'if (!(await page.locator("footer .verified", { hasText: "Canonical replay state verified" }).count())) errors.push("m10-difficulty-exhibition: canonical replay verification badge missing on the completed match");',
);

replaceOnce(
  "validated merge bundle setup",
  `// Merged-row diff hint: import a bundle whose entry collides with the existing save
// but carries a newer snapshot (future updatedAt, advanced date and record); the
// preview must flag it merged and show the stored-vs-incoming diff hint before Apply.
const mergeBundle = JSON.parse(readFileSync(bundlePath, "utf8"));
const mergedEntry = mergeBundle.saves[0];
const mergedValue = JSON.parse(mergedEntry.value);
mergedValue.updatedAt = "2099-01-01T00:00:00.000Z";
mergedValue.preview = { ...mergedValue.preview, currentDate: "1991-03-01", wins: mergedValue.preview.wins + 1 };
mergedEntry.value = JSON.stringify(mergedValue);`,
  `// Merged-row diff hint: import a bundle whose entry collides with the existing save
// but carries a genuinely newer Campaign snapshot. The hardened importer derives
// preview metadata from campaignJson, so this visual journey advances the actual
// Campaign through the core transaction instead of forging preview fields.
const mergeBundle = JSON.parse(readFileSync(bundlePath, "utf8"));
const mergedEntry = mergeBundle.saves[0];
const mergedValue = JSON.parse(mergedEntry.value);
const { advanceCampaignDays: advanceBundleCampaign, serializeCampaign: serializeBundleCampaign } = await server.ssrLoadModule("/src/core/index.ts");
const advancedBundleCampaign = advanceBundleCampaign(JSON.parse(mergedValue.campaignJson), 59);
mergedValue.updatedAt = "2099-01-01T00:00:00.000Z";
mergedValue.campaignJson = serializeBundleCampaign(advancedBundleCampaign);
mergedEntry.value = JSON.stringify(mergedValue);`,
);

replaceOnce(
  "remove forged record visual assertion",
  'if (!(await page.locator(".import-diff", { hasText: /Record: .* -> .*W\\// }).count())) errors.push("save-bundle: diff hint missing the record change");\n',
  '',
);

writeFileSync(path, source);
console.log("PWA-C1 visual QA now checks canonical replay wording and validated Campaign-derived merge previews.");
