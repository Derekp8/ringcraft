import type { DieRoll, MatchState, RngState } from "./types";

export type RandomUint32Source = (values: Uint32Array) => Uint32Array;

function defaultRandomUint32Source(values: Uint32Array): Uint32Array {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) throw new Error("Secure random seed generation is unavailable on this platform.");
  return cryptoApi.getRandomValues(values);
}

/** Uses platform entropy only to choose a replayable non-zero 32-bit starting seed. */
export function generateRandomSeed(source: RandomUint32Source = defaultRandomUint32Source): number {
  const values = new Uint32Array(1);
  source(values);
  return (values[0] >>> 0) || 1;
}


/** Deterministically maps independent setup entropy to an item index without touching match RNG state. */
export function setupRandomIndex(entropy: number, length: number): number {
  if (!Number.isInteger(length) || length <= 0) throw new Error("Setup random selection requires a non-empty candidate list.");
  const value = entropy >>> 0;
  return Math.floor((value / 0x1_0000_0000) * length);
}

export function createRng(seed: number, scriptedRolls: number[] = []): RngState {
  const normalized = seed >>> 0 || 0x6d2b79f5;
  return {
    algorithm: "xorshift32-v1",
    initialSeed: normalized,
    state: normalized,
    scriptedRolls: [...scriptedRolls],
    scriptedIndex: 0,
  };
}

function nextUint32(rng: RngState): number {
  let value = rng.state >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  rng.state = value >>> 0;
  return rng.state;
}

export function rollRngDie(rng: RngState, sides: number, label: string, sink: DieRoll[]): number {
  let result: number;
  if (rng.scriptedIndex < rng.scriptedRolls.length) {
    result = rng.scriptedRolls[rng.scriptedIndex++];
    if (!Number.isInteger(result) || result < 1 || result > sides) {
      throw new Error(`Scripted roll ${result} is invalid for D${sides} (${label}).`);
    }
  } else {
    const range = 0x1_0000_0000;
    const rejectionLimit = Math.floor(range / sides) * sides;
    let value = nextUint32(rng);
    while (value >= rejectionLimit) value = nextUint32(rng);
    result = (value % sides) + 1;
  }
  sink.push({ label, sides, result });
  return result;
}

export function rollDie(state: MatchState, sides: number, label: string, sink: DieRoll[]): number {
  return rollRngDie(state.rng, sides, label, sink);
}

export function rollExpression(
  state: MatchState,
  dice: number,
  sides: number,
  flat: number,
  label: string,
  sink: DieRoll[],
): number {
  let total = flat;
  for (let index = 0; index < dice; index += 1) {
    total += rollDie(state, sides, `${label} ${index + 1}/${dice}`, sink);
  }
  return total;
}

export function rollExplodingD10(state: MatchState, label: string, sink: DieRoll[]): number {
  let total = 0;
  let roll = 10;
  let guard = 0;
  while (roll === 10) {
    roll = rollDie(state, 10, label, sink);
    total += roll;
    guard += 1;
    if (guard > 1000) throw new Error("Exploding D10 safety cap exceeded.");
  }
  return total;
}
