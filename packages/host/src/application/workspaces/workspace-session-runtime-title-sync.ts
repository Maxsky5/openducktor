import {
  type AgentSessionLiveRef,
  RUNTIME_DESCRIPTORS_BY_KIND,
  RUNTIME_HOST_TRAITS_BY_KIND,
  type RuntimeKind,
  type WorkspaceSession,
} from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";
import { Effect } from "effect";
import {
  planRuntimeTitleRename,
  runtimeTitle,
} from "../../domain/workspace-sessions/workspace-session-title";
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
    const runtimeLabel = RUNTIME_DESCRIPTORS_BY_KIND[runtimeRef.runtimeKind].label;
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
                message: `${runtimeLabel} no longer holds this session.`,
              });
          }),
        );
      }).pipe(
        Effect.catch((failure) =>
          reportFailure(
            runtimeRef,
            `Could not sync this Workspace Session title to ${runtimeLabel}. The message was accepted and the saved title remains. Reattach this session or rename it to retry. ${failure.message}`,
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

/**
 * When the host pushes a Workspace Session title to the native session: at once, after the first
 * turn of the session, or never, for a runtime without rename.
 */
export const titleSyncMode = (runtimeKind: RuntimeKind): "immediate" | "after_turn" | "none" =>
  RUNTIME_HOST_TRAITS_BY_KIND[runtimeKind].sessionTitleSync;

/**
 * The native rename that gives a runtime session a new effective title, or null when there is none.
 * A runtime without rename keeps its native title. `resendUnchanged` sends the title again to a
 * runtime that syncs after the turn, because its native title can lag behind the saved one.
 */
export const planNativeRename = (
  session: Pick<
    WorkspaceSession,
    "runtimeKind" | "externalSessionId" | "generatedTitle" | "manualTitle"
  >,
  nextTitle: string | null,
  { resendUnchanged = false }: { resendUnchanged?: boolean } = {},
): { externalSessionId: string; title: string } | null => {
  const mode = titleSyncMode(session.runtimeKind);
  if (mode === "none") return null;
  const rename = planRuntimeTitleRename(session, nextTitle);
  if (rename || !resendUnchanged || mode !== "after_turn") return rename;
  return session.externalSessionId !== null && nextTitle !== null
    ? { externalSessionId: session.externalSessionId, title: nextTitle }
    : null;
};

type LocatedSession = { ref: WorkspaceSessionStoreRef; session: WorkspaceSession };
