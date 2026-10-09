import type { AgentSessionLiveRef, RuntimeKind, WorkspaceSession } from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";
import { Effect } from "effect";
import { runtimeTitle } from "../../domain/workspace-sessions/workspace-session-title";
import { type HostError, HostOperationError } from "../../effect/host-errors";
import type { WorkspaceSessionStoreRef } from "../../ports/workspace-session-store-port";
import type { createWorkspaceSessionOperationGate } from "./workspace-session-operation-gate";
import type {
  WorkspaceSessionRenameFailureReporter,
  WorkspaceSessionRuntimeTitleUpdater,
} from "./workspace-session-persistence-callbacks";

export type TitleSyncState = Map<string, "pending" | "queued" | "handled">;

/** Queues one native title write outside live publication and under the title gate. */
export const syncTitleAfterTurn = (
  runtimeRef: AgentSessionLiveRef,
  {
    state,
    find,
    findActive,
    gate,
    updateTitle,
    reportFailure,
    startJob,
  }: {
    state: TitleSyncState;
    find: (ref: AgentSessionLiveRef) => Effect.Effect<LocatedSession | null, HostError>;
    findActive: (ref: AgentSessionLiveRef) => Effect.Effect<LocatedSession | null, HostError>;
    gate: ReturnType<typeof createWorkspaceSessionOperationGate>;
    updateTitle: WorkspaceSessionRuntimeTitleUpdater;
    reportFailure: WorkspaceSessionRenameFailureReporter;
    /** Owns the sync after this call returns. */
    startJob: (job: Effect.Effect<void>) => Effect.Effect<void>;
  },
) =>
  Effect.gen(function* () {
    const runtimeLabel = runtimeRef.runtimeKind === "claude" ? "Claude" : "Codex";
    const key = agentSessionRefKey(runtimeRef);
    if (state.get(key) !== "pending") return;
    state.set(key, "queued");
    yield* startJob(
      Effect.gen(function* () {
        const known = yield* find(runtimeRef);
        if (!known) return;
        yield* gate.run(
          known.ref,
          Effect.gen(function* () {
            const current = yield* findActive(runtimeRef);
            if (!current || state.get(key) !== "queued") return;
            const title = runtimeTitle(current.session);
            if (title === null) {
              state.delete(key);
              return;
            }
            state.set(key, "handled");
            const result = yield* updateTitle({ ...runtimeRef, title });
            if (result.status === "not_attached")
              return yield* new HostOperationError({
                operation: "workspaceSession.runtime-title.sync",
                message: `${runtimeLabel} no longer holds this chat.`,
              });
          }),
        );
      }).pipe(
        Effect.catch((failure) =>
          reportFailure(
            runtimeRef,
            `Could not sync this Workspace Session title to ${runtimeLabel}. The message was accepted and the saved title remains. Reattach this chat or rename it to retry. ${failure.message}`,
            "workspaceSession.title.sync",
          ),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            if (state.get(key) === "queued") state.set(key, "handled");
          }),
        ),
      ),
    );
  });

export const titleSyncNeedsTurn = (runtimeKind: RuntimeKind): boolean =>
  runtimeKind === "codex" || runtimeKind === "claude";

type LocatedSession = { ref: WorkspaceSessionStoreRef; session: WorkspaceSession };
