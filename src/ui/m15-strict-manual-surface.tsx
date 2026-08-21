import { useEffect, useState } from "react";
import { strictManualCampaignCompatibility } from "../core";
import type { StrictManualCompatibility } from "../core";
import { readLatestAutosave } from "./save-manager";

function inputByLabel(label: string): HTMLInputElement | HTMLSelectElement | null {
  const control = [...document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input[aria-label], select[aria-label]")]
    .find((candidate) => candidate.getAttribute("aria-label") === label);
  return control ?? null;
}

function setNativeSelect(select: HTMLSelectElement, value: string): void {
  if (select.value === value) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  setter?.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function setCheckboxOff(input: HTMLInputElement): void {
  if (input.checked) input.click();
}

function headingTexts(): string[] {
  return [...document.querySelectorAll("h1, h2, h3")]
    .map((heading) => heading.textContent?.trim().toLowerCase() ?? "");
}

function newCareerSetupVisible(): boolean {
  const headings = headingTexts();
  return headings.includes("new career") || headings.includes("start or continue a career");
}

function careerSurfaceVisible(): boolean {
  const careerNavVisible = [...document.querySelectorAll("button")]
    .some((button) => button.textContent?.trim() === "Career");
  return careerNavVisible && headingTexts().some((heading) => heading.includes("career"));
}

function latestCompatibility(): StrictManualCompatibility | null {
  try {
    const campaign = readLatestAutosave();
    return campaign ? strictManualCampaignCompatibility(campaign) : null;
  } catch {
    return null;
  }
}

export default function M15StrictManualSurface() {
  const [strictSetup, setStrictSetup] = useState(true);
  const [show, setShow] = useState(false);
  const [setup, setSetup] = useState(false);
  const [compatibility, setCompatibility] = useState<StrictManualCompatibility | null>(null);

  useEffect(() => {
    const synchronize = () => {
      const isSetup = newCareerSetupVisible();
      setSetup(isSetup);
      setShow(careerSurfaceVisible());
      const current = latestCompatibility();
      setCompatibility(current);

      const injury = inputByLabel("Post-match injury checks") as HTMLSelectElement | null;
      const finance = inputByLabel("Enable contracts and finance extension") as HTMLInputElement | null;
      const negotiation = inputByLabel("Enable contract negotiation extension") as HTMLInputElement | null;
      const renewal = inputByLabel("Enable curve-fair renewals") as HTMLInputElement | null;
      const booking = inputByLabel("Enable feuds and booking extension") as HTMLInputElement | null;
      const extensionInputs = [finance, negotiation, renewal, booking].filter(Boolean) as HTMLInputElement[];

      if (isSetup && strictSetup) {
        if (injury) { setNativeSelect(injury, "off"); injury.disabled = true; }
        for (const control of extensionInputs) { setCheckboxOff(control); control.disabled = true; }
      } else if (isSetup) {
        if (injury) injury.disabled = false;
        if (finance) finance.disabled = false;
        if (booking) booking.disabled = false;
        if (negotiation) negotiation.disabled = !Boolean(finance?.checked);
        if (renewal) renewal.disabled = !Boolean(negotiation?.checked);
      }

      const variety = inputByLabel("Match variety") as HTMLSelectElement | null;
      if (!isSetup && strictSetup && current?.compatible && variety) {
        setNativeSelect(variety, "standard");
        variety.disabled = true;
      } else if (variety && !isSetup) {
        variety.disabled = false;
      }
    };

    synchronize();
    const timer = window.setInterval(synchronize, 200);
    return () => window.clearInterval(timer);
  }, [strictSetup]);

  if (!show) return null;

  return <aside className="form-card m15-strict-manual" aria-label="Rules compatibility">
    {setup ? <>
      <h3>Rules compatibility</h3>
      <label className="finance-toggle"><input type="checkbox" aria-label="Strict Manual Mode" checked={strictSetup} onChange={(event) => setStrictSetup(event.target.checked)} /> Strict Manual Mode</label>
      <p aria-live="polite">{strictSetup
        ? "Strict Manual Mode is selected. Adjudicated gameplay extensions are disabled for this new career; AI difficulty still changes legal action selection only."
        : "Extensions may be enabled in Career setup. The resulting campaign will report every setting outside Strict Manual compatibility."}</p>
      <small>Compatibility is derived from existing settings; no strict-manual save flag is stored.</small>
    </> : <>
      <h3>Rules compatibility</h3>
      {compatibility ? <>
        <p className={compatibility.compatible ? "validation validation--ok" : "validation validation--error"} aria-live="polite">{compatibility.label}</p>
        {compatibility.compatible
          ? <p>This campaign currently satisfies the derived Strict Manual profile.</p>
          : <><p>This campaign remains playable, but these persisted settings use adjudicated or digital extensions. Nothing has been silently removed:</p><ul>{compatibility.violations.map((entry) => <li key={`${entry.field}:${entry.detail}`}><strong>{entry.field}</strong>: {entry.detail}</li>)}</ul></>}
        <details><summary>Compatibility profile</summary><code>{compatibility.profileId}</code></details>
      </> : <p>Compatibility will appear when a Career autosave is available.</p>}
    </>}
  </aside>;
}
