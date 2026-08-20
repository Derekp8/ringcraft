export function canonicalSerialize(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => entry === undefined ? "null" : canonicalSerialize(entry)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalSerialize(record[key])}`)
    .join(",")}}`;
}

export function fnv1a32(value: unknown): string {
  const text = canonicalSerialize(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function canonicalHash64(value: unknown): string {
  const text = canonicalSerialize(value);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    hash ^= BigInt(codePoint);
    hash = (hash * prime) & mask;
  }
  return `c14n-fnv1a64-v1:${hash.toString(16).padStart(16, "0")}`;
}

export function hashMatchState(value: unknown): string {
  const state = value as Record<string, unknown>;
  const {
    events: _events,
    decision: _decision,
    roster: _roster,
    maneuvers: _maneuvers,
    config: rawConfig,
    ...dynamicState
  } = state;
  const config = rawConfig && typeof rawConfig === "object"
    ? (() => {
        const { roster: _configRoster, ...runtimeConfig } = rawConfig as Record<string, unknown>;
        return runtimeConfig;
      })()
    : rawConfig;
  // Static roster/maneuver definitions are already committed by dataHash. Keeping
  // them out of every transaction hash preserves the same integrity boundary
  // without repeatedly serializing the full data pack.
  return canonicalHash64({ ...dynamicState, config });
}
