// Minimal match manager shim that demonstrates controller integration.
import { AIController, DIFFICULTY_PRESETS, AIDifficulty } from './controllers/AIController';
import { HumanController } from './controllers/HumanController';
import type { IController, PlayerAction } from './controllers/IController';

type MatchOptions = {
  numAI: number;
  difficulty: AIDifficulty;
  onEnd?: (result: any) => void;
};

let running = false;
let rafId: number | null = null;
let lastTime = 0;
let accum = 0;
const FIXED_DT = 16; // ms

let humanAdapter: any = null;
let controllers: Record<string, IController> = {};
let entities: any[] = [];
let optionsGlobal: MatchOptions | null = null;
let onEndGlobal: ((r: any) => void) | undefined = undefined;

function createInputAdapter() {
  let listeners: ((action: PlayerAction) => void)[] = [];
  const state = { up: false, down: false, left: false, right: false, fire: false };

  function emit() {
    const dx = (state.right ? 1 : 0) - (state.left ? 1 : 0);
    const dy = (state.down ? 1 : 0) - (state.up ? 1 : 0);
    const len = Math.hypot(dx, dy) || 1;
    const action: PlayerAction = { dx: dx / len, dy: dy / len, fire: !!state.fire };
    listeners.forEach((l) => l(action));
  }

  function onKey(e: KeyboardEvent) {
    const down = e.type === 'keydown';
    switch (e.code) {
      case 'KeyW': state.up = down; break;
      case 'KeyS': state.down = down; break;
      case 'KeyA': state.left = down; break;
      case 'KeyD': state.right = down; break;
      case 'Space': state.fire = down; break;
      default: return;
    }
    emit();
  }

  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);

  return {
    on: (ev: string, cb: (a: PlayerAction) => void) => {
      if (ev === 'input') listeners.push(cb);
    },
    dispose: () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      listeners = [];
    }
  };
}

function spawnEntities(numAI: number, difficulty: AIDifficulty) {
  entities = [];
  controllers = {};

  // Human player as one or more avatars. For broadcast we will create multiple human entities
  const humanCount = 1; // can be extended
  humanAdapter = createInputAdapter();
  for (let i = 0; i < humanCount; i++) {
    const id = `human-${i}`;
    entities.push({ id, x: 100 + i * 20, y: 100, hp: 100, team: 'human' });
    controllers[id] = new HumanController(humanAdapter);
  }

  // Spawn AI
  for (let i = 0; i < numAI; i++) {
    const id = `ai-${i}`;
    entities.push({ id, x: 400 + (i * 30), y: 200 + (i * 20), hp: 100, team: 'ai' });
    controllers[id] = new AIController(DIFFICULTY_PRESETS[difficulty]);
  }
}

function applyActionToEntity(entity: any, action: PlayerAction) {
  // Simple movement and firing logic
  const speed = 0.12; // px per ms
  entity.x += (action.dx || 0) * speed * FIXED_DT;
  entity.y += (action.dy || 0) * speed * FIXED_DT;
  if (action.fire) {
    // naive: damage nearest opposite within 60px
    const targets = entities.filter((e) => e.team !== entity.team && e.hp > 0);
    if (targets.length > 0) {
      let nearest = targets[0];
      let nd = Math.hypot(nearest.x - entity.x, nearest.y - entity.y);
      for (const t of targets) {
        const d = Math.hypot(t.x - entity.x, t.y - entity.y);
        if (d < nd) {
          nd = d; nearest = t;
        }
      }
      if (nd < 60) {
        nearest.hp -= 8; // damage
      }
    }
  }
}

function fixedUpdate(dt: number) {
  const state = { entities: entities.map((e) => ({ ...e })) };
  // update controllers
  for (const id of Object.keys(controllers)) {
    const c = controllers[id];
    c.update(dt, state);
  }
  // collect actions and apply
  for (const e of entities) {
    const c = controllers[e.id];
    if (!c) continue;
    const action = c.getAction();
    applyActionToEntity(e, action);
  }

  // cleanup dead
  const aliveHuman = entities.filter((e) => e.team === 'human' && e.hp > 0).length;
  const aliveAI = entities.filter((e) => e.team === 'ai' && e.hp > 0).length;
  if (aliveHuman === 0 || aliveAI === 0) {
    endMatch();
  }
}

function loop(ts: number) {
  if (!running) return;
  if (!lastTime) lastTime = ts;
  const delta = ts - lastTime;
  lastTime = ts;
  accum += delta;
  while (accum >= FIXED_DT) {
    fixedUpdate(FIXED_DT);
    accum -= FIXED_DT;
  }
  rafId = requestAnimationFrame(loop);
}

export function startMatch(opts: MatchOptions) {
  if (running) stopMatch();
  optionsGlobal = opts;
  onEndGlobal = opts.onEnd;
  spawnEntities(opts.numAI || 1, opts.difficulty || 'medium');
  running = true;
  lastTime = 0;
  accum = 0;
  rafId = requestAnimationFrame(loop);
}

export function stopMatch() {
  if (!running) return;
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  if (humanAdapter) {
    humanAdapter.dispose();
    humanAdapter = null;
  }
}

function endMatch() {
  stopMatch();
  const humanScore = entities.filter((e) => e.team === 'ai' && e.hp <= 0).length;
  const aiScore = entities.filter((e) => e.team === 'human' && e.hp <= 0).length;
  const winner = humanScore > aiScore ? 'human' : 'ai';
  const result = { winner, humanScore, aiScore, entities: JSON.parse(JSON.stringify(entities)) };
  if (onEndGlobal) onEndGlobal(result);
}
