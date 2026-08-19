// Controller interface and shared PlayerAction type

export type PlayerAction = {
  dx: number; // movement X (-1..1 normalized)
  dy: number; // movement Y (-1..1 normalized)
  fire?: boolean;
  ability?: string | null;
  timestamp?: number;
};

export interface IController {
  /** Called every engine update with delta-time (ms) and a shallow game state. */
  update(dt: number, state: any): void;

  /** Called by the engine when it wants the controller's current action for this tick. */
  getAction(): PlayerAction;
}
