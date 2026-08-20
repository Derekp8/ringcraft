import { useState } from "react";
import type { CampaignState } from "../core";
import type { CareerDossier } from "./campaign-presentation";
import {
  PLAYTEST_FRICTION_TAGS,
  buildPlaytestReport,
  normalizePlaytestNotes,
  serializePlaytestReport,
} from "./playtest-presentation";
import type { PlaytestFrictionTag, PlaytestNotes } from "./playtest-presentation";
import { downloadTextFile } from "./panels";

export const PLAYTEST_NOTES_STORAGE_KEY = "asw91-project-ringcraft-playtest-notes-v1";

export function readPlaytestNotes(campaignId: string): PlaytestNotes {
  try {
    const raw = localStorage.getItem(PLAYTEST_NOTES_STORAGE_KEY);
    if (!raw) return normalizePlaytestNotes(undefined, campaignId);
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || (parsed as { campaignId?: unknown }).campaignId !== campaignId) {
      return normalizePlaytestNotes(undefined, campaignId);
    }
    return normalizePlaytestNotes(parsed as Partial<PlaytestNotes>, campaignId);
  } catch {
    return normalizePlaytestNotes(undefined, campaignId);
  }
}

export function writePlaytestNotes(notes: PlaytestNotes): void {
  localStorage.setItem(PLAYTEST_NOTES_STORAGE_KEY, JSON.stringify(notes));
}

interface PlaytestPanelProps {
  campaign: CampaignState;
  dossier: CareerDossier;
  notes: PlaytestNotes;
  onNotesChange: (notes: PlaytestNotes) => void;
  onSave: () => void;
  onClear: () => void;
}

export function PlaytestPanel({ campaign, dossier, notes, onNotesChange, onSave, onClear }: PlaytestPanelProps) {
  const [status, setStatus] = useState("");
  function update(next: Partial<PlaytestNotes>) {
    onNotesChange({ ...notes, ...next, campaignId: campaign.campaignId });
  }
  function toggleTag(tag: PlaytestFrictionTag, checked: boolean) {
    const tags = checked ? [...notes.tags, tag] : notes.tags.filter((value) => value !== tag);
    update({ tags: [...new Set(tags)] });
  }
  function clear() {
    if ((notes.goal || notes.notes || notes.tags.length) && !window.confirm("Clear the local playtest notes?")) return;
    onClear();
    setStatus("Notes cleared");
  }
  function exportReport() {
    try {
      const report = buildPlaytestReport(campaign, dossier, notes);
      downloadTextFile(`${campaign.campaignId}-playtest-report.json`, serializePlaytestReport(report));
      setStatus("Report exported");
    } catch (error) {
      setStatus(`Report export failed: ${String(error)}`);
    }
  }
  return (
    <section className="form-card form-card--wide playtest-panel" aria-labelledby="playtest-title">
      <div className="playtest-panel__heading">
        <div>
          <div className="decision__kicker">PRIVATE PLAYTEST KIT</div>
          <h3 id="playtest-title">Playtest notes</h3>
        </div>
        <small>Campaign {campaign.campaignId}</small>
      </div>
      <label>
        Session goal
        <input aria-label="Playtest session goal" value={notes.goal} onChange={(event) => update({ goal: event.target.value })} placeholder="What are you trying to learn?" />
      </label>
      <fieldset className="playtest-tags">
        <legend>Friction tags</legend>
        {PLAYTEST_FRICTION_TAGS.map((tag) => {
          const label = tag.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
          return (
            <label key={tag}>
              <input aria-label={label} type="checkbox" checked={notes.tags.includes(tag)} onChange={(event) => toggleTag(tag, event.target.checked)} />
              {label}
            </label>
          );
        })}
      </fieldset>
      <label>
        Notes
        <textarea aria-label="Playtest notes" value={notes.notes} onChange={(event) => update({ notes: event.target.value })} rows={4} placeholder="Record friction, surprises, and follow-up questions." />
      </label>
      <div className="button-row">
        <button onClick={() => { onSave(); setStatus("Saved locally"); }}>Save notes</button>
        <button className="button--quiet" onClick={clear}>Clear notes</button>
        <button className="button--quiet" onClick={exportReport}>Export playtest report</button>
      </div>
      <p className="playtest-panel__status" aria-live="polite">{status || "Notes are local to this browser and campaign."}</p>
    </section>
  );
}
