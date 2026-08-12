# Project Ringcraft — M6 Enhancements

M6 focus: **Onboarding, explanations, guidance, and accessibility.**

## Quick Start

```bash
npm ci
npm run dev
```

## M6 Work Items

- [ ] **Onboarding system** — Career setup guidance and tutorial flow
- [ ] **Month-end explanation** — Clarify monthly rating/ranking changes
- [ ] **Post-match summary** — Better match resolution explanations
- [ ] **Blocked-action guidance** — Explain unavailable actions
- [ ] **Assistive-technology review** — Accessibility improvements
- [ ] **Audiovisual/private polish** — UI/UX refinements

## Architecture

See `FREEBUFF-HANDOFF.md` for M5 foundation details.

- `src/core/` — Deterministic rules engine (unchanged from M5)
- `src/ui/` — React UI and new onboarding components
- `src/ui/onboarding/` — NEW: Onboarding system
- `tests/` — Unit and integration tests
