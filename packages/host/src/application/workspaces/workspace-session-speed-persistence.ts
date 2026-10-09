import type {
  AgentSessionLiveRef,
  AgentSessionModelSettings,
  WorkspaceSession,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError, toHostOperationError } from "../../effect/host-errors";
import type { AgentSessionRuntimeAdapterPort } from "../../ports/agent-session-live-adapter-port";
import type { HostSessionImportSource } from "../../ports/runtime-session-import-port";
import type {
  WorkspaceSessionStorePort,
  WorkspaceSessionStoreRef,
  WorkspaceSessionStoreScope,
} from "../../ports/workspace-session-store-port";
import type { WorkspaceSessionUpdatedPublisher } from "./workspace-session-persistence-callbacks";

export const prepareWorkspaceSpeedUpdate = (
  known: { ref: WorkspaceSessionStoreRef; session: WorkspaceSession } | null,
  store: WorkspaceSessionStorePort,
  publish: WorkspaceSessionUpdatedPublisher,
) =>
  Effect.gen(function* () {
    if (!known)
      return yield* new HostValidationError({
        field: "externalSessionId",
        message: "Import this session as a Workspace Session before changing speed.",
      });
    return {
      model: known.session.selectedModel,
      choice: known.session.speed,
      save: (speed: string | null, model?: AgentSessionModelSettings) =>
        (model
          ? store.setSelectedModel({
              ...known.ref,
              selectedModel: {
                ...model,
                runtimeKind: known.session.runtimeKind,
                profileId: model.profileId ?? known.session.selectedModel?.profileId,
              },
              speed,
            })
          : store.setSpeed({ ...known.ref, speed })
        ).pipe(
          Effect.mapError((cause) => toHostOperationError(cause, "workspaceSession.speed")),
          Effect.map((saved) => publish(known.ref.workspaceId, saved)),
        ),
    };
  });

export const attachImportedWorkspaceSession = (
  source: HostSessionImportSource,
  adapter: Pick<AgentSessionRuntimeAdapterPort, "readSnapshot">,
  ref: AgentSessionLiveRef,
  scope: WorkspaceSessionStoreScope,
  session: WorkspaceSession,
  store: WorkspaceSessionStorePort,
  publish: WorkspaceSessionUpdatedPublisher,
) =>
  Effect.gen(function* () {
    yield* source.attach;
    const snapshot = yield* adapter.readSnapshot(ref);
    const choice = snapshot.type === "live" ? snapshot.session.speed?.choice : undefined;
    if (session.speed === null && choice !== null && choice !== undefined)
      return yield* store.setSpeed({ ...scope, sessionId: session.id, speed: choice }).pipe(
        Effect.mapError((cause) => toHostOperationError(cause, "workspaceSession.speed")),
        Effect.tap((saved) => publish(scope.workspaceId, saved)),
      );
    yield* publish(scope.workspaceId, session);
    return session;
  });
