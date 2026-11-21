import type { WorkspaceRecord, WorkspaceRef } from "@openducktor/contracts";
import type { ResolvedTaskCard as TaskCard } from "@openducktor/workflows";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useDeferredValue, useMemo } from "react";
import {
  useActiveWorkspaceContext,
  useRequiredContext,
  WorkspaceScopeContext,
} from "../../app-state/app-state-contexts";
import { repoTaskDataQueryOptions } from "../../queries/tasks";
import type { ActiveWorkspace } from "../../types/session-slices";
import type { TaskCreateWorkspace } from "../../types/state-slices";
import { collectKnownLabels } from "./task-composer-options";
import { type RetainedTaskWorkspace, taskEditorDraftKey } from "./task-editor-drafts";

/**
 * The workspace of the form. Edit task saves only there. New task starts there, and the user can
 * pick another open workspace.
 */
export type TaskCreateDestination = {
  workspaceId: string;
  workspaceName: string;
  repoPath?: string;
};

/**
 * What the form saves to. Edit task saves in the workspace of the task. New task saves in its
 * chosen workspace; `closedWorkspaceName` is set while that workspace is closed.
 */
type TaskEditorTarget =
  | { mode: "edit"; destinationError: string | null }
  | {
      mode: "create";
      workspace: RetainedTaskWorkspace | null;
      closedWorkspaceName: string | null;
    };

type ResolvedTaskEditorWorkspace = {
  workspaceId: string | null;
  workspaceName: string | null;
  workspaceRepoPath: string | null;
  draftKey: string | null;
  /** The workspace that stages description images. */
  imageWorkspaceId: string | null;
  target: TaskEditorTarget;
};

/** Edit task saves through the active workspace, so it blocks a save from another workspace. */
const resolveEditWorkspace = (
  task: TaskCard,
  destination: TaskCreateDestination | null,
  activeWorkspace: ActiveWorkspace | null,
): ResolvedTaskEditorWorkspace => {
  const workspaceId = destination?.workspaceId ?? activeWorkspace?.workspaceId ?? null;
  const isOtherWorkspace =
    destination !== null &&
    (destination.workspaceId !== activeWorkspace?.workspaceId ||
      (destination.repoPath !== undefined && destination.repoPath !== activeWorkspace?.repoPath));
  return {
    workspaceId,
    workspaceName: destination?.workspaceName ?? activeWorkspace?.workspaceName ?? null,
    workspaceRepoPath: destination?.repoPath ?? activeWorkspace?.repoPath ?? null,
    draftKey: workspaceId === null ? null : taskEditorDraftKey(workspaceId, task.id),
    imageWorkspaceId: workspaceId,
    target: {
      mode: "edit",
      destinationError: isOtherWorkspace
        ? `This task is for ${destination.workspaceName}. Open ${destination.workspaceName} again to save this task.`
        : null,
    },
  };
};

/**
 * New task keeps one draft under the workspace that it opened in, so a workspace change or a
 * closed workspace keeps the typed fields and leaves the drafts of other workspaces alone. Its
 * images stay in the chosen workspace while that workspace is closed, until the user reopens the
 * workspace or removes them.
 */
const resolveCreateWorkspace = (
  destination: TaskCreateDestination | null,
  workspacePick: RetainedTaskWorkspace | null,
  workspaces: WorkspaceRecord[],
): ResolvedTaskEditorWorkspace => {
  const workspace = workspacePick ?? destination;
  const open = workspaces.find(({ workspaceId }) => workspaceId === workspace?.workspaceId);
  return {
    workspaceId: open?.workspaceId ?? null,
    workspaceName: open?.workspaceName ?? null,
    workspaceRepoPath: open?.repoPath ?? null,
    draftKey: destination === null ? null : taskEditorDraftKey(destination.workspaceId, null),
    imageWorkspaceId: workspace?.workspaceId ?? null,
    target: {
      mode: "create",
      workspace,
      closedWorkspaceName: workspace !== null && !open ? workspace.workspaceName : null,
    },
  };
};

/** The workspace of the form, its draft key, and what the form saves to. */
export function useTaskEditorWorkspace({
  task,
  destination,
  workspacePick,
}: {
  task: TaskCard | null;
  destination: TaskCreateDestination | null;
  workspacePick: RetainedTaskWorkspace | null;
}) {
  const { activeWorkspace } = useActiveWorkspaceContext();
  const { workspaces } = useRequiredContext(WorkspaceScopeContext, "useTaskCreateModalController");
  const resolved = task
    ? resolveEditWorkspace(task, destination, activeWorkspace)
    : resolveCreateWorkspace(destination, workspacePick, workspaces);
  const { workspaceId, workspaceName, workspaceRepoPath } = resolved;
  const workspaceScope: WorkspaceRef | null =
    workspaceId && workspaceRepoPath ? { workspaceId, repoPath: workspaceRepoPath } : null;
  /** The workspace that a save writes to. Queries use `workspaceScope`, which has no name. */
  const saveWorkspace: TaskCreateWorkspace | null =
    workspaceScope && workspaceName !== null ? { ...workspaceScope, workspaceName } : null;
  return { ...resolved, activeWorkspace, workspaces, workspaceScope, saveWorkspace };
}

/** The workspace picker of New task, as both platforms show it. */
export type TaskCreateWorkspacePicker = {
  /** The chosen workspace. It can be closed. */
  target: RetainedTaskWorkspace | null;
  /** The open record of the chosen workspace, or null while it is closed. */
  selected: WorkspaceRecord | null;
  /** The open workspaces that New task can create the task in. */
  choices: WorkspaceRecord[];
  /** True when the picker can switch to another open workspace. */
  canChange: boolean;
  /** True while a save runs, an image uploads, or a partial save waits for a refresh. */
  isLocked: boolean;
  /** Why the workspace cannot change. Remove images clears it. */
  blockedReason: string | null;
  select: (workspaceId: string) => void;
  removeImages: () => void;
};

/** The picker of New task, null in Edit task, and the destination error of the form. */
type TaskCreateWorkspacePickerState = {
  workspacePicker: TaskCreateWorkspacePicker | null;
  destinationError: string | null;
};

const createWorkspaceError = (
  closedWorkspaceName: string | null,
  hasImages: boolean,
): string | null => {
  if (closedWorkspaceName === null) return null;
  if (hasImages)
    return `${closedWorkspaceName} is closed. Reopen it, or remove the description images to pick another workspace.`;
  return `${closedWorkspaceName} is closed. Reopen it or pick another workspace to create this task.`;
};

/**
 * The workspace picker of New task, and the destination error of the form.
 * - A staged image that the description uses belongs to one workspace, so it fixes the workspace
 *   until the user removes it.
 * - A partial save needs a refresh first, so the picker and Remove images stay off, and the hint
 *   that names Remove images does not show.
 */
export function useTaskCreateWorkspacePicker({
  target,
  workspaceId,
  workspaces,
  description,
  stagedImages,
  collectAssetIds,
  removeAssetImages,
  isBusy,
  isRecoveryBlocked,
  onPick,
  onDescriptionChange,
}: {
  target: TaskEditorTarget;
  workspaceId: string | null;
  workspaces: WorkspaceRecord[];
  description: string;
  /** The previews of the staged images, by asset ID. */
  stagedImages: ReadonlyMap<string, string>;
  collectAssetIds: (markdown: string) => Set<string>;
  removeAssetImages: (markdown: string, assetIds: ReadonlySet<string>) => string;
  isBusy: boolean;
  isRecoveryBlocked: boolean;
  onPick: (workspace: WorkspaceRecord) => void;
  onDescriptionChange: (description: string) => void;
}): TaskCreateWorkspacePickerState {
  const isCreate = target.mode === "create";
  // The staged images that a description uses. It parses only while images are staged.
  const usedImages = useCallback(
    (markdown: string): Set<string> => {
      if (!isCreate || stagedImages.size === 0) return new Set();
      const referenced = collectAssetIds(markdown);
      return new Set(Array.from(stagedImages.keys()).filter((id) => referenced.has(id)));
    },
    [collectAssetIds, isCreate, stagedImages],
  );
  // The lock and its hint read a deferred description, so a keystroke does not wait for the
  // parse. The actions read the current description.
  const deferredDescription = useDeferredValue(description);
  const hasImages = useMemo(
    () => usedImages(deferredDescription).size > 0,
    [deferredDescription, usedImages],
  );
  if (target.mode === "edit")
    return { workspacePicker: null, destinationError: target.destinationError };

  const isLocked = isBusy || isRecoveryBlocked;
  const canChange =
    !isLocked &&
    !hasImages &&
    workspaces.some((workspace) => workspace.workspaceId !== workspaceId);
  const workspacePicker: TaskCreateWorkspacePicker = {
    target: target.workspace,
    selected: workspaces.find((workspace) => workspace.workspaceId === workspaceId) ?? null,
    choices: workspaces,
    canChange,
    isLocked,
    blockedReason:
      hasImages && !isRecoveryBlocked ? "Description images belong to this workspace." : null,
    select: (nextWorkspaceId) => {
      if (!canChange || nextWorkspaceId === workspaceId) return;
      if (usedImages(description).size > 0) return;
      const next = workspaces.find((workspace) => workspace.workspaceId === nextWorkspaceId);
      if (next) onPick(next);
    },
    removeImages: () => {
      if (isLocked) return;
      const imageIds = usedImages(description);
      if (imageIds.size > 0) onDescriptionChange(removeAssetImages(description, imageIds));
    },
  };
  return {
    workspacePicker,
    destinationError: createWorkspaceError(target.closedWorkspaceName, hasImages),
  };
}

const NO_WORKSPACE: WorkspaceRef = { workspaceId: "__disabled__", repoPath: "__disabled__" };

/**
 * The labels that the label field suggests: the labels of the tasks in the workspace of the form.
 * New task reads the task list of its chosen workspace, which the task stream keeps current for
 * each open workspace. Edit task uses the tasks of its board.
 */
export function useKnownTaskLabels({
  open,
  task,
  tasks,
  workspaceScope,
}: {
  open: boolean;
  task: TaskCard | null;
  tasks: TaskCard[];
  workspaceScope: WorkspaceRef | null;
}): string[] {
  const createScope = open && !task ? workspaceScope : null;
  const createTasks = useQuery({
    ...repoTaskDataQueryOptions(createScope ?? NO_WORKSPACE),
    enabled: createScope !== null,
  });
  const labelTasks = task ? tasks : createTasks.data?.tasks;
  return useMemo(() => collectKnownLabels(labelTasks ?? []), [labelTasks]);
}
