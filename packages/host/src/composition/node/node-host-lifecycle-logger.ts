import { Effect } from "effect";
import type { AgentSessionLiveFaultLogger } from "../../application/agent-sessions/agent-session-live-state-service";
import { type HostLifecycleLogger, writeHostLifecycleLog } from "../host-lifecycle";

export const defaultLifecycleLogger: HostLifecycleLogger = {
  error: (message) => Effect.sync(() => console.error(message)),
  info: (message) => Effect.sync(() => console.info(message)),
};

export const createLiveSessionFaultLogger =
  (lifecycleLogger: HostLifecycleLogger): AgentSessionLiveFaultLogger =>
  (message) =>
    writeHostLifecycleLog(lifecycleLogger, "error", message);
