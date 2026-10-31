import { useRuntimeDefinitionsContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import { useWorkspaceChatSettings } from "@openducktor/frontend-core/queries/use-workspace-chat-settings";
import type { ToolPartSession } from "@openducktor/frontend-core/queries/agent-session-tool-part";
import type { ParentSessionRuntimeContext } from "@openducktor/frontend-core/sessions/transcript/subagent-session-key";
import { useRouter } from "expo-router";
import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import { useSessionTarget } from "@/features/session/session-target";
import type { HostDocumentKey } from "@/features/tasks/documents/document-rows";
import { useSessionRuntimeInfo } from "@/features/session/use-session-runtime-info";
import { routes } from "@/navigation/routes";
import type { FileLinkHandler } from "@/rich-content/markdown/markdown-view";
import { createRowStateStore } from "./transcript-row-state";
import type { TranscriptRowsContextValue } from "./transcript-rows-context";

/**
 * The live state that rows read: the streaming message and the pending input counts of
 * Subagent sessions. A change renders only the rows that read it.
 */
export const useRowState = (
  activeStreamingMessageId: string | null,
  subagentPendingCountBySessionKey: Readonly<Record<string, number>>,
) => {
  const [rowState] = useState(() => {
    const store = createRowStateStore();
    store.set(activeStreamingMessageId, subagentPendingCountBySessionKey);
    return store;
  });
  useLayoutEffect(() => {
    rowState.set(activeStreamingMessageId, subagentPendingCountBySessionKey);
  }, [activeStreamingMessageId, rowState, subagentPendingCountBySessionKey]);
  return rowState;
};

/** The session whose tool rows read the full details that compact history cut. */
export const useToolPartSession = (): ToolPartSession => {
  const { identity, repoPath, sessionScope } = useSessionTarget();
  return useMemo(
    () => ({ ...identity, repoPath, sessionScope }),
    [identity, repoPath, sessionScope],
  );
};

/** The session facts, the stores, and the actions that every transcript row reads. */
export const useTranscriptRowsContext = ({
  visibleRows,
  rowState,
  presentToolCall,
  onOpenSubagent,
  openFullView,
  beforeRowResize,
}: Pick<
  TranscriptRowsContextValue,
  | "visibleRows"
  | "rowState"
  | "presentToolCall"
  | "onOpenSubagent"
  | "openFullView"
  | "beforeRowResize"
>): TranscriptRowsContextValue => {
  const router = useRouter();
  const target = useSessionTarget();
  const { modelCatalog } = useSessionRuntimeInfo();
  const { runtimeDefinitions } = useRuntimeDefinitionsContext();
  const { chatSettings } = useWorkspaceChatSettings({ hasWorkspace: true });
  const { identity, repoPath, workOwner, owner, sessionScope, workspace } = target;

  const parentSession = useMemo<ParentSessionRuntimeContext>(() => {
    const context: ParentSessionRuntimeContext = {
      runtimeKind: identity.runtimeKind,
      workingDirectory: identity.workingDirectory,
    };
    if (sessionScope) context.sessionScope = sessionScope;
    return context;
  }, [identity, sessionScope]);
  const onFileLinkPress = useMemo<FileLinkHandler | undefined>(
    () => (workOwner ? (path) => router.push(routes.file(workOwner, path)) : undefined),
    [router, workOwner],
  );
  const onOpenTask = useCallback(
    (taskId: string) => router.push(routes.task(workspace.workspaceId, taskId)),
    [router, workspace.workspaceId],
  );
  const onOpenDocument = useMemo(
    () =>
      workOwner && "taskId" in workOwner
        ? (document: HostDocumentKey) =>
            router.push(routes.documents(workOwner.workspaceId, workOwner.taskId, document))
        : null,
    [router, workOwner],
  );
  const onOpenArtifact = useCallback(
    (artifactTaskId: string, code: string) =>
      router.push(routes.artifact(workspace.workspaceId, artifactTaskId, code)),
    [router, workspace.workspaceId],
  );
  const supportsImageGeneration =
    runtimeDefinitions.find((runtime) => runtime.kind === identity.runtimeKind)?.capabilities
      .optionalSurfaces.supportsImageGeneration === true;
  const taskId = owner.kind === "task" ? owner.taskId : null;
  return useMemo<TranscriptRowsContextValue>(
    () => ({
      parentSession,
      sessionRef: {
        repoPath,
        runtimeKind: identity.runtimeKind,
        workingDirectory: identity.workingDirectory,
        externalSessionId: identity.externalSessionId,
      },
      runtimeKind: identity.runtimeKind,
      workingDirectory: identity.workingDirectory,
      presentToolCall,
      modelCatalog,
      supportsImageGeneration,
      expandFileDiffsByDefault: chatSettings?.expandFileDiffsByDefault ?? true,
      // Transcript images never come from the source issue of the task.
      imageContext: taskId ? { workspaceId: workspace.workspaceId, taskId, issue: null } : null,
      visibleRows,
      rowState,
      onOpenSubagent,
      onOpenTask,
      onFileLinkPress,
      onOpenDocument,
      onOpenArtifact,
      openFullView,
      beforeRowResize,
    }),
    [
      beforeRowResize,
      chatSettings?.expandFileDiffsByDefault,
      identity,
      modelCatalog,
      onFileLinkPress,
      onOpenArtifact,
      onOpenDocument,
      onOpenSubagent,
      onOpenTask,
      openFullView,
      parentSession,
      presentToolCall,
      repoPath,
      rowState,
      supportsImageGeneration,
      taskId,
      visibleRows,
      workspace.workspaceId,
    ],
  );
};
