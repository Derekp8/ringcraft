import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BlockedReason,
  CareerDossier,
  FinanceSummary,
  MonthEndSummary,
  NegotiationSummary,
  OnboardingStep,
  PostMatchReport,
} from "./campaign-presentation";
import { onboardingContent } from "./campaign-presentation";
import type { CampaignEntrantId, CampaignState } from "../core";

export const RINGCRAFT_TUTORIAL_STORAGE_KEY = "asw91-project-ringcraft-tutorial-v1";
export const RINGCRAFT_MONTH_NOTE_STORAGE_KEY = "asw91-project-ringcraft-monthnote-v1";

export function downloadTextFile(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function useDialogBehavior(active: boolean) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = containerRef.current;
    if (!active || !node) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute("disabled"));
    const items = focusables();
    items[0]?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const current = focusables();
      if (!current.length) {
        event.preventDefault();
        return;
      }
      const first = current[0];
      const last = current[current.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    node.addEventListener("keydown", handleKeyDown);
    return () => {
      node.removeEventListener("keydown", handleKeyDown);
      previous?.focus?.();
    };
  }, [active]);
  return containerRef;
}

export function TutorialOverlay({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const steps = onboardingContent();
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(RINGCRAFT_TUTORIAL_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const visible = !dismissed || open;
  const containerRef = useDialogBehavior(visible);
  const step = steps[index];
  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(RINGCRAFT_TUTORIAL_STORAGE_KEY, "1");
    } catch {
      // Browser storage is best effort; the tour simply reopens next visit.
    }
    setDismissed(true);
    onOpenChange(false);
  }, [onOpenChange]);
  if (!visible) return null;
  return (
    <div
      ref={containerRef}
      className="tour-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
      onKeyDown={(event) => {
        if (event.key === "Escape") dismiss();
      }}
    >
      <div className="tour-shell">
        <div className="tour-progress" aria-label={`Step ${index + 1} of ${steps.length}`}>
          {steps.map((item, itemIndex) => (
            <span key={item.id} className={itemIndex === index ? "tour-progress__dot tour-progress__dot--active" : "tour-progress__dot"} />
          ))}
        </div>
        <div className="tour-step">
          <div className="decision__kicker">{step.kicker}</div>
          <h2 id="tour-title">{step.title}</h2>
          <ul>
            {step.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </div>
        <div className="tour-nav">
          <button
            className="button--quiet"
            onClick={dismiss}
            aria-label="Skip the tour and remember that choice"
          >
            Skip tour
          </button>
          <div className="tour-nav__pages">
            <button
              className="button--quiet"
              onClick={() => setIndex(Math.max(0, index - 1))}
              disabled={index === 0}
            >
              Back
            </button>
            {index < steps.length - 1 ? (
              <button onClick={() => setIndex(index + 1)}>Next</button>
            ) : (
              <button onClick={dismiss}>Done</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function PostMatchReport({ report }: { report: PostMatchReport }) {
  return (
    <section className="report-card" aria-label="Post-match report" aria-live="polite">
      <div className="report-card__heading">
        <div>
          <div className="decision__kicker">OFFICIAL RESULT</div>
          <h3>{report.summary}</h3>
        </div>
        <span className="status-pill status-pill--ok">REPLAY {report.matchHash.slice(-8)}</span>
      </div>
      <p className="report-card__meta">
        {report.date} - {report.mode} - {report.method}
        {report.playerInvolved ? ` - player ${report.playerOutcome ?? "n/a"}` : ""}
        {report.opponentLabel ? ` vs ${report.opponentLabel}` : ""}
      </p>
      <dl className="report-card__rows">
        {report.titleImpact && (
          <div>
            <dt>Title impact</dt>
            <dd>{report.titleImpact}</dd>
          </div>
        )}
        {report.playerInvolved && report.rankingNotes && (
          <div>
            <dt>Ranking</dt>
            <dd>{report.rankingNotes}</dd>
          </div>
        )}
        <div>
          <dt>WP awarded</dt>
          <dd>{report.wpAwarded}</dd>
        </div>
        {report.injuries.length > 0 && (
          <div>
            <dt>Injuries</dt>
            <dd>{report.injuries.join("; ")}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

export function MonthEndBanner({ summary }: { summary: MonthEndSummary }) {
  const [lastSeen, setLastSeen] = useState(() => {
    try {
      return localStorage.getItem(RINGCRAFT_MONTH_NOTE_STORAGE_KEY) ?? "";
    } catch {
      return "";
    }
  });
  if (!summary || summary.month === lastSeen) return null;
  const movement =
    summary.playerMovement === null
      ? null
      : summary.playerMovement === 0
        ? "holding rank"
        : summary.playerMovement < 0
          ? `up ${-summary.playerMovement}`
          : `down ${summary.playerMovement}`;
  function acknowledge() {
    setLastSeen(summary.month);
    try {
      localStorage.setItem(RINGCRAFT_MONTH_NOTE_STORAGE_KEY, summary.month);
    } catch {
      // Best effort.
    }
  }
  return (
    <section className="month-banner" aria-label="Month-end report" aria-live="polite">
      <div className="month-banner__heading">
        <div>
          <div className="decision__kicker">MONTH-END REPORT {summary.month}</div>
          {summary.playerRank !== null ? (
            <h3>
              You are ranked <strong>#{summary.playerRank}</strong> {movement ? `(${movement})` : ""}
            </h3>
          ) : (
            <h3>Month-end finalized</h3>
          )}
        </div>
        <button className="button--quiet" onClick={acknowledge} aria-label={`Dismiss the ${summary.month} month-end report`}>
          Dismiss
        </button>
      </div>
      {summary.headline.length > 0 && (
        <ul className="month-banner__list">
          {summary.headline.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {summary.injuries.length > 0 && (
        <p className="month-banner__note">Injuries this month: {summary.injuries.join("; ")}</p>
      )}
      {(summary.rosterLayoffs.length > 0 || summary.rosterRecoveries.length > 0) && (
        <p className="month-banner__note">
          Roster layoffs: {summary.rosterLayoffs.join("; ") || "none"} · Recoveries: {summary.rosterRecoveries.join("; ") || "none"}
        </p>
      )}
      {summary.financeLine && <p className="month-banner__note">{summary.financeLine}</p>}
      {summary.autosaveLine && <p className="month-banner__note">{summary.autosaveLine}</p>}
      {summary.bookingLine && <p className="month-banner__note">{summary.bookingLine}</p>}
      {summary.headline.length === 0 && summary.injuries.length === 0 && summary.rosterLayoffs.length === 0 && summary.rosterRecoveries.length === 0 && !summary.financeLine && !summary.autosaveLine && !summary.bookingLine && (
        <p className="month-banner__note">No federation title or injury events were recorded this month.</p>
      )}
    </section>
  );
}

export function FinancePanel({ summary }: { summary: FinanceSummary }) {
  if (!summary.enabled) {
    return (
      <section className="form-card" aria-labelledby="finance-title">
        <h3 id="finance-title">Contracts and payouts</h3>
        <p className="form-card__note">The M12 contracts-and-finance extension is off for this career. Enable it at setup to track weekly salaries, ledgers, and popularity.</p>
      </section>
    );
  }
  return (
    <section className="form-card" aria-labelledby="finance-title">
      <h3 id="finance-title">Contracts and payouts</h3>
      <p className="form-card__note">Next payout: <strong>{summary.nextPayoutDate ?? "—"}</strong> · Ledger total <strong>${summary.ledgerTotal}</strong></p>
      <h4>Contracts</h4>
      <ol className="career-list">
        {summary.contracts.map((contract) => (
          <li key={contract.wrestlerId}>
            <strong>{contract.name}{contract.active ? "" : " (expired)"}</strong>
            <span>${contract.weeklySalary}/week · {contract.termWeeks}wk term · paid ${contract.ledger}{contract.signingBonus > 0 ? ` (incl. $${contract.signingBonus} bonus)` : ""}</span>
            <em>Popularity {contract.popularity}</em>
          </li>
        ))}
      </ol>
      <h4>Recent payouts</h4>
      {summary.payouts.length ? (
        <ol className="career-list">
          {summary.payouts.map((payout) => (
            <li key={`${payout.date}-${payout.weekIndex}`}>
              <strong>{payout.date}{payout.weekIndex === 0 ? " (signing)" : ` (week ${payout.weekIndex})`}</strong>
              <span>{payout.entries.map((entry) => `${entry.name} $${entry.amount}`).join(", ")}</span>
              <em>Total ${payout.total}</em>
            </li>
          ))}
        </ol>
      ) : (
        <p>No payouts yet — the first weekly payout lands on {summary.nextPayoutDate ?? "the next payout date"}.</p>
      )}
      <h4>Popularity movement</h4>
      {summary.popularityHistory.length ? (
        <ol className="career-list">
          {summary.popularityHistory.map((row, index) => (
            <li key={`${row.date}-${row.wrestlerId}-${index}`}>
              <strong>{row.date} · {row.name}</strong>
              <span>{row.from} → {row.to} ({row.delta >= 0 ? "+" : ""}{row.delta})</span>
              <em>{row.reason}</em>
            </li>
          ))}
        </ol>
      ) : (
        <p>No popularity movement yet — official match results move it.</p>
      )}
    </section>
  );
}

export function NegotiationPanel({
  summary,
  onOfferContract,
}: {
  summary: NegotiationSummary;
  onOfferContract: (wrestlerId: string, request: { weeklySalary: number; termWeeks: number; signingBonus?: number }) => void;
}) {
  const [target, setTarget] = useState("");
  const [salary, setSalary] = useState("400");
  const [term, setTerm] = useState("26");
  const [bonus, setBonus] = useState("0");
  if (!summary.enabled) {
    return (
      <section className="form-card" aria-labelledby="negotiation-title">
        <h3 id="negotiation-title">Contract negotiation</h3>
        <p className="form-card__note">The M12 contract-negotiation extension is off for this career. Enable finance and negotiation at setup to offer contracts, renew expiring deals, and see each wrestler's expected salary.</p>
      </section>
    );
  }
  const selected = summary.freeAgents.find((row) => row.wrestlerId === target);
  function submitOffer() {
    if (!target) return;
    onOfferContract(target, { weeklySalary: Number(salary) || 0, termWeeks: Number(term) || 1, signingBonus: Math.max(0, Number(bonus) || 0) });
    setTarget("");
    setSalary("400");
    setTerm("26");
    setBonus("0");
  }
  return (
    <section className="form-card" aria-labelledby="negotiation-title">
      <h3 id="negotiation-title">Contract negotiation</h3>
      <p className="form-card__note">{summary.renewalStrategy === "curve-fair" ? <>Renewal strategy: <strong className="renewal-strategy renewal-strategy--curve-fair">curve-fair</strong> — expiring deals that outgrew the salary curve are preemptively renewed at the curve rate (M12-ADJ-09).</> : <>Renewal strategy: <strong className="renewal-strategy">expiring salary</strong> — expiring deals renew at their current rate; wrestlers who outgrew their deal may walk.</>}</p>
      <h4>Contracts and expiring deals</h4>
      {summary.contracts.length ? (
        <ol className="career-list">
          {summary.contracts.map((contract) => (
            <li key={contract.wrestlerId}>
              <strong>
                {contract.name}
                <span className={`status-pill ${contract.active ? "status-pill--ok" : "status-pill--blocked"}`}>{contract.active ? "active" : "expired"}</span>
                {contract.expiringSoon && contract.active ? <span className="status-pill status-pill--cooling">expiring soon</span> : null}
              </strong>
              <span>${contract.weeklySalary}/week · {contract.termWeeks}wk term · expires {contract.expiryDate}</span>
              <em>Popularity {contract.popularity} · expects ${contract.expectedSalary}/week{contract.active ? "" : " — renewal evaluated on the next advance"}</em>
            </li>
          ))}
        </ol>
      ) : (
        <p>No contracts yet — offer one below to put a wrestler on the books.</p>
      )}
      <h4>Offer a contract</h4>
      {summary.freeAgents.length ? (
        <>
          <div className="inline-fields">
            <label>Wrestler<select aria-label="Negotiation target" value={target} onChange={(event) => setTarget(event.target.value)}><option value="">Select…</option>{summary.freeAgents.map((row) => <option key={row.wrestlerId} value={row.wrestlerId}>{row.name}{row.outstandingOffer ? " (offer pending)" : ""}</option>)}</select></label>
            <label>Weekly salary<input aria-label="Offer weekly salary" type="number" min={1} value={salary} onChange={(event) => setSalary(event.target.value)} /></label>
            <label>Term (weeks)<input aria-label="Offer term weeks" type="number" min={1} value={term} onChange={(event) => setTerm(event.target.value)} /></label>
            <label>Signing bonus<input aria-label="Offer signing bonus" type="number" min={0} value={bonus} onChange={(event) => setBonus(event.target.value)} /></label>
          </div>
          {selected ? (
            <p className="form-card__note">{selected.name}: popularity {selected.popularity} expects <strong>${selected.expectedSalary}/week</strong>. Offer at or above 100% of the expectation to sign immediately; under 60% is rejected; in between rolls a recorded D20.</p>
          ) : null}
          <div className="button-row"><button onClick={submitOffer} disabled={!target}>Offer contract</button></div>
        </>
      ) : (
        <p>Every wrestler is under contract — renewals are evaluated as deals expire.</p>
      )}
      <h4>Expected salaries</h4>
      <ol className="career-list">
        {summary.freeAgents.map((row) => (
          <li key={row.wrestlerId}>
            <strong>{row.name}</strong>
            <span>Free agent · popularity {row.popularity}</span>
            <em>Expected ${row.expectedSalary}/week (salary curve)</em>
          </li>
        ))}
      </ol>
      <h4>Recent negotiation</h4>
      {summary.history.length ? (
        <ol className="career-list">
          {summary.history.map((row) => (
            <li key={`${row.date}-${row.wrestlerId}-${row.basis}`}>
              <strong>{row.date} · {row.name} <span className={`status-pill ${row.type === "accepted" ? "status-pill--ok" : "status-pill--blocked"}`}>{row.type}</span></strong>
              <span>${row.weeklySalary}/week vs ${row.expectedSalary} expectation</span>
              <em>{row.basis}</em>
            </li>
          ))}
        </ol>
      ) : (
        <p>No offers yet — the accept/reject basis for every offer lands here deterministically.</p>
      )}
    </section>
  );
}

export function DossierPanel({ dossier }: { dossier: CareerDossier }) {
  return (
    <section className="form-card form-card--wide dossier-panel" aria-labelledby="dossier-title">
      <h3 id="dossier-title">Career dossier</h3>
      <div className="dossier-grid">
        <div>
          <small>Record</small>
          <strong>
            {dossier.record.wins}W - {dossier.record.draws}D - {dossier.record.losses}L
          </strong>
          <em>{dossier.record.matches} player matches</em>
        </div>
        <div>
          <small>Titles</small>
          <strong>
            {dossier.titles.won} won · {dossier.titles.retained} retained · {dossier.titles.lost} lost
          </strong>
          <em>{dossier.titles.current.length ? dossier.titles.current.join(", ") : "none held now"}</em>
        </div>
        <div>
          <small>WP</small>
          <strong>
            +{dossier.wp.awarded} earned / -{dossier.wp.spent} spent
          </strong>
          <em>{dossier.wp.balance} available</em>
        </div>
        <div>
          <small>Injuries</small>
          <strong>
            {dossier.injuries.count} layoffs · {dossier.injuries.weeks} weeks
          </strong>
          <em>{dossier.injuries.active} active now</em>
        </div>
        <div>
          <small>Title shots</small>
          <strong>
            {dossier.titleShots.accepted} accepted / {dossier.titleShots.declined} declined
          </strong>
          <em>{dossier.vacancyWins} vacancy won</em>
        </div>
      </div>
      <div className="button-row">
        <button className="button--quiet" onClick={() => downloadTextFile(`${dossier.campaignId}-dossier.json`, dossier.toJson())}>
          Export dossier JSON
        </button>
        <button className="button--quiet" onClick={() => downloadTextFile(`${dossier.campaignId}-dossier.csv`, dossier.toCsv())}>
          Export dossier CSV
        </button>
      </div>
    </section>
  );
}

function feudEntrantLabel(campaign: CampaignState, id: string): string {
  return campaign.roster[id]?.name ?? campaign.teams[id]?.name ?? id;
}

/**
 * M13 feud-and-title-booking panel: rivalries with heat/status, the dated heat
 * history, the latest month-end booking card, and a Start-feud control. The
 * control drives the core `startFeud` transaction (no dice); every value shown
 * derives from campaign state, so the panel is deterministic and replay-safe.
 * A tag-team mode toggle (defaulting to the player's division) lets a tag
 * career player start team feuds from the dashboard; the mode keeps both
 * rivals in the same entrant kind so no mixed wrestler-vs-team feud (which
 * month-end booking cannot resolve) can be created from the panel.
 */
export function FeudBookingPanel({
  campaign,
  onStartFeud,
}: {
  campaign: CampaignState;
  onStartFeud: (a: CampaignEntrantId, b: CampaignEntrantId, label: string, initialHeat: number) => void;
}) {
  const [feudA, setFeudA] = useState("");
  const [feudB, setFeudB] = useState("");
  const [feudLabel, setFeudLabel] = useState("");
  const [feudHeat, setFeudHeat] = useState("50");
  const [feudMode, setFeudMode] = useState<"singles" | "tag">(() => (campaign.playerDivision === "tag" ? "tag" : "singles"));
  if (!campaign.booking) {
    return (
      <section className="form-card" aria-labelledby="feud-title">
        <h3 id="feud-title">Feuds and booking</h3>
        <p className="form-card__note">The M13 feud-and-title-booking extension is off for this career. Enable bookingPolicy "feuds" at setup to track rivalries, feud heat, and month-end booking suggestions.</p>
      </section>
    );
  }
  const booking = campaign.booking;
  const singlesEntrants: Array<{ id: CampaignEntrantId; label: string }> = Object.keys(campaign.roster).map((id) => ({ id, label: campaign.roster[id].name }));
  const tagEntrants: Array<{ id: CampaignEntrantId; label: string }> = Object.values(campaign.teams).filter((team) => team.active).map((team) => ({ id: team.id, label: `${team.name} (tag team)` }));
  const entrants = feudMode === "tag" ? tagEntrants : singlesEntrants;
  function switchFeudMode(mode: "singles" | "tag") {
    setFeudMode(mode);
    setFeudA("");
    setFeudB("");
  }
  const latestCard = booking.monthSuggestions.at(-1);
  const heatHistory = [...booking.feudHistory].reverse().slice(0, 10);
  function submitFeud() {
    if (!feudA || !feudB || feudA === feudB) return;
    onStartFeud(feudA, feudB, feudLabel.trim(), Number(feudHeat) || 50);
    setFeudLabel("");
  }
  return (
    <section className="form-card" aria-labelledby="feud-title">
      <h3 id="feud-title">Feuds and booking</h3>
      <h4>Rivalries</h4>
      {booking.feuds.length ? (
        <ol className="career-list">
          {booking.feuds.map((feud) => (
            <li key={feud.id}>
              <strong>
                {feud.label}
                <span className={`status-pill ${feud.status === "active" ? "status-pill--active" : "status-pill--cooling"}`}>{feud.status}</span>
              </strong>
              <span>{feud.entrantIds.map((id) => feudEntrantLabel(campaign, id)).join(" vs ")}</span>
              <em>Heat {feud.heat} · {feud.matchCount} feud match{feud.matchCount === 1 ? "" : "es"} · last {feud.lastMatchDate ?? "none"}</em>
            </li>
          ))}
        </ol>
      ) : (
        <p>No rivalries yet — start one below. A feud's heat moves only by the official results of the rivals' own matches.</p>
      )}
      <h4>Heat history</h4>
      {heatHistory.length ? (
        <ol className="career-list">
          {heatHistory.map((row, index) => (
            <li key={`${row.date}-${row.feudId}-${index}`}>
              <strong>{row.date} · {booking.feuds.find((feud) => feud.id === row.feudId)?.label ?? row.feudId}</strong>
              <span>Heat {row.from} → {row.to} ({row.delta >= 0 ? "+" : ""}{row.delta})</span>
              <em>{row.reason}</em>
            </li>
          ))}
        </ol>
      ) : (
        <p>No feud heat movement yet — heat moves when rivals face each other and cools at month end without a match.</p>
      )}
      <h4>Month-end booking card</h4>
      {latestCard ? (
        <div className="offer-card">
          <strong>Booking card for {latestCard.month}</strong>
          {latestCard.items.length ? (
            <ol className="career-list">
              {latestCard.items.map((item) => (
                <li key={`${item.priority}-${item.kind}`}>
                  <strong>{item.priority}. {item.kind === "required-defense" ? "Required title defense" : item.kind === "feud" ? "Feud (the draw)" : "Optional"}</strong>
                  <span>vs {feudEntrantLabel(campaign, item.opponentId)}{item.titleId ? ` · ${campaign.titles[item.titleId].name}` : ""}</span>
                  <em>{item.basis}</em>
                </li>
              ))}
            </ol>
          ) : (
            <p>No suggestions this month.</p>
          )}
        </div>
      ) : (
        <p>No month-end booking card yet — advance to the next month-end finalization to generate one.</p>
      )}
      <h4>Start a feud</h4>
      <div className="inline-fields">
        <label>Rival type<select aria-label="Feud entrant type" value={feudMode} onChange={(event) => switchFeudMode(event.target.value as "singles" | "tag")}><option value="singles">Singles wrestlers</option><option value="tag">Tag teams</option></select></label>
        <label>Rival one<select aria-label="Feud entrant one" value={feudA} onChange={(event) => setFeudA(event.target.value)}><option value="">Select…</option>{entrants.map((entrant) => <option key={entrant.id} value={entrant.id}>{entrant.label}</option>)}</select></label>
        <label>Rival two<select aria-label="Feud entrant two" value={feudB} onChange={(event) => setFeudB(event.target.value)}><option value="">Select…</option>{entrants.filter((entrant) => entrant.id !== feudA).map((entrant) => <option key={entrant.id} value={entrant.id}>{entrant.label}</option>)}</select></label>
        <label>Label<input aria-label="Feud label" value={feudLabel} onChange={(event) => setFeudLabel(event.target.value)} placeholder="red-hot grudge" /></label>
        <label>Starting heat<input aria-label="Feud starting heat" type="number" min={0} max={100} value={feudHeat} onChange={(event) => setFeudHeat(event.target.value)} /></label>
      </div>
      <div className="button-row"><button onClick={submitFeud} disabled={!feudA || !feudB || feudA === feudB}>Start feud</button></div>
      <p className="form-card__note">Feuds are advisory rivalry state: heat moves deterministically by official results (no dice), cold feuds cool at month end, and the hottest active feud rival tops the month-end booking card. The rival type toggle keeps both rivals in the same division (singles or tag).</p>
    </section>
  );
}

export function BlockedGuidance({ reasons }: { reasons: BlockedReason[] }) {
  return (
    <section className="form-card form-card--wide blocked-guidance" aria-labelledby="blocked-title">
      <h3 id="blocked-title">Why is an action blocked?</h3>
      <div className="blocked-list">
        {reasons.map((reason) => (
          <div key={reason.action} className={`blocked-row ${reason.blocked ? "blocked-row--blocked" : "blocked-row--open"}`}>
            <span className="status-pill status-pill--blocked" aria-hidden="true">
              {reason.blocked ? "BLOCKED" : "OPEN"}
            </span>
            <strong>{reason.label}</strong>
            {reason.blocked ? (
              <ul>
                {reason.reasons.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : (
              <span className="blocked-row__hint open">{reason.hint}</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}