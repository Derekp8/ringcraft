import { IController, PlayerAction } from './IController';

export type AIDifficulty = 'easy' | 'medium' | 'hard';

export interface AIParams {
  decisionInterval: number; // ms
  movementNoise: number; // 0..1
  attackProbability: number; // 0..1
  evasionProbability: number; // 0..1
}

export const DIFFICULTY_PRESETS: Record<AIDifficulty, AIParams> = {
  easy: { decisionInterval: 300, movementNoise: 0.7, attackProbability: 0.25, evasionProbability: 0.15 },
  medium: { decisionInterval: 180, movementNoise: 0.45, attackProbability: 0.5, evasionProbability: 0.25 },
  hard: { decisionInterval: 90, movementNoise: 0.15, attackProbability: 0.85, evasionProbability: 0.35 }
};

export class AIController implements IController {
  private currentAction: PlayerAction = { dx: 0, dy: 0, fire: false };
  private timeSinceDecision = 0;
  private nextDecisionIn = 0;

  constructor(private params: AIParams) {
    this.scheduleNextDecision();
  }

  update(dt: number, state: any): void {
    this.timeSinceDecision += dt;
    if (this.timeSinceDecision >= this.nextDecisionIn) {
      this.makeDecision(state);
      this.timeSinceDecision = 0;
      this.scheduleNextDecision();
    }
  }

  getAction(): PlayerAction {
    return { ...this.currentAction, timestamp: Date.now() };
  }

  private scheduleNextDecision() {
    // add some jitter to the decision interval
    const jitter = (Math.random() - 0.5) * this.params.decisionInterval * 0.5;
    this.nextDecisionIn = Math.max(20, this.params.decisionInterval + jitter);
  }

  private makeDecision(state: any) {
    // state is intentionally generic: we will look for visible opponents and sample behaviour.

    // 1) choose a random movement vector, possibly biased toward nearest opponent if one exists
    const opponents = this.findOpponents(state);
    let targetDir = { x: 0, y: 0 };
    if (opponents.length > 0 && Math.random() < 0.7) {
      const t = opponents[Math.floor(Math.random() * opponents.length)];
      targetDir.x = t.x - (t.ownX ?? 0);
      targetDir.y = t.y - (t.ownY ?? 0);
      const len = Math.hypot(targetDir.x, targetDir.y) || 1;
      targetDir.x /= len;
      targetDir.y /= len;
    } else {
      // wander
      const angle = Math.random() * Math.PI * 2;
      targetDir.x = Math.cos(angle);
      targetDir.y = Math.sin(angle);
    }

    // apply noise
    const noise = this.params.movementNoise;
    const nx = targetDir.x * (1 - noise) + (Math.random() * 2 - 1) * noise;
    const ny = targetDir.y * (1 - noise) + (Math.random() * 2 - 1) * noise;
    const nlen = Math.hypot(nx, ny) || 1;

    // 2) decide whether to attack
    let inRange = false;
    if (opponents.length > 0) {
      const t0 = opponents[0];
      const dist = Math.hypot((t0.x - (t0.ownX ?? 0)), (t0.y - (t0.ownY ?? 0)));
      inRange = dist < (t0.range ?? 100);
    }
    const willAttack = Math.random() < (inRange ? this.params.attackProbability : this.params.attackProbability * 0.15);

    // 3) occasional evasion
    const doEvade = Math.random() < this.params.evasionProbability;
    let finalDx = nx / nlen;
    let finalDy = ny / nlen;
    if (doEvade) {
      // strafe perpendicular
      const evx = -finalDy;
      const evy = finalDx;
      finalDx = evx * 0.8 + finalDx * 0.2;
      finalDy = evy * 0.8 + finalDy * 0.2;
    }

    this.currentAction = { dx: finalDx, dy: finalDy, fire: willAttack };
  }

  private findOpponents(state: any) {
    // Try to detect opponent entities; support a few likely shapes.
    if (!state) return [];
    if (Array.isArray(state.entities)) {
      // map entities to a normalized format
      return state.entities
        .filter((e: any) => e.team !== 'self')
        .map((e: any) => ({ x: e.x, y: e.y, ownX: e.ownX, ownY: e.ownY, range: e.range ?? 100 }));
    }
    // fallback: no opponents
    return [];
  }
}
