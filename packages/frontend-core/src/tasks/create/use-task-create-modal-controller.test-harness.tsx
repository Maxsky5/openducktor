/** The shared render harness of the New task and Edit task controller tests. */
import { createWireTaskCardFixture } from "../../test-support/shared-test-fixtures";
import type { ClientConnection } from "../../connection/client-connection";
import { workflowQueryKeys } from "../../queries/workflows";
import {
  builtinCompiledCatalogFixture,
  builtinWorkspaceWorkflowsFixture,
} from "../../test-support/workflow-fixtures";
import { type ResolvedTaskCard as TaskCard } from "@openducktor/workflows";
import "../../test-support/dom-environment";
import type { HostClient } from "@openducktor/host-client";
import { render } from "@testing-library/react";
import type { WorkspaceRecord } from "@openducktor/contracts";
import type { ReactElement, ReactNode } from "react";
import {
  ActiveWorkspaceContext,
  DocumentStateContext,
  TasksStateContext,
  WorkspaceScopeContext,
} from "../../app-state/app-state-contexts";
import { ClientConnectionProvider } from "../../connection/client-connection-react";
import { createFeedbackFake } from "../../test-support/feedback-fake";
import { createWorkspaceRecordFixture } from "../../test-support/shared-test-fixtures";
import { createTestClientConnection } from "../../test-support/test-client-connection";
import type { ActiveWorkspace } from "../../types/session-slices";
import type { DocumentStateContextValue, TasksStateContextValue } from "../../types/state-slices";
import { useTaskCreateModalController } from "./use-task-create-modal-controller";
import type { TaskCreateDestination } from "./use-task-create-workspace";

type TestImage = { name: string; type: string; size: number };

const activeWorkspace: ActiveWorkspace = {
  workspaceId: "workspace-1",
  workspaceName: "Workspace",
  repoPath: "/repo",
};
const activeWorkspaceState = { activeWorkspace, setActiveWorkspace: () => {} };

export const otherWorkspace: ActiveWorkspace = {
  workspaceId: "workspace-2",
  workspaceName: "Other workspace",
  repoPath: "/other-repo",
};
export const openWorkspaces: WorkspaceRecord[] = [activeWorkspace, otherWorkspace].map(
  (workspace) => createWorkspaceRecordFixture(workspace),
);

export const createDocumentState = (
  overrides: Partial<DocumentStateContextValue> = {},
): DocumentStateContextValue => ({
  loadDocument: async (_taskId, code) =>
    code === "spec"
      ? { markdown: "# Spec", updatedAt: "2026-07-25T10:00:00.000Z" }
      : { markdown: "", updatedAt: null },
  saveDocument: async () => ({ updatedAt: "2026-07-25T10:00:00.000Z" }),
  ...overrides,
});

const createTasksState = (
  updateTask: TasksStateContextValue["updateTask"],
  createTask: TasksStateContextValue["createTask"] = async () => {},
): TasksStateContextValue => ({
  tasksAreCurrent: true,
  isForegroundLoadingTasks: false,
  isRefreshingTasksInBackground: false,
  isLoadingTasks: false,
  detectingPullRequestTaskIds: new Set<string>(),
  linkingMergedPullRequestTaskId: null,
  unlinkingPullRequestTaskIds: new Set<string>(),
  pendingMergedPullRequest: null,
  tasks: [],
  refreshTasks: async () => {},
  syncPullRequests: async () => {},
  linkMergedPullRequest: async () => {},
  cancelLinkMergedPullRequest: () => {},
  unlinkPullRequest: async () => {},
  createTask,
  updateTask,
  setTaskTargetBranch: async () => {},
  deleteTask: async () => {},
  closeTask: async (taskId: string) => createWireTaskCardFixture({ id: taskId, status: "closed" }),
  removeTaskWorktree: async () => {},
  resetTaskImplementation: async (taskId: string) => createWireTaskCardFixture({ id: taskId }),
  resetTask: async (taskId: string) => createWireTaskCardFixture({ id: taskId }),
});

const readFileBase64 = async (_file: TestImage): Promise<string> => "AQID";
const createPreviewUrl = (file: TestImage): string => `preview:${file.name}`;
const revokePreviewUrl = (_url: string): void => {};
const collectAssetIds = (_markdown: string): Set<string> => new Set();
// The platform removes images with its Markdown parser. The tests drop each line with an asset.
const removeAssetImages = (markdown: string, assetIds: ReadonlySet<string>): string =>
  markdown
    .split("\n")
    .filter((line) => !Array.from(assetIds).some((assetId) => line.includes(assetId)))
    .join("\n");

export const specSavedAt = (updatedAt: string): TaskCard["artifactSummary"] => ({
  spec: { present: true, updatedAt },
  plan: { present: false },
  qaReport: { present: false },
});

type Controller = ReturnType<typeof useTaskCreateModalController<TestImage>>;

type RenderOptions = {
  task?: TaskCard | null;
  updateTask?: TasksStateContextValue["updateTask"];
  createTask?: TasksStateContextValue["createTask"];
  /** New task starts in the active workspace unless a test names another destination. */
  destination?: TaskCreateDestination | null;
  workspaces?: WorkspaceRecord[];
  initialTitle?: string;
  documentState?: DocumentStateContextValue;
  client?: Partial<HostClient>;
  connection?: ClientConnection;
  collectAssetIds?: (markdown: string) => Set<string>;
  revokePreviewUrl?: (url: string) => void;
};

export const renderController = ({
  task = null,
  updateTask = async () => {},
  createTask = async () => {},
  destination: requestedDestination,
  workspaces: initialWorkspaces = openWorkspaces,
  initialTitle = "",
  documentState = createDocumentState(),
  client = {},
  connection: providedConnection,
  collectAssetIds: readAssetIds = collectAssetIds,
  revokePreviewUrl: releasePreview = revokePreviewUrl,
}: RenderOptions = {}) => {
  let latest: Controller | null = null;
  const scopeOf = (workspaces: WorkspaceRecord[]) => ({
    workspaces,
    activeWorkspace: workspaces[0] ?? null,
  });
  let workspaceScope = scopeOf(initialWorkspaces);
  const tasksState = createTasksState(updateTask, createTask);
  let current = task;
  let isOpen = true;
  const destination =
    requestedDestination === undefined ? (task ? null : activeWorkspace) : requestedDestination;
  const feedback = createFeedbackFake();
  const connection = providedConnection ?? createTestClientConnection({ feedback, client });
  connection.queryClient.setQueryData(workflowQueryKeys.catalog, builtinCompiledCatalogFixture);
  for (const workspace of [activeWorkspace, otherWorkspace])
    connection.queryClient.setQueryData(
      workflowQueryKeys.workspace(workspace),
      builtinWorkspaceWorkflowsFixture,
    );

  const Probe = ({ current }: { current: TaskCard | null }): null => {
    latest = useTaskCreateModalController({
      open: isOpen,
      onOpenChange: () => {},
      tasks: current ? [current] : [],
      task: current,
      destination,
      initialTitle,
      readFileBase64,
      createPreviewUrl,
      revokePreviewUrl: releasePreview,
      collectAssetIds: readAssetIds,
      removeAssetImages,
    });
    return null;
  };

  const providers = (children: ReactNode): ReactElement => (
    <ClientConnectionProvider connection={connection}>
      <WorkspaceScopeContext.Provider value={workspaceScope}>
        <ActiveWorkspaceContext.Provider value={activeWorkspaceState}>
          <TasksStateContext.Provider value={tasksState}>
            <DocumentStateContext.Provider value={documentState}>
              {children}
            </DocumentStateContext.Provider>
          </TasksStateContext.Provider>
        </ActiveWorkspaceContext.Provider>
      </WorkspaceScopeContext.Provider>
    </ClientConnectionProvider>
  );

  const view = render(providers(<Probe current={current} />));
  return {
    feedback,
    connection,
    getController: (): Controller => {
      if (!latest) {
        throw new Error("Controller did not render.");
      }
      return latest;
    },
    replaceTask: (next: TaskCard): void => {
      current = next;
      view.rerender(providers(<Probe current={current} />));
    },
    setOpen: (next: boolean): void => {
      isOpen = next;
      view.rerender(providers(<Probe current={current} />));
    },
    setOpenWorkspaces: (next: WorkspaceRecord[]): void => {
      workspaceScope = scopeOf(next);
      view.rerender(providers(<Probe current={current} />));
    },
    unmount: view.unmount,
  };
};
