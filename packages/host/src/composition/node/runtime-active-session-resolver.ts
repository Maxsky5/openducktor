import { Effect } from "effect";
import type { AgentSessionLiveStateService } from "../../application/agent-sessions/agent-session-live-state-service";
import { toHostOperationError } from "../../effect/host-errors";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";

type RuntimeEnsureInput = Parameters<RuntimeRegistryPort["ensureWorkspaceRuntime"]>[0];

export const createRuntimeActiveSessionResolver =
  (liveSessionState: Pick<AgentSessionLiveStateService, "list">) =>
  (runtimeInput: RuntimeEnsureInput) =>
    liveSessionState.list({ repoPath: runtimeInput.repoPath }).pipe(
      Effect.map((sessions) =>
        sessions.some(
          (session) =>
            session.ref.runtimeKind === runtimeInput.descriptor.kind && session.activity !== "idle",
        ),
      ),
      Effect.mapError((cause) =>
        toHostOperationError(cause, "runtimeRegistry.checkActiveSessions", {
          repoPath: runtimeInput.repoPath,
          runtimeKind: runtimeInput.descriptor.kind,
        }),
      ),
    );
