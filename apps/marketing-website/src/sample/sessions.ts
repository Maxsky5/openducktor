// The agent sessions of the stories: a model of a runtime, an effort, and a context window.
import type { ContextUse } from "../replica/format";
import { modelPath, type ModelRef } from "./models";

/** A session and the part of its context window in use, in percent. */
export type Session = ModelRef & { effort: string; window: number; used: number };

/** The signature under the last assistant message of a turn: provider/model · effort. */
export function signature(session: Session): string {
  return `${modelPath(session)} · ${session.effort}`;
}

/** The context use of `session` when `used` percent of its window is in use. */
export function contextUse(session: Session, used = session.used): ContextUse {
  return { percent: used, tokens: (used / 100) * session.window };
}
