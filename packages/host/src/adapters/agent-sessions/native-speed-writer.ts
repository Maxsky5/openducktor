import { Effect } from "effect";
import type { AgentSessionLiveRegistration } from "../../ports/agent-session-live-adapter-port";

/** The session lease guards the save and its delayed publication. */
export const createNativeSpeedWriter =
  (binding: AgentSessionLiveRegistration) =>
  async (...args: Parameters<AgentSessionLiveRegistration["recordSpeedChoice"]>) => {
    const publish = await Effect.runPromise(binding.recordSpeedChoice(...args));
    return () => Effect.runPromise(publish);
  };
