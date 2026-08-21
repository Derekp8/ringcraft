# Visual QA rendering boundary

Project Ringcraft preserves two distinct visual-QA claims rather than treating different browser/font rasterizers as byte-equivalent.

## Reviewed screenshot evidence

The `output/qa/ringcraft-*.png` files committed to the repository are reviewed evidence. `HANDOFF-MANIFEST.json` pins their SHA-256 values. CI verifies those committed blobs before any hosted-runner render overwrites `output/qa`.

These pins must not be regenerated merely because a different operating system or font rasterizer produces different line metrics, page heights, or antialiasing.

## Hosted-runner reproducibility

GitHub Actions runs the visual QA harness twice on the same Ubuntu runner environment. Run 1 establishes the harness baseline and run 2 must reproduce it within the visual harness's documented sub-pixel antialiasing tolerance.

A stable hosted-Linux render demonstrates deterministic automation on that runner. It does not by itself prove byte equality with a reviewed capture produced in another rendering environment.

## Why the claims are separate

The M14 hosted-runner investigation showed all 22 Linux captures were stable between consecutive runs while their dimensions differed from the committed reviewed pins. The mismatch affected the entire capture set and was systematic, which is evidence of an environment/layout boundary rather than random screenshot flakiness.

The repair therefore does not re-pin screenshots. It preserves the reviewed evidence hashes and makes CI responsible for a claim it can truthfully prove: hosted-runner reproducibility.

Human visual review and assistive-technology review remain separate external QA gates.
