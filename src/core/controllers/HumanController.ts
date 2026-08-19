import { IController, PlayerAction } from './IController';

export class HumanController implements IController {
  private currentAction: PlayerAction = { dx: 0, dy: 0, fire: false };

  constructor(private inputAdapter: any) {
    // inputAdapter should provide an interface: on('input', (action) => ...)
    // The repo likely has its own input binding; we'll adapt to it by expecting
    // a small adapter object. If none exists, the Menu or app wiring can pass a simple adapter.
    if (inputAdapter && typeof inputAdapter.on === 'function') {
      inputAdapter.on('input', (action: PlayerAction) => {
        this.currentAction = { ...this.currentAction, ...action };
      });
    }
  }

  update(_dt: number, _state: any): void {
    // Human input is event driven; no per-frame work required here in default broadcast mode.
  }

  getAction(): PlayerAction {
    return { ...this.currentAction, timestamp: Date.now() };
  }
}
