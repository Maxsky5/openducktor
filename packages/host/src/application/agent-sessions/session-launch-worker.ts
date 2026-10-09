import type { AgentSessionLiveRef, SessionLaunchState } from "@openducktor/contracts";
import type { Deferred, Fiber } from "effect";
import type { SessionLaunchSendInput } from "./session-launch-types";

/** Private state shared by the worker and its settlement. */
export type SessionLaunchAttempt<Request, State extends SessionLaunchState> = {
  request: Request;
  snapshot: State;
  target?: AgentSessionLiveRef;
  stoppedSources?: Set<string>;
  done: Deferred.Deferred<State>;
  worker?: Fiber.Fiber<void, never>;
  active: boolean;
  recovering: boolean;
  sendInput?: SessionLaunchSendInput;
  canceled: boolean;
  runtimeStopAttempted: boolean;
  stopOwnedBySessionCommand: boolean;
  stage: string;
};
