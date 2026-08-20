# M5 deterministic fixtures

- `example-career-save.json` is a canonical completed-match campaign save.
- `example-in-progress-save.json` contains a recoverable scheduled match in progress.
- `example-match-replay.json` is the compact config/input/hash replay contract for the completed match.

Regenerate with `npm run fixtures:m5` and verify load, replay, and deterministic continuation with `npm run fixtures:verify`.
