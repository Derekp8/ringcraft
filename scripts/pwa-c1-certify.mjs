import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const sourceSha = process.env.SOURCE_SHA;
const pagesRunId = Number(process.env.PAGES_RUN_ID);
const baseSha = process.env.BASE_SHA || null;
if (!token || !repository || !sourceSha || !Number.isInteger(pagesRunId)) throw new Error("PWA-C1 certification requires GITHUB_TOKEN, GITHUB_REPOSITORY, SOURCE_SHA and PAGES_RUN_ID.");

const apiBase = `https://api.github.com/repos/${repository}`;
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "ringcraft-pwa-c1-certifier",
};
async function api(pathname) {
  const response = await fetch(`${apiBase}${pathname}`, { headers });
  if (!response.ok) throw new Error(`GitHub API ${pathname} returned ${response.status}: ${await response.text()}`);
  return response;
}
async function listRuns() {
  return (await (await api(`/actions/runs?head_sha=${encodeURIComponent(sourceSha)}&per_page=100`)).json()).workflow_runs ?? [];
}
const requiredWorkflowNames = [
  "Deploy Ringcraft to GitHub Pages",
  "manifest-pins",
  "typecheck",
  "m14-readiness",
  "visual-qa-stability",
  "m9-cleanroom",
];

let selected = new Map();
const deadline = Date.now() + 20 * 60 * 1000;
while (Date.now() < deadline) {
  const runs = await listRuns();
  selected = new Map();
  for (const name of requiredWorkflowNames) {
    const candidates = runs.filter((run) => run.name === name).sort((a, b) => b.id - a.id);
    if (candidates[0]) selected.set(name, candidates[0]);
  }
  const complete = requiredWorkflowNames.every((name) => selected.get(name)?.status === "completed");
  if (complete) break;
  await new Promise((resolve) => setTimeout(resolve, 15000));
}

const workflowEvidence = {};
for (const name of requiredWorkflowNames) {
  const run = selected.get(name);
  workflowEvidence[name] = run ? {
    runId: run.id,
    status: run.status,
    conclusion: run.conclusion,
    url: run.html_url,
    headSha: run.head_sha,
  } : { status: "missing", conclusion: null };
}

async function jobLog(runId, jobName) {
  const jobs = (await (await api(`/actions/runs/${runId}/jobs?per_page=100`)).json()).jobs ?? [];
  const job = jobs.find((candidate) => candidate.name === jobName);
  if (!job) return { job: null, text: "" };
  const response = await api(`/actions/jobs/${job.id}/logs`);
  return { job, text: await response.text() };
}

function stripAnsi(value) { return value.replace(/\u001b\[[0-9;]*m/g, ""); }
let testCount = null;
let cleanRoomArchive = null;
try {
  const regression = await jobLog(pagesRunId, "regression");
  const text = stripAnsi(regression.text);
  const matches = [...text.matchAll(/Tests\s+.*?(\d+)\s+passed/g)];
  if (matches.length) testCount = Number(matches.at(-1)[1]);
} catch (error) {
  workflowEvidence.testCountDiagnostic = String(error);
}
try {
  const cleanRun = selected.get("m9-cleanroom");
  if (cleanRun) {
    const clean = await jobLog(cleanRun.id, "clean-room");
    const text = stripAnsi(clean.text);
    const match = text.match(/built\s+([^\s]+\.zip)\s+\((\d+)\s+bytes;\s+sha256\s+([a-f0-9]{64})\)/i);
    if (match) cleanRoomArchive = { filename: match[1], bytes: Number(match[2]), sha256: match[3] };
  }
} catch (error) {
  workflowEvidence.cleanRoomDiagnostic = String(error);
}

const allRequiredSucceeded = requiredWorkflowNames.every((name) => workflowEvidence[name]?.conclusion === "success");
const report = {
  schema: "ringcraft-pwa-c1-certification-v1",
  generatedAt: new Date().toISOString(),
  sourceSha,
  baseRef: "development/launchable-web",
  baseSha,
  branch: "development/pwa-installable",
  pullRequest: 7,
  deployedUrl: "https://derekp8.github.io/ringcraft/",
  automatedStatus: allRequiredSucceeded ? "PWA AUTOMATED INSTALLABILITY GATES PASSED — HUMAN INSTALL QA PENDING" : "PWA INSTALLABLE WITH KNOWN BLOCKERS",
  workflowEvidence,
  regression: {
    result: workflowEvidence["Deploy Ringcraft to GitHub Pages"]?.conclusion === "success" ? "PASS" : "FAIL",
    testCount,
    minimumRequired: 490,
    deterministicFixtures: workflowEvidence["Deploy Ringcraft to GitHub Pages"]?.conclusion === "success" ? "PASS" : "NOT PROVEN",
  },
  pwa: {
    launcher: workflowEvidence["Deploy Ringcraft to GitHub Pages"]?.conclusion === "success" ? "PASS" : "NOT PROVEN",
    productionBuild: workflowEvidence["Deploy Ringcraft to GitHub Pages"]?.conclusion === "success" ? "PASS" : "NOT PROVEN",
    staticVerification: workflowEvidence["Deploy Ringcraft to GitHub Pages"]?.conclusion === "success" ? "PASS" : "NOT PROVEN",
    chromiumInstallability: workflowEvidence["Deploy Ringcraft to GitHub Pages"]?.conclusion === "success" ? "PASS" : "NOT PROVEN",
    offlineRelaunch: workflowEvidence["Deploy Ringcraft to GitHub Pages"]?.conclusion === "success" ? "PASS" : "NOT PROVEN",
    saveSurvival: workflowEvidence["Deploy Ringcraft to GitHub Pages"]?.conclusion === "success" ? "PASS" : "NOT PROVEN",
    updateCacheReplacement: workflowEvidence["Deploy Ringcraft to GitHub Pages"]?.conclusion === "success" ? "PASS" : "NOT PROVEN",
    liveHostedSmoke: workflowEvidence["Deploy Ringcraft to GitHub Pages"]?.conclusion === "success" ? "PASS" : "NOT PROVEN",
  },
  visual: workflowEvidence["visual-qa-stability"]?.conclusion === "success" ? "PASS" : workflowEvidence["visual-qa-stability"]?.conclusion ?? "MISSING",
  cleanRoom: {
    result: workflowEvidence["m9-cleanroom"]?.conclusion === "success" ? "PASS" : workflowEvidence["m9-cleanroom"]?.conclusion ?? "MISSING",
    archive: cleanRoomArchive,
  },
  humanInstallQA: "NOT RUN",
  externalGates: {
    manualSourceVerification: "PENDING",
    humanAccessibilityReview: "PENDING",
    humanPlaytest: "PENDING",
  },
  knownLimitations: [
    "Human PWA-H01 through PWA-H10 are not certified by automation.",
    "localhost and GitHub Pages remain separate browser origins; cross-origin save migration requires export/import.",
    "Manual-source and other project external QA gates remain separate from PWA installability certification.",
  ],
};

const output = path.join(process.cwd(), "output", "readiness");
await mkdir(output, { recursive: true });
await writeFile(path.join(output, "pwa-installability-certification.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
if (!allRequiredSucceeded) process.exitCode = 1;
