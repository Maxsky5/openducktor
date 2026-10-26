import type { AgentSessionAssociation, WorkspaceRecord } from "@openducktor/contracts";
import { agentSessionIdentityKey } from "@openducktor/frontend-core/lib/agent-session-identity";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { runtimeReadinessTargetForRuntime } from "@openducktor/frontend-core/lib/runtime-readiness";
import { useRuntimeReadiness } from "@openducktor/frontend-core/lib/use-runtime-readiness";
import { useStableAgentSessionIdentity } from "@openducktor/frontend-core/lib/use-stable-agent-session-identity";
import { workspaceSessionListQueryOptions } from "@openducktor/frontend-core/queries/workspace-sessions";
import { useAgentSessionReadModelStateContext } from "@openducktor/frontend-core/sessions/session-contexts";
import type { AgentSessionState } from "@openducktor/frontend-core/types/agent-orchestrator";
import { useQuery } from "@tanstack/react-query";
import { Stack, useFocusEffect } from "expo-router";
import { type ReactElement, useCallback, useMemo } from "react";
import { useMobileWorkspaces } from "@/composition/workspace-selection";
import { findChatRecord } from "@/features/work-owner/work-owner-model";
import type { RawRouteParams } from "@/navigation/route-params";
import { useCommandGate } from "@/host-session/active-session-context";
import { Screen } from "@/ui/screen";
import { EmptyState, ErrorState } from "@/ui/states";
import { resolveSessionInteraction } from "./session-interaction-model";
import {
  resolveSessionOwner,
  type SessionOwnerResolution,
  type WorkOwnerSource,
  workOwnerParamsFor,
} from "./session-owner-model";
import { SessionForkProvider } from "./fork/session-fork";
import { readSessionRoute, type SessionRoute } from "./session-route";
import {
  type SessionInteraction,
  SessionScreenProvider,
  type SessionTarget,
} from "./session-target";
import { SessionView } from "./session-view";
import { TranscriptSkeleton } from "./transcript/transcript-skeleton";
import { shallowEqual, useSessionSelector } from "./use-session-selector";
import { useSessionPreparation } from "./use-session-preparation";

const SESSION_TITLE = "Session";

/** The session route: a task session or chat, or a Subagent session in a Read-only View. */
export function SessionScreen({ params }: { params: RawRouteParams }): ReactElement {
  const parsed = useMemo(() => readSessionRoute(params), [params]);
  if (!parsed.ok) {
    return (
      <Screen>
        <Stack.Screen options={{ title: SESSION_TITLE }} />
        <EmptyState icon="link-off" title="Incomplete Link" message={parsed.message} />
      </Screen>
    );
  }
  return <SessionWorkspaceGate route={parsed.route} />;
}

/**
 * The session store follows the selected workspace, so the screen selects the workspace of the
 * route while it has focus, as desktop opens a session in its workspace.
 */
function SessionWorkspaceGate({ route }: { route: SessionRoute }): ReactElement {
  const { workspaces, selectedWorkspace, selectWorkspace, isLoading, error, refreshWorkspaces } =
    useMobileWorkspaces();
  const workspace = workspaces.find((entry) => entry.workspaceId === route.workspaceId) ?? null;
  const { workspaceId } = route;
  const workspaceOpen = workspace !== null;
  useFocusEffect(
    useCallback(() => {
      if (workspaceOpen && selectedWorkspace?.workspaceId !== workspaceId) {
        selectWorkspace(workspaceId);
      }
    }, [selectWorkspace, selectedWorkspace?.workspaceId, workspaceId, workspaceOpen]),
  );
  if (!workspace) {
    return (
      <Screen>
        <Stack.Screen options={{ title: SESSION_TITLE }} />
        {isLoading ? <TranscriptSkeleton label="Loading workspaces" /> : null}
        {!isLoading && error ? (
          <ErrorState title="Workspaces did not load" message={error} onRetry={refreshWorkspaces} />
        ) : null}
        {!isLoading && !error ? (
          <EmptyState
            icon="folder-x"
            title="Workspace Not Open"
            message="The host does not have this workspace open now. Open it in the desktop or web app, then open the session again."
          />
        ) : null}
      </Screen>
    );
  }
  if (selectedWorkspace?.workspaceId !== workspace.workspaceId) {
    return (
      <Screen>
        <Stack.Screen options={{ title: SESSION_TITLE }} />
        <TranscriptSkeleton label={`Opening ${workspace.workspaceName}`} />
      </Screen>
    );
  }
  return <SessionTargetResolver route={route} workspace={workspace} />;
}

const selectAssociation = (session: AgentSessionState | null): AgentSessionAssociation | null =>
  session?.sessionAssociation ?? null;
const selectPresent = (session: AgentSessionState | null): boolean => session !== null;

const toRecordsRead = (query: {
  data: Parameters<typeof resolveSessionOwner>[0]["activeChats"]["data"];
  error: Error | null;
  isPending: boolean;
  fetchStatus: "fetching" | "paused" | "idle";
}) => ({
  data: query.data,
  error: query.error ? errorMessage(query.error) : null,
  // A disabled query is pending without a fetch; it holds no answer.
  isPending: query.isPending && query.fetchStatus !== "idle",
});

/**
 * Finds the owner of the session: its task, its chat in the active or archived chats, or none.
 * The archived chats load only when the active chats do not hold the session.
 */
const useSessionOwnerResolution = ({
  identity,
  readOnly,
  workspaceId,
}: {
  identity: SessionTarget["identity"];
  readOnly: boolean;
  workspaceId: string;
}) => {
  const association = useSessionSelector(identity, selectAssociation, shallowEqual);
  const readModel = useAgentSessionReadModelStateContext();
  const lookUpChats = !readOnly && association?.kind !== "workflow";
  const activeChats = useQuery({
    ...workspaceSessionListQueryOptions(workspaceId, false),
    enabled: lookUpChats,
  });
  const activeRead = toRecordsRead(activeChats);
  const inActive = findChatRecord(activeRead.data, identity) !== null;
  const archivedChats = useQuery({
    ...workspaceSessionListQueryOptions(workspaceId, true),
    enabled: lookUpChats && activeChats.isSuccess && !inActive,
  });
  const resolution = resolveSessionOwner({
    identity,
    readOnly,
    association,
    readModelLoadState: readModel.sessionReadModelLoadState,
    activeChats: activeRead,
    archivedChats: toRecordsRead(archivedChats),
  });
  const { refetch: refetchActive } = activeChats;
  const { refetch: refetchArchived } = archivedChats;
  const { reloadSessionReadModel } = readModel;
  const retry = useCallback(() => {
    void refetchActive();
    void refetchArchived();
    reloadSessionReadModel();
  }, [refetchActive, refetchArchived, reloadSessionReadModel]);
  return { resolution, retry };
};

/**
 * The work owner of a resolved session. The chat record changes on each message and on idle, so
 * the work owner reads only the stable fields of the owner. A new work owner would render every
 * transcript row again.
 */
const useResolvedWorkOwner = (
  resolution: SessionOwnerResolution,
  workspaceId: string,
  identity: SessionTarget["identity"],
) => {
  const owner = resolution.status === "ready" ? resolution.owner : null;
  const ownerKind = owner?.kind ?? null;
  const ownerTaskId = owner?.kind === "task" ? owner.taskId : null;
  return useMemo(() => {
    if (ownerKind === null) return null;
    const source: WorkOwnerSource =
      ownerTaskId === null
        ? { kind: ownerKind === "chat" ? "chat" : "none" }
        : { kind: "task", taskId: ownerTaskId };
    return workOwnerParamsFor(workspaceId, source, identity);
  }, [identity, ownerKind, ownerTaskId, workspaceId]);
};

function SessionTargetResolver({
  route,
  workspace,
}: {
  route: SessionRoute;
  workspace: WorkspaceRecord;
}): ReactElement {
  const identity = useStableAgentSessionIdentity(route.identity);
  if (!identity) throw new Error("The session route always names a session identity.");
  const { readOnly } = route;
  const { resolution, retry } = useSessionOwnerResolution({
    identity,
    readOnly,
    workspaceId: workspace.workspaceId,
  });
  const workOwner = useResolvedWorkOwner(resolution, workspace.workspaceId, identity);

  const target = useMemo<SessionTarget | null>(() => {
    if (resolution.status !== "ready") return null;
    return {
      workspace,
      repoPath: workspace.repoPath,
      identity,
      sessionKey: agentSessionIdentityKey(identity),
      readOnly,
      owner: resolution.owner,
      sessionAssociation: resolution.sessionAssociation,
      sessionScope: resolution.sessionScope,
      workOwner,
    };
  }, [identity, readOnly, resolution, workOwner, workspace]);

  if (!target) return <SessionResolutionState resolution={resolution} onRetry={retry} />;
  // A switch to another session of the task keeps this screen, so the view of each session starts
  // with its own state.
  return (
    <SessionScreenContent
      key={target.sessionKey}
      target={target}
      focusPendingInput={route.focusPendingInput}
    />
  );
}

/** The session screen while the owner of the session loads, or after its read failed. */
function SessionResolutionState({
  resolution,
  onRetry,
}: {
  resolution: SessionOwnerResolution;
  onRetry: () => void;
}): ReactElement {
  return (
    <Screen>
      <Stack.Screen options={{ title: SESSION_TITLE }} />
      {resolution.status === "error" ? (
        <ErrorState
          title={resolution.title}
          message={resolution.message}
          onRetry={resolution.canRetry ? onRetry : undefined}
        />
      ) : (
        <TranscriptSkeleton
          label={resolution.status === "loading" ? resolution.label : "Loading"}
        />
      )}
    </Screen>
  );
}

function SessionScreenContent({
  target,
  focusPendingInput,
}: {
  target: SessionTarget;
  focusPendingInput: boolean;
}): ReactElement {
  const gate = useCommandGate();
  const readModel = useAgentSessionReadModelStateContext();
  const readiness = useRuntimeReadiness({
    hasWorkspace: true,
    runtimeTarget: runtimeReadinessTargetForRuntime(target.identity.runtimeKind),
  });
  // The hook returns a new object on each render. Keep one per value, so context readers stay put.
  const runtimeReadiness = useMemo(
    () => ({
      state: readiness.state,
      message: readiness.message,
      isLoadingChecks: readiness.isLoadingChecks,
      refreshChecks: readiness.refreshChecks,
    }),
    [readiness.isLoadingChecks, readiness.message, readiness.refreshChecks, readiness.state],
  );
  const sessionPresent = useSessionSelector(target.identity, selectPresent, Object.is);
  const readModelState = readModel.sessionReadModelLoadState;
  const readModelReady = readModelState.kind === "ready";
  const preparation = useSessionPreparation(
    target,
    gate.open && sessionPresent && readModelReady && runtimeReadiness.state === "ready",
  );
  const faultMessage = readModel.getSessionFault(target.identity)?.message ?? null;
  const { canInteract, blockedReason, isPreparing, reasonShown } = resolveSessionInteraction({
    readOnly: target.readOnly,
    archived: target.owner.kind === "chat" && target.owner.record.archivedAt !== null,
    gateOpen: gate.open,
    runtimeReadiness,
    readModelReady,
    readModelFailure: readModelState.kind === "failed" ? readModelState.message : null,
    sessionPresent,
    faultMessage,
    preparation,
  });
  const interaction = useMemo<SessionInteraction>(
    () => ({ canInteract, blockedReason, isPreparing, reasonShown, runtimeReadiness }),
    [blockedReason, canInteract, isPreparing, reasonShown, runtimeReadiness],
  );
  return (
    <SessionScreenProvider
      target={target}
      interaction={interaction}
      focusPendingInput={focusPendingInput}
    >
      <SessionForkProvider>
        <SessionView />
      </SessionForkProvider>
    </SessionScreenProvider>
  );
}
