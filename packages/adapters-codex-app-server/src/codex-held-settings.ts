import type { AgentModelSelection } from "@openducktor/core";
import type { CodexSessionState } from "./types";

type SettingsHold = {
  model: AgentModelSelection | undefined;
  reports: Array<{ order: number; run: () => Promise<void> }>;
};

export class CodexHeldSettings {
  private readonly holds = new WeakMap<CodexSessionState, SettingsHold>();

  /** Keep turn admission closed until held reports finish on the event queue. */
  async hold(
    session: CodexSessionState,
    beforeFlush: () => Promise<void>,
  ): Promise<() => Promise<void>> {
    if (session.turnAdmission.isHeld)
      throw new Error("A session settings change is already pending.");
    const held: SettingsHold = { model: session.model, reports: [] };
    this.holds.set(session, held);
    const release = await session.turnAdmission.hold();
    return async () => {
      try {
        await beforeFlush();
        // Earlier queued events can join the hold after newer reports have arrived.
        held.reports.sort((left, right) => left.order - right.order);
        while (held.reports.length > 0) {
          await held.reports.shift()?.run();
        }
      } finally {
        this.holds.delete(session);
        release();
      }
    };
  }

  defer(
    session: CodexSessionState,
    order: number,
    run: (model: AgentModelSelection | undefined) => Promise<void>,
  ): boolean {
    const held = this.holds.get(session);
    if (!held) return false;
    held.reports.push({ order, run: () => run(held.model) });
    return true;
  }
}
