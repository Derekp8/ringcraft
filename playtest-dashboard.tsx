import reportFixture from "../../fixtures/m11/playtest-balance-report-v1.json";
import type { AiDifficulty, MatchVariety } from "../core";

interface PlaytestBatch { label: string; rosterKey: string; variety: string; difficulty: AiDifficulty; matches: Array<{ seed: number }>; }
interface MatchLengthRow { meanMinutes: number; medianMinutes: number; minMinutes: number; maxMinutes: number; meanTicks: number; drawRate: number; }


/**
 * M11 playtest balance dashboard.
 *
 * Renders the pinned seeded playtest report (fixtures/m11/playtest-balance-
 * report-v1.json, verified by scripts/verify-m11-playtest.ts) as a human-facing
 * balance view: win shares across the AI difficulty ladder and per batch,
 * match-length distributions by variety, and finish-method frequencies. The
 * report hash is shown so a reviewer can tie the on-screen analytics to the
 * pinned fixture identity (c14n-fnv1a64-v1:0cf1a58e2b994c0a).
 */

export interface PlaytestReport {
  schema: string;
  policy: string;
  ruleset: string;
  timeLimitMinutes: number;
  batches: PlaytestBatch[];
  analytics: {
    winShare: { byDifficulty: Partial<Record<AiDifficulty, number>>; byBatch: Record<string, number> };
    matchLength: { byVariety: Record<MatchVariety, MatchLengthRow> };
    finishMethods: { byVariety: Record<MatchVariety, Partial<Record<string, number>>> };
  };
  reportHash: string;
}

export interface LadderRow {
  difficulty: AiDifficulty;
  label: string;
  winShare: number;
}

export interface BatchRow {
  label: string;
  rosterKey: string;
  variety: string;
  difficulty: string;
  winShare: number;
  matches: number;
}

export interface VarietyLengthRow {
  variety: string;
  meanMinutes: number;
  medianMinutes: number;
  minMinutes: number;
  maxMinutes: number;
  drawRate: number;
}

export interface VarietyFinishRow {
  variety: string;
  methods: Array<{ method: string; count: number }>;
}

const VARIETY_LABELS: Record<string, string> = { standard: "Standard", cage: "Steel Cage", ladder: "Ladder" };
const DIFFICULTY_ORDER: AiDifficulty[] = ["novice", "standard", "veteran", "ruthless"];

export function ladderRows(report: PlaytestReport): LadderRow[] {
  return DIFFICULTY_ORDER
    .filter((difficulty) => report.analytics.winShare.byDifficulty[difficulty] !== undefined)
    .map((difficulty) => ({
      difficulty,
      label: difficulty[0].toUpperCase() + difficulty.slice(1),
      winShare: report.analytics.winShare.byDifficulty[difficulty]!,
    }));
}

export function batchRows(report: PlaytestReport): BatchRow[] {
  return report.batches.map((batch) => ({
    label: batch.label,
    rosterKey: batch.rosterKey,
    variety: VARIETY_LABELS[batch.variety] ?? batch.variety,
    difficulty: batch.difficulty,
    winShare: report.analytics.winShare.byBatch[batch.label] ?? 0,
    matches: batch.matches.length,
  }));
}

export function varietyLengthRows(report: PlaytestReport): VarietyLengthRow[] {
  return (Object.keys(report.analytics.matchLength.byVariety) as MatchVariety[]).map((variety) => ({
    variety: VARIETY_LABELS[variety] ?? variety,
    ...report.analytics.matchLength.byVariety[variety],
  }));
}

export function varietyFinishRows(report: PlaytestReport): VarietyFinishRow[] {
  return (Object.keys(report.analytics.finishMethods.byVariety) as MatchVariety[]).map((variety) => ({
    variety: VARIETY_LABELS[variety] ?? variety,
    methods: Object.entries(report.analytics.finishMethods.byVariety[variety] ?? {})
      .map(([method, count]) => ({ method, count: count ?? 0 }))
      .sort((a, b) => b.count - a.count),
  }));
}

function pct(share: number): string {
  return `${Math.round(share * 1000) / 10}%`;
}

function barWidth(share: number): string {
  return `${Math.max(2, Math.min(100, Math.round(share * 100)))}%`;
}

export function PlaytestDashboard() {
  const report = reportFixture as unknown as PlaytestReport;
  const ladder = ladderRows(report);
  const batches = batchRows(report);
  const lengths = varietyLengthRows(report);
  const finishes = varietyFinishRows(report);
  return (
    <section className="playtest-dashboard" aria-labelledby="playtest-dashboard-title">
      <div className="surface-heading">
        <div>
          <div className="prototype-tag">M11 SEEDED PLAYTEST</div>
          <h2 id="playtest-dashboard-title">Balance report</h2>
          <p className="playtest-dashboard__meta">
            {report.schema} - {report.policy} - {report.ruleset} - {report.timeLimitMinutes}-minute limit -{" "}
            {report.batches.reduce((total, batch) => total + batch.matches.length, 0)} seeded matches
          </p>
          <p className="equation">report hash: {report.reportHash}</p>
        </div>
      </div>

      <div className="career-grid">
        <section className="form-card">
          <h3>AI win share by difficulty</h3>
          <p className="playtest-dashboard__note">
            Share of matches the <em>AI</em> wins against the fixed underdog roster. The ladder separates
            novice &lt; standard &lt; veteran &lt; ruthless.
          </p>
          <ul className="playtest-bars" aria-label="AI win share by difficulty">
            {ladder.map((row) => (
              <li key={row.difficulty}>
                <span className="playtest-bars__label">{row.label}</span>
                <span className="playtest-bars__track" aria-hidden="true">
                  <span className="playtest-bars__fill" style={{ width: barWidth(row.winShare) }} />
                </span>
                <strong>{pct(row.winShare)}</strong>
              </li>
            ))}
          </ul>
        </section>

        <section className="form-card">
          <h3>Win share by batch</h3>
          <table className="playtest-table">
            <thead>
              <tr>
                <th scope="col">Batch</th>
                <th scope="col">Roster</th>
                <th scope="col">Variety</th>
                <th scope="col">Difficulty</th>
                <th scope="col">Matches</th>
                <th scope="col">AI win share</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((row) => (
                <tr key={row.label}>
                  <td><code>{row.label}</code></td>
                  <td>{row.rosterKey}</td>
                  <td>{row.variety}</td>
                  <td>{row.difficulty}</td>
                  <td>{row.matches}</td>
                  <td>{pct(row.winShare)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="form-card">
          <h3>Match length by variety</h3>
          <table className="playtest-table">
            <thead>
              <tr>
                <th scope="col">Variety</th>
                <th scope="col">Mean min</th>
                <th scope="col">Median min</th>
                <th scope="col">Range</th>
                <th scope="col">Draw rate</th>
              </tr>
            </thead>
            <tbody>
              {lengths.map((row) => (
                <tr key={row.variety}>
                  <td>{row.variety}</td>
                  <td>{row.meanMinutes.toFixed(2)}</td>
                  <td>{row.medianMinutes}</td>
                  <td>{row.minMinutes}-{row.maxMinutes}</td>
                  <td>{pct(row.drawRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="form-card">
          <h3>Finish methods by variety</h3>
          {finishes.map((row) => (
            <div key={row.variety} className="playtest-finishes">
              <strong>{row.variety}</strong>
              <ol className="playtest-finishes__list">
                {row.methods.map((method) => (
                  <li key={method.method}>
                    <span>{method.method}</span>
                    <em>{method.count}</em>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </section>
      </div>
    </section>
  );
}
