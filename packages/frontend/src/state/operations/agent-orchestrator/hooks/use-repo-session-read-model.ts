import {
  type AgentSessionLiveEnvelope,
  agentSessionLiveEnvelopeSchema,
} from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import type { QueryClient } from "@tanstack/react-query";
import type { MutableRefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BROWSER_LIVE_RECONNECTED_EVENT_KIND,
  BROWSER_LIVE_STREAM_WARNING_EVENT_KIND,
} from "@/lib/browser-live/constants";
import { isBrowserLiveControlEvent } from "@/lib/browser-live-control-events";
import { errorMessage } from "@/lib/errors";
import type { HostLiveEventSubscription } from "@/lib/shell-bridge";
import type { AgentSessionsStore } from "@/state/agent-sessions-store";
import { runtimeCatalogQueryKeys } from "@/state/queries/runtime-catalog";
import {
  type AgentSessionReadModelLoadState,
  currentAgentSessionReadModelLoadState,
  failedAgentSessionReadModelLoadState,
  loadingAgentSessionReadModelLoadState,
  readyAgentSessionReadModelLoadState,
  unavailableAgentSessionReadModelLoadState,
} from "@/types/agent-session-read-model";
import type { AgentSessionTranscriptEventConsumer } from "../events/session-transcript-events";
import {
  applyAgentSessionLiveDelta,
  buildAgentSessionLiveCollection,
} from "../session-read-model/agent-session-live-projection";
import {
  collectPendingApprovalPolicyActions,
  type PendingApprovalPolicyAction,
} from "../session-read-model/pending-approval-policy";
import { useTaskSessionRecords } from "../session-read-model/use-task-session-records";
import { runOrchestratorSideEffect } from "../support/async-side-effects";
import { createRepoStaleGuard } from "../support/core";

export type AgentSessionLiveFrontendPort = Pick<
  HostClient,
  "agentSessionLiveAttach" | "agentSessionLiveDetach" | "agentSessionLiveReplyApproval"
> & {
  subscribeAgentSessionLiveEvents: (
    listener: (payload: unknown) => void,
  ) => Promise<HostLiveEventSubscription>;
};

type UseRepoSessionReadModelArgs = {
  workspaceRepoPath: string | null;
  taskIds: string[];
  isLoadingTasks: boolean;
  currentWorkspaceRepoPathRef: MutableRefObject<string | null>;
  repoEpochRef: MutableRefObject<number>;
  commitSessionCollection: AgentSessionsStore["commitSessionCollection"];
  liveSessionPort: AgentSessionLiveFrontendPort;
  transcriptEvents: AgentSessionTranscriptEventConsumer;
  queryClient: QueryClient;
};

export type RepoSessionReadModelState = {
  sessionReadModelLoadState: AgentSessionReadModelLoadState;
  reloadSessionReadModel: () => void;
};

const createAttachmentId = (transportEpoch: string): string =>
  `${transportEpoch}:${crypto.randomUUID()}`;

export const useRepoSessionReadModel = ({
  workspaceRepoPath,
  taskIds,
  isLoadingTasks,
  currentWorkspaceRepoPathRef,
  repoEpochRef,
  commitSessionCollection,
  liveSessionPort,
  transcriptEvents,
  queryClient,
}: UseRepoSessionReadModelArgs): RepoSessionReadModelState => {
  const [sessionReadModelLoadState, setSessionReadModelLoadState] =
    useState<AgentSessionReadModelLoadState>(unavailableAgentSessionReadModelLoadState);
  const [reloadGeneration, setReloadGeneration] = useState(0);
  const latestReloadGenerationRef = useRef(reloadGeneration);
  latestReloadGenerationRef.current = reloadGeneration;
  const reloadSessionReadModel = useCallback(() => {
    setReloadGeneration((current) => current + 1);
  }, []);
  const currentSessionReadModelLoadState = useMemo(
    () =>
      currentAgentSessionReadModelLoadState({
        workspaceRepoPath,
        state: sessionReadModelLoadState,
      }),
    [sessionReadModelLoadState, workspaceRepoPath],
  );
  const taskSessionRecordsState = useTaskSessionRecords({
    repoPath: workspaceRepoPath,
    taskIds,
    enabled: !isLoadingTasks,
    queryClient,
  });

  useEffect(() => {
    if (!workspaceRepoPath || isLoadingTasks) {
      return;
    }
    if (taskSessionRecordsState.kind === "loading") {
      setSessionReadModelLoadState(loadingAgentSessionReadModelLoadState(workspaceRepoPath));
      return;
    }
    if (taskSessionRecordsState.kind === "failed") {
      setSessionReadModelLoadState(
        failedAgentSessionReadModelLoadState(
          workspaceRepoPath,
          `Failed to load task session records for repo '${workspaceRepoPath}': ${errorMessage(
            taskSessionRecordsState.error,
          )}`,
        ),
      );
      return;
    }

    const repoPath = workspaceRepoPath;
    const taskSessionRecords = taskSessionRecordsState.records;
    const isRepoStale = createRepoStaleGuard({
      repoPath,
      repoEpochRef,
      currentWorkspaceRepoPathRef,
    });
    const effectReloadGeneration = reloadGeneration;
    let cancelled = false;
    let subscription: HostLiveEventSubscription | null = null;
    let attachmentId: string | null = null;
    let transportEpoch: string | null = null;
    let awaitingInitialSnapshot = true;
    let attachmentCommand = Promise.resolve();
    const isStaleRepoOperation = (): boolean =>
      cancelled || isRepoStale() || latestReloadGenerationRef.current !== effectReloadGeneration;
    const failAttachment = (message: string): void => {
      if (!isStaleRepoOperation()) {
        setSessionReadModelLoadState(failedAgentSessionReadModelLoadState(repoPath, message));
      }
    };
    const applyPendingApprovalPolicy = (actions: PendingApprovalPolicyAction[]): void => {
      for (const action of actions) {
        runOrchestratorSideEffect(
          "agent-session-live-auto-reject-mutating-approval",
          liveSessionPort.agentSessionLiveReplyApproval(action.input),
          {
            tags: {
              repoPath,
              role: action.role,
              externalSessionId: action.input.externalSessionId,
              requestId: action.input.requestId,
            },
          },
        );
      }
    };
    const commitInitialSnapshot = (
      envelope: Extract<AgentSessionLiveEnvelope, { type: "snapshot" }>,
    ): void => {
      const policyActions = commitSessionCollection((current) => {
        const collection = buildAgentSessionLiveCollection({
          current,
          taskSessionRecords,
          snapshots: envelope.sessions,
        });
        return {
          collection,
          result: collectPendingApprovalPolicyActions({
            previous: current,
            next: collection,
            repoPath,
          }),
        };
      });
      applyPendingApprovalPolicy(policyActions);
      awaitingInitialSnapshot = false;
      if (!isStaleRepoOperation()) {
        setSessionReadModelLoadState(readyAgentSessionReadModelLoadState(repoPath));
      }
    };
    const applyEnvelope = (envelope: AgentSessionLiveEnvelope): void => {
      if (isStaleRepoOperation() || envelope.attachmentId !== attachmentId) {
        return;
      }
      if (envelope.type === "snapshot") {
        if (!awaitingInitialSnapshot) {
          failAttachment(
            `Live-session attachment '${envelope.attachmentId}' delivered more than one initial snapshot.`,
          );
          return;
        }
        commitInitialSnapshot(envelope);
        return;
      }
      if (awaitingInitialSnapshot) {
        failAttachment(
          `Live-session attachment '${envelope.attachmentId}' delivered '${envelope.type}' before its initial snapshot.`,
        );
        return;
      }
      if (envelope.type === "session_upsert" || envelope.type === "session_removed") {
        const policyActions = commitSessionCollection((current) => {
          const collection = applyAgentSessionLiveDelta({
            current,
            taskSessionRecords,
            envelope,
          });
          return {
            collection,
            result: collectPendingApprovalPolicyActions({
              previous: current,
              next: collection,
              repoPath,
            }),
          };
        });
        applyPendingApprovalPolicy(policyActions);
        return;
      }
      if (envelope.type === "transcript_event") {
        transcriptEvents.handle(envelope.event);
        return;
      }
      if (envelope.type === "catalog_invalidated") {
        const catalogScope =
          envelope.scope.workingDirectory === undefined
            ? {
                repoPath: envelope.scope.repoPath,
                runtimeKind: envelope.scope.runtimeKind,
              }
            : {
                repoPath: envelope.scope.repoPath,
                runtimeKind: envelope.scope.runtimeKind,
                workingDirectory: envelope.scope.workingDirectory,
              };
        runOrchestratorSideEffect(
          "agent-session-live-invalidate-skills",
          queryClient.invalidateQueries({
            queryKey: runtimeCatalogQueryKeys.repoSkillsScope(catalogScope),
          }),
          {
            tags: {
              repoPath: envelope.scope.repoPath,
              runtimeKind: envelope.scope.runtimeKind,
            },
          },
        );
        return;
      }
      if (envelope.type === "fault") {
        failAttachment(
          `Live-session observation failed${envelope.operation ? ` during ${envelope.operation}` : ""}: ${envelope.message}`,
        );
      }
    };
    const attach = async (nextAttachmentId: string): Promise<void> => {
      if (isStaleRepoOperation()) {
        return;
      }
      attachmentId = nextAttachmentId;
      awaitingInitialSnapshot = true;
      setSessionReadModelLoadState(loadingAgentSessionReadModelLoadState(repoPath));
      await liveSessionPort.agentSessionLiveAttach({ attachmentId: nextAttachmentId, repoPath });
    };
    const replaceAttachment = async (nextTransportEpoch: string): Promise<void> => {
      const previousAttachmentId = attachmentId;
      attachmentId = null;
      if (previousAttachmentId !== null) {
        await liveSessionPort.agentSessionLiveDetach({ attachmentId: previousAttachmentId });
      }
      if (isStaleRepoOperation()) {
        return;
      }
      transportEpoch = nextTransportEpoch;
      await attach(createAttachmentId(nextTransportEpoch));
    };
    const queueReattach = (nextTransportEpoch: string, reason: string): void => {
      attachmentCommand = attachmentCommand
        .then(() => replaceAttachment(nextTransportEpoch))
        .catch((error) => {
          failAttachment(
            `Failed to reattach live-session observation for repo '${repoPath}' after ${reason}: ${errorMessage(error)}`,
          );
        });
    };

    setSessionReadModelLoadState(loadingAgentSessionReadModelLoadState(repoPath));
    void liveSessionPort
      .subscribeAgentSessionLiveEvents((payload) => {
        if (isStaleRepoOperation()) {
          return;
        }
        if (isBrowserLiveControlEvent(payload)) {
          if (payload.kind === BROWSER_LIVE_RECONNECTED_EVENT_KIND) {
            queueReattach(payload.transportEpoch, "browser transport reconnect");
          } else if (
            payload.kind === BROWSER_LIVE_STREAM_WARNING_EVENT_KIND &&
            transportEpoch !== null
          ) {
            queueReattach(transportEpoch, payload.message ?? "browser stream warning");
          }
          return;
        }
        const parsed = agentSessionLiveEnvelopeSchema.safeParse(payload);
        if (!parsed.success) {
          failAttachment(`Received an invalid live-session event: ${errorMessage(parsed.error)}`);
          return;
        }
        applyEnvelope(parsed.data);
      })
      .then((nextSubscription) => {
        if (isStaleRepoOperation()) {
          nextSubscription.unsubscribe();
          return;
        }
        subscription = nextSubscription;
        transportEpoch = nextSubscription.transportEpoch;
        attachmentCommand = attach(createAttachmentId(nextSubscription.transportEpoch)).catch(
          (error) => {
            failAttachment(
              `Failed to attach live-session observation for repo '${repoPath}': ${errorMessage(error)}`,
            );
          },
        );
      })
      .catch((error) => {
        failAttachment(
          `Failed to subscribe to live-session events for repo '${repoPath}': ${errorMessage(error)}`,
        );
      });

    return () => {
      cancelled = true;
      subscription?.unsubscribe();
      transcriptEvents.close();
      runOrchestratorSideEffect(
        "agent-session-live-detach",
        attachmentCommand.then(async () => {
          const attachedId = attachmentId;
          attachmentId = null;
          if (attachedId !== null) {
            await liveSessionPort.agentSessionLiveDetach({ attachmentId: attachedId });
          }
        }),
        { tags: { repoPath } },
      );
    };
  }, [
    commitSessionCollection,
    currentWorkspaceRepoPathRef,
    isLoadingTasks,
    liveSessionPort,
    queryClient,
    reloadGeneration,
    repoEpochRef,
    taskSessionRecordsState,
    transcriptEvents,
    workspaceRepoPath,
  ]);

  return useMemo(
    () => ({
      sessionReadModelLoadState: currentSessionReadModelLoadState,
      reloadSessionReadModel,
    }),
    [currentSessionReadModelLoadState, reloadSessionReadModel],
  );
};
