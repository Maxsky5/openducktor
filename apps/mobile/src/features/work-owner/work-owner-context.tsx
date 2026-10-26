import type {
  GitCurrentBranch,
  GitTargetBranch,
  TaskCard,
  WorkspaceRecord,
  WorkspaceSession,
} from "@openducktor/contracts";
import {
  TasksStateContext,
  useActiveWorkspaceContext,
  useRequiredContext,
} from "@openducktor/frontend-core/app-state/app-state-contexts";
import type { InlineCommentOwner } from "@openducktor/frontend-core/drafts/inline-comment-owner";
import type { DiffDataState } from "@openducktor/frontend-core/git/contracts";
import type {
  GitRefresh,
  ManualRefresh,
} from "@openducktor/frontend-core/git/refresh/use-git-refresh";
import {
  type TaskGitContextMode,
  resolveTaskExecutionFileExplorerRoot,
  resolveTaskExecutionFileExplorerTargetBranch,
} from "@openducktor/frontend-core/git/task/task-worktree-paths";
import { useTaskGitPanel } from "@openducktor/frontend-core/git/task/use-task-git-panel";
import { useGitCommentDraftValidation } from "@openducktor/frontend-core/git/use-git-comment-draft-validation";
import { useWorkspaceSessionGit } from "@openducktor/frontend-core/git/workspace-session/use-workspace-session-git";
import { useWorkspaceSessionGitPanel } from "@openducktor/frontend-core/git/workspace-session/use-workspace-session-git-panel";
import { agentSessionListQueryOptions } from "@openducktor/frontend-core/queries/agent-sessions";
import { currentBranchQueryOptions } from "@openducktor/frontend-core/queries/git";
import {
  repoConfigQueryOptions,
  toRepoSettingsInput,
} from "@openducktor/frontend-core/queries/workspace";
import { workspaceSessionListQueryOptions } from "@openducktor/frontend-core/queries/workspace-sessions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useIsFocused } from "expo-router";
import {
  createContext,
  type PropsWithChildren,
  type ReactElement,
  use,
  useCallback,
  useMemo,
} from "react";
import { appStateVisibility } from "@/composition/app-visibility";
import { useFocusGitRefresh } from "./use-focus-git-refresh";
import {
  chatFeedbackTarget,
  type OwnerResolution,
  resolveChatOwner,
  taskFeedbackTarget,
  type WorkOwnerFeedbackTarget,
  workOwnerTitle,
} from "./work-owner-model";
import { type WorkOwnerRef, workOwnerRefKey } from "./work-owner-params";
import { useTaskOwnerResolution, useWorkspaceListRead } from "./use-task-owner-resolution";

/** The comparison branch choice of a work owner, as the desktop Git panel target control. */
export type WorkOwnerComparisonChoice = {
  target: GitTargetBranch | null;
  /** True for a chat in the repository root, which can compare with its tracked upstream. */
  allowUpstream: boolean;
  /** True when the choice sends a host command: a task saves its target branch. */
  command: boolean;
  /** What the choice changes. */
  hint: string;
  /** Applies the choice. A failure shows as a toast. */
  apply: (target: GitTargetBranch) => void;
};

/** The Git and file context of a work owner. */
type WorkOwnerGit = {
  diffData: DiffDataState;
  /** `repository` for a chat in the repository root, which compares with its upstream. */
  contextMode: TaskGitContextMode;
  /** The task worktree or chat directory, or null while it is unknown. */
  workingDirectory: string | null;
  /** True while the task worktree or the chat branch resolves, before files can read. */
  workingDirectoryPending: boolean;
  /** Why Git and files cannot read the directory, or null when they can or it still resolves. */
  workingDirectoryUnavailableReason: string | null;
  currentBranch: GitCurrentBranch | null;
  /** The label of the comparison target, such as `origin/main`. */
  targetBranch: string;
  /** The comparison branch choice, or null when this screen cannot change it. */
  comparisonChoice: WorkOwnerComparisonChoice | null;
  /** The checkout key of the file tree reads. */
  fileTreeBranchKey: string;
  /** The comparison reference of the file tree Git markers, or null for local markers only. */
  fileTreeTargetBranch: string | null;
  refresh: GitRefresh;
  manualRefresh: ManualRefresh;
};

/** A task or chat with the data that its work views share. */
export type WorkOwner = {
  ref: WorkOwnerRef;
  /** A stable key of the owner, for view state. */
  key: string;
  workspace: WorkspaceRecord;
  repoPath: string;
  title: string;
  task: TaskCard | null;
  record: WorkspaceSession | null;
  commentOwner: InlineCommentOwner;
  /** The agent that receives feedback and conflict requests. */
  recipientLabel: "Builder" | "agent";
  feedback: WorkOwnerFeedbackTarget;
  git: WorkOwnerGit;
};

export type WorkOwnerState =
  | { status: "loading"; label: string }
  | { status: "error"; title: string; message: string; retry: (() => void) | null }
  | { status: "ready"; owner: WorkOwner };

const WorkOwnerContext = createContext<WorkOwnerState | null>(null);

/**
 * The owner of the work views on this screen. Read it under `WorkOwnerProvider`. The state is
 * `loading` until the workspace and the task or chat load, and `error` when they cannot load.
 */
export const useWorkOwner = (): WorkOwnerState => {
  const state = use(WorkOwnerContext);
  if (!state) throw new Error("Work views need a WorkOwnerProvider for their task or chat.");
  return state;
};

export type WorkOwnerProviderProps = PropsWithChildren<{
  ownerRef: WorkOwnerRef;
  /**
   * True when the screen shows changes, so the local and branch diffs read while it has focus.
   * Other views read only the directory, the branch, and the comparison target.
   */
  diffs: boolean;
}>;

/**
 * Resolves a task or chat for its work views: the workspace and repository, the task worktree or
 * chat directory, the current and target branch, the Git reads, and the session for feedback.
 */
export function WorkOwnerProvider({
  ownerRef,
  diffs,
  children,
}: WorkOwnerProviderProps): ReactElement {
  return ownerRef.kind === "task" ? (
    <TaskOwnerSource ownerRef={ownerRef} diffs={diffs}>
      {children}
    </TaskOwnerSource>
  ) : (
    <ChatOwnerSource ownerRef={ownerRef} diffs={diffs}>
      {children}
    </ChatOwnerSource>
  );
}

const NO_REPO = "__no_workspace__";

const toOwnerState = <Owner,>(
  resolution: OwnerResolution<Owner>,
  retry: () => void,
): Exclude<WorkOwnerState, { status: "ready" }> | null => {
  if (resolution.status === "loading") return resolution;
  if (resolution.status === "error") {
    return {
      status: "error",
      title: resolution.title,
      message: resolution.message,
      retry: resolution.canRetry ? retry : null,
    };
  }
  return null;
};

type TaskOwnerRef = Extract<WorkOwnerRef, { kind: "task" }>;

/**
 * The Git reads of a task worktree for its work views: the diffs while `showsDiffs` is true, the
 * worktree, the branches, and the file tree root. Restored comments of files that left the diff
 * stop being sendable.
 */
const useTaskWorkGit = ({
  ownerRef,
  repoPath,
  task,
  commentOwner,
  showsDiffs,
}: {
  ownerRef: TaskOwnerRef;
  repoPath: string | null;
  task: TaskCard | null;
  commentOwner: InlineCommentOwner | null;
  showsDiffs: boolean;
}) => {
  const queryClient = useQueryClient();
  const repoConfig = useQuery({
    ...repoConfigQueryOptions(ownerRef.workspaceId),
    enabled: repoPath !== null,
  });
  const repoSettings = useMemo(
    () => (repoConfig.data ? toRepoSettingsInput(repoConfig.data) : null),
    [repoConfig.data],
  );
  const loadRepoSettings = useCallback(
    async () =>
      toRepoSettingsInput(
        await queryClient.fetchQuery({
          ...repoConfigQueryOptions(ownerRef.workspaceId),
          staleTime: 0,
        }),
      ),
    [ownerRef.workspaceId, queryClient],
  );
  const panel = useTaskGitPanel({
    repoPath: task ? repoPath : null,
    taskId: task?.id ?? null,
    contextMode: "worktree",
    sessionWorktreePath: null,
    viewKey: JSON.stringify([repoPath, ownerRef.taskId]),
    repositoryBranchKey: null,
    savedTarget: task?.targetBranch,
    savedTargetError: task?.targetBranchError ?? null,
    taskWorktreeVersion: task?.updatedAt ?? null,
    repoSettings,
    repoSettingsError: repoConfig.error,
    loadRepoSettings,
    isEnabled: showsDiffs && task !== null,
    resolveWorktree: true,
    hasSelectedTask: task !== null,
    refreshOnFocus: showsDiffs && task !== null,
    visibility: appStateVisibility,
  });
  const { diffData, worktree, targetBranchState, comparison } = panel;
  useGitCommentDraftValidation({
    commentOwner,
    targetBranch: comparison.resolvedTarget,
    comparisonUnavailableReason: diffData.comparisonUnavailableReason ?? null,
    scopeStatesByScope: diffData.scopeStatesByScope,
    loadedScopesByScope: diffData.loadedScopesByScope,
  });
  const fileRoot = resolveTaskExecutionFileExplorerRoot({
    workspaceRepoPath: repoPath,
    contextMode: "worktree",
    worktreePath: worktree.path,
    isWorktreeResolving: worktree.isResolving,
    worktreeError: worktree.error,
  });
  const worktreePending = fileRoot.rootPath === null && worktree.isResolving;
  const fileTreeTargetBranch = resolveTaskExecutionFileExplorerTargetBranch({
    contextMode: "worktree",
    targetBranch: diffData.comparisonReference ?? null,
    upstreamStatus: diffData.upstreamStatus,
    hasLoadedRepositoryStatus: diffData.loadedScopesByScope.uncommitted,
    targetBranchValidationError: targetBranchState.validationError,
  });
  return { panel, fileRoot, worktreePending, fileTreeTargetBranch };
};

/**
 * The target branch choice of a task. It saves the task target branch, as the desktop task Git
 * panel does. Task commands run in the selected workspace, so another workspace shows it read-only.
 */
const useTaskComparisonChoice = (
  ownerRef: TaskOwnerRef,
  target: GitTargetBranch | null,
): WorkOwnerComparisonChoice | null => {
  const { setTaskTargetBranch } = useRequiredContext(TasksStateContext, "TaskOwnerSource");
  const { activeWorkspace } = useActiveWorkspaceContext();
  const selected = activeWorkspace?.workspaceId === ownerRef.workspaceId;
  const { taskId } = ownerRef;
  return useMemo(
    () =>
      selected
        ? {
            target,
            allowUpstream: false,
            command: true,
            hint: "The task saves this target branch. The Builder merges into it.",
            apply: (next) => {
              // The task mutation shows its own failure toast.
              setTaskTargetBranch(taskId, next).catch(() => {});
            },
          }
        : null,
    [selected, setTaskTargetBranch, target, taskId],
  );
};

function TaskOwnerSource({
  ownerRef,
  diffs,
  children,
}: PropsWithChildren<{ ownerRef: TaskOwnerRef; diffs: boolean }>) {
  const focused = useIsFocused();
  const { resolution, repoPath, retry } = useTaskOwnerResolution(ownerRef);
  const resolved = resolution.status === "ready" ? resolution.owner : null;
  const task = resolved?.task ?? null;
  const { panel, fileRoot, worktreePending, fileTreeTargetBranch } = useTaskWorkGit({
    ownerRef,
    repoPath,
    task,
    commentOwner: resolved?.commentOwner ?? null,
    showsDiffs: diffs && focused,
  });
  const { diffData, worktree } = panel;
  useFocusGitRefresh({
    focused: diffs && focused && task !== null,
    loaded: diffData.loadedScopesByScope.uncommitted,
    refresh: panel.refresh,
  });
  const comparisonChoice = useTaskComparisonChoice(ownerRef, panel.comparison.target);
  const sessionsQuery = useQuery({
    ...agentSessionListQueryOptions(repoPath ?? NO_REPO, ownerRef.taskId),
    enabled: repoPath !== null && task !== null,
  });
  const { refetch: refetchSessions } = sessionsQuery;
  const retrySessions = useCallback(() => {
    void refetchSessions();
  }, [refetchSessions]);
  const feedback = useMemo(
    () =>
      taskFeedbackTarget(
        ownerRef.workspaceId,
        {
          data: sessionsQuery.data,
          error: sessionsQuery.error,
          isPending: sessionsQuery.isPending,
        },
        worktree.path,
        retrySessions,
      ),
    [
      ownerRef.workspaceId,
      retrySessions,
      sessionsQuery.data,
      sessionsQuery.error,
      sessionsQuery.isPending,
      worktree.path,
    ],
  );
  const state = useMemo<WorkOwnerState>(() => {
    if (!resolved) {
      return toOwnerState(resolution, retry) ?? { status: "loading", label: "Loading the task" };
    }
    return {
      status: "ready",
      owner: {
        ref: ownerRef,
        key: workOwnerRefKey(ownerRef),
        workspace: resolved.workspace,
        repoPath: resolved.workspace.repoPath,
        title: workOwnerTitle(resolved),
        task: resolved.task,
        record: null,
        commentOwner: resolved.commentOwner,
        recipientLabel: "Builder",
        feedback,
        git: {
          diffData,
          contextMode: "worktree",
          workingDirectory: fileRoot.rootPath,
          workingDirectoryPending: worktreePending,
          workingDirectoryUnavailableReason: worktreePending ? null : fileRoot.unavailableReason,
          currentBranch: panel.currentBranch,
          targetBranch: diffData.targetBranch,
          comparisonChoice,
          fileTreeBranchKey: diffData.branch ?? "__unknown_branch__",
          fileTreeTargetBranch,
          refresh: panel.refresh,
          manualRefresh: panel.manualRefresh,
        },
      },
    };
  }, [
    comparisonChoice,
    diffData,
    feedback,
    fileRoot.rootPath,
    fileRoot.unavailableReason,
    fileTreeTargetBranch,
    ownerRef,
    panel.currentBranch,
    panel.manualRefresh,
    panel.refresh,
    resolution,
    resolved,
    retry,
    worktreePending,
  ]);
  return <WorkOwnerContext value={state}>{children}</WorkOwnerContext>;
}

function ChatOwnerSource({
  ownerRef,
  diffs,
  children,
}: PropsWithChildren<{ ownerRef: Extract<WorkOwnerRef, { kind: "chat" }>; diffs: boolean }>) {
  const workspaces = useWorkspaceListRead();
  const recordsQuery = useQuery(workspaceSessionListQueryOptions(ownerRef.workspaceId));
  const resolution = useMemo(
    () =>
      resolveChatOwner(ownerRef, workspaces.read, {
        data: recordsQuery.data,
        error: recordsQuery.error,
        isPending: recordsQuery.isPending,
      }),
    [ownerRef, recordsQuery.data, recordsQuery.error, recordsQuery.isPending, workspaces.read],
  );
  const { refetch: refetchWorkspaces } = workspaces;
  const { refetch: refetchRecords } = recordsQuery;
  const retry = useCallback(() => {
    void refetchWorkspaces();
    void refetchRecords();
  }, [refetchRecords, refetchWorkspaces]);
  if (resolution.status !== "ready") {
    const state = toOwnerState(resolution, retry) ?? {
      status: "loading",
      label: "Loading the chat",
    };
    return <WorkOwnerContext value={state}>{children}</WorkOwnerContext>;
  }
  // The Git hooks need the saved chat, so they mount once it loads.
  return (
    <ChatGitSource
      ownerRef={ownerRef}
      diffs={diffs}
      workspace={resolution.owner.workspace}
      record={resolution.owner.record}
      commentOwner={resolution.owner.commentOwner}
      title={workOwnerTitle(resolution.owner)}
    >
      {children}
    </ChatGitSource>
  );
}

function ChatGitSource({
  ownerRef,
  diffs,
  workspace,
  record,
  commentOwner,
  title,
  children,
}: PropsWithChildren<{
  ownerRef: Extract<WorkOwnerRef, { kind: "chat" }>;
  diffs: boolean;
  workspace: WorkspaceRecord;
  record: WorkspaceSession;
  commentOwner: InlineCommentOwner;
  title: string;
}>): ReactElement {
  const focused = useIsFocused();
  const showsDiffs = diffs && focused;
  const isRepositoryRoot = record.executionTarget.kind === "local_repo_root";
  // The repository root uses the workspace checkout, as the desktop workspace branch does.
  const rootBranch = useQuery({
    ...currentBranchQueryOptions(workspace.repoPath),
    enabled: isRepositoryRoot,
  });
  const activeWorkspace = useMemo(
    () => ({
      workspaceId: workspace.workspaceId,
      workspaceName: workspace.workspaceName,
      repoPath: workspace.repoPath,
    }),
    [workspace.repoPath, workspace.workspaceId, workspace.workspaceName],
  );
  const sessionGit = useWorkspaceSessionGit({
    workspace: activeWorkspace,
    record,
    activeBranch: rootBranch.data ?? null,
    isSwitchingBranch: false,
    visibility: appStateVisibility,
  });
  const { branch, workingDirectory } = sessionGit;
  const panel = useWorkspaceSessionGitPanel({
    isVisible: showsDiffs,
    repoPath: workspace.repoPath,
    workspaceId: workspace.workspaceId,
    sessionId: record.id,
    git: sessionGit,
    visibility: appStateVisibility,
  });
  useFocusGitRefresh({
    focused: showsDiffs,
    loaded: panel.diffData.loadedScopesByScope.uncommitted,
    refresh: panel.refresh,
  });
  const { target, applyTarget } = sessionGit;
  const comparisonChoice = useMemo<WorkOwnerComparisonChoice>(
    () => ({
      target,
      allowUpstream: isRepositoryRoot,
      command: false,
      hint: "This choice applies only to this chat, until the app restarts.",
      apply: (next) => {
        void applyTarget(next);
      },
    }),
    [applyTarget, isRepositoryRoot, target],
  );
  const workingDirectoryPending = workingDirectory !== null && !branch.branchReady;
  const workingDirectoryUnavailableReason = workingDirectory
    ? null
    : "The selected working directory is unavailable.";
  const state = useMemo<WorkOwnerState>(
    () => ({
      status: "ready",
      owner: {
        ref: ownerRef,
        key: workOwnerRefKey(ownerRef),
        workspace,
        repoPath: workspace.repoPath,
        title,
        task: null,
        record,
        commentOwner,
        recipientLabel: "agent",
        feedback: chatFeedbackTarget(ownerRef),
        git: {
          diffData: {
            ...panel.diffData,
            isLoading: panel.diffData.isLoading || !branch.branchReady,
          },
          contextMode: isRepositoryRoot ? "repository" : "worktree",
          workingDirectory,
          workingDirectoryPending,
          workingDirectoryUnavailableReason,
          currentBranch: branch.currentBranch,
          targetBranch: panel.diffData.targetBranch,
          comparisonChoice,
          fileTreeBranchKey: branch.branchKey,
          fileTreeTargetBranch: panel.resolvedTarget,
          refresh: panel.refresh,
          manualRefresh: panel.manualRefresh,
        },
      },
    }),
    [
      branch.branchKey,
      branch.branchReady,
      branch.currentBranch,
      commentOwner,
      comparisonChoice,
      isRepositoryRoot,
      ownerRef,
      panel.diffData,
      panel.manualRefresh,
      panel.refresh,
      panel.resolvedTarget,
      record,
      title,
      workingDirectory,
      workingDirectoryPending,
      workingDirectoryUnavailableReason,
      workspace,
    ],
  );
  return <WorkOwnerContext value={state}>{children}</WorkOwnerContext>;
}
