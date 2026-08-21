# Visual-baseline reconciliation

## Defect

At reconciled head `7d9ace1129e8e07cbdfb2aad9b4fc33d4eab5e17`, GitHub Actions produced identical run-1/run-2 images yet all 22 differed from committed pins. Representative generated-versus-pin heights were 1024×1536 versus 1024×1541 (accessibility), 1440×6464 versus 1440×6486 (Career desktop), 390×11134 versus 390×11214 (narrow), and 1440×1440 versus 1440×1445 (singles). That pattern is stable font-metric drift, not animation or timing noise.

The workflow had changed the Linux package/assertion to DejaVu for every family. Ringcraft CSS requests `Arial Narrow`; the canonical pins resolve that display face to URW `NimbusSansNarrow-Regular`, while generic monospace remains `DejaVuSansMono`. Substituting DejaVu for the narrow display face changed wrapping and accumulated page height.

## Canonical environment

- Linux GitHub runner / Node 24; npm lockfile v3.
- Repository-pinned Playwright Core and `@sparticuz/chromium`; portable Chromium with system-browser fallback only when unavailable.
- `fonts-urw-base35` plus `fonts-dejavu-core`; `fc-match "Arial Narrow"` must report Nimbus Sans Narrow and `fc-match monospace` must report DejaVu Sans Mono.
- Viewport 1440×1100 unless a profile explicitly changes it; device scale 1; locale `en-US`; timezone UTC; light color scheme; reduced motion `no-preference`.
- Fixed QA clock and deterministic QA identity generation; CSS transition/animation suppression retained by the harness.
- Wait for `document.fonts.ready` before every capture.
- Preserve the double-run byte/pixel stability comparison and the documented ±2/255 anti-aliasing tolerance for the two creator captures.

## Result and baseline decision

The corrected mixed-font workflow proved that the generated set is stable: two consecutive captures were identical for 21 profiles, while creator validation remained within its pre-existing narrow anti-aliasing tolerance. The stable set still differed from all 22 older pins by small, accumulated font-metric changes. The same head passed the complete M9 clean-room harness, including browser assertions, so this was isolated to obsolete screenshot provenance rather than game behavior.

The failure-only diagnostic artifact from workflow run `32497280245` (`visual-qa-drift-diagnostics`, artifact `9452652891`, digest `sha256:5c44a4e3d0d658806c145bd2e18d7f21c2b7800a1971a9d4c406293285e2f78b`) was reviewed across every desktop, narrow, accessibility, creator, progression, Exhibition, tag, Career, recovery, help, and tour surface. No missing controls, overlap, hard clipping, unintended state change, or visual regression was found.

All 22 pins were therefore re-baselined from that exact canonical runner artifact. This is an environment-provenance correction only: application UI source, rules, schema versions, hashes, fixtures, PRNG behavior, AI policy, probabilities, and data values were not changed.

The workflow now asserts font resolution before running, preserves diagnostics on failure, pins browser preferences explicitly, and waits for font readiness. Future baseline changes must follow the same double-run stability and human-review procedure.
