# Manual-compliance review packet

## Certification status

The repository's internal audit concludes that the encoded 1991 core matches the reviewed source, with documented ambiguities. Formal certification is **pending** because the two source PDFs referenced by historical handoff records are not present in any repository commit and no independent second-human comparison is signed. This packet does not recreate, quote, or distribute protected source material.

Authority order is: authorized 1991 manual; printed profiles; authorized errata/supplements; audited GDD for explicit digital adjudication; implementation only as evidence. Ringcraft extensions never become source authority.

## Evidence set

- `docs/rules-audit-1991.md`: chapter/rule-family audit and known source contradictions.
- `docs/m4-traceability-matrix.md` and `docs/m5-traceability-matrix.md`: creation, match, progression, and campaign provenance.
- `docs/release-traceability-matrix.md`: consolidated closure routing.
- `docs/adjudication-register.md`: every implementation interpretation and extension decision.
- `src/core/rules.ts`, `career-rules.ts`, `campaign-rules.ts`: versioned tables and formulas.
- `tests/core.test.ts`, `m4.test.ts`, `m5.test.ts`: source-rule regressions.
- deterministic fixtures and replay-verifier tests: encoded identity and drift evidence.

## Independent reviewer procedure

1. Work from an authorized private copy. Record its private identifier and SHA-256 below; do not commit it.
2. For every row in `docs/release-traceability-matrix.md`, enter the exact PDF/printed page, compare the text/chart with the named data/code, then execute or inspect the named test.
3. For every table, compare every cell, not only boundaries. `docs/rules-audit-1991.md` routes the item-level maneuver/profile review.
4. Mark deviations as transcription defects, implementation defects, source ambiguities, or explicit digital adjudications. Do not silently resolve them.
5. Initial each adjudication-register row and record any authorized ruling as a new immutable entry. If a ruling changes an identity, document compatibility and migrate it deliberately.
6. Sign only after the core matrix is complete. Review extensions separately and confirm their UI labels do not present them as 1991 rules.

## Known contradictions requiring explicit approval

| ID | Source conflict | Current implementation | Required human disposition |
|---|---|---|---|
| A-1991-01 | Holds chart lists Leglock at 7 WP per level; two printed profiles arithmetically imply 8 | Preserve chart value 7 and printed profile TOTAL WP metadata independently | Confirm chart precedence or issue authorized correction |
| A-1991-02 | Holds chart lists Leg Scissors at 6 WP per level; one printed profile arithmetically implies 7 | Preserve chart value 6 and printed profile TOTAL WP metadata independently | Confirm chart precedence or issue authorized correction |
| A-1991-03 | Three printed profile TOTAL WP values do not recompute from maneuver-chart costs | Preserve printed TOTAL WP rather than infer table changes | Confirm each profile total |
| M5-ADJ-03 | Critical Hold 100 inheritance is made explicit by audited GDD | Result 100 retains result 99's injury and adds automatic submission | Confirm the adjudicated inheritance |

## Core and extension boundary check

The manual-derived core comprises creation/attributes, holds and strikes, combat/critical/fumble/referee/outside/tag procedures, WP/progression, ratings, title shots/obligations, and chart-authorized injuries. Seeded virtual dice, AI, replay, saves, and accessibility are digital infrastructure. Cage/ladder, post-match injury checks, finance/contracts, popularity/chemistry, negotiation, and feud/booking are optional Ringcraft extensions and must remain so labeled.

## Sign-off record — intentionally blank

| Field | Entry |
|---|---|
| Authorized manual private identifier / SHA-256 | Pending |
| Authorized GDD private identifier / SHA-256 | Pending |
| Independent reviewer name | Pending |
| Core matrix completed date | Pending |
| Adjudication rows initialed | Pending |
| Exceptions or rulings attached | Pending |
| Manual-compliance approval | **Not signed** |

Automated green checks must not fill or imply these fields.
