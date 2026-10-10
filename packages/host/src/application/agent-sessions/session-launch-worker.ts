import type {
  AgentSessionControlSendInput,
  AgentSessionLiveRef,
  SessionLaunchState,
} from "@openducktor/contracts";
import type { Deferred, Fiber } from "effect";

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
  sendInput?: AgentSessionControlSendInput;
  canceled: boolean;
  runtimeStopAttempted: boolean;
  stopOwnedBySessionCommand: boolean;
  stage: string;
};
