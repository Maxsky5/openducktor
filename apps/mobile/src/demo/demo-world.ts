import type {
  AgentSessionRecord,
  CustomAgentRole,
  GitTargetBranch,
  PullRequest,
  RepoConfig,
  SourceIssue,
  TaskRecordData,
  WorkspaceRecord,
} from "@openducktor/contracts";
import type { DemoClock } from "./demo-clock";
import type { DemoEvents } from "./demo-host-connection";
import type { DemoFile, DemoRepository } from "./demo-repository";
import type { DemoTerminalAction } from "./demo-terminals";

/** One host instance for every demo read, so the views see one consistent host. */
export const DEMO_HOST_INSTANCE_ID = "demo-host";

export type DemoDocumentCode = "spec" | "plan" | "qaReport";

export type DemoDocument = {
  markdown: string;
  updatedAt: string;
  revision: number;
  verdict?: "approved" | "rejected";
};

/** A free artifact of a task, such as a design preview. */
export type DemoFreeArtifact = {
  code: string;
  name: string;
  fileName: string;
  mediaType: string;
  base64: string;
  updatedAt: string;
};

export type DemoTask = {
  record: TaskRecordData;
  documents: Partial<Record<DemoDocumentCode, DemoDocument>>;
  freeArtifacts: DemoFreeArtifact[];
  /** The worktree of the task, once a role run created it. */
  worktree: { workingDirectory: string; branch: string } | null;
  /** The title and description of the linked pull request. */
  pullRequestDraft?: { title: string; body: string };
};

/** What the task commands ask of the sessions of a task. */
export type DemoTaskSessionHooks = {
  /** Stops the runs of the sessions of a task, without their outcomes. */
  stopTaskSessions(workspace: DemoWorkspace, taskId: string): void;
  /**
   * Stops and removes the sessions of a task, as a task reset does. With `roles`, only the
   * sessions of these roles go.
   */
  forgetTaskSessions(workspace: DemoWorkspace, taskId: string, roles?: readonly string[]): void;
  taskSessionRecords(workspace: DemoWorkspace, taskId: string): AgentSessionRecord[];
  runningTaskSessionCount(workspace: DemoWorkspace, taskId: string): number;
  /** The active chats that work in a folder. */
  chatsInFolder(workspace: DemoWorkspace, folder: string): { sessionId: string; title: string }[];
};

export type DemoWorkspace = {
  record: WorkspaceRecord;
  repoConfig: RepoConfig;
  repository: DemoRepository;
  tasks: Map<string, DemoTask>;
  issues: SourceIssue[];
  /** The scripted output of the repository actions, by action ID. */
  actionOutput: ReadonlyMap<string, DemoTerminalAction>;
  /** The worktree folder of new task and chat worktrees. */
  worktreeRoot: string;
  defaultTargetBranch: GitTargetBranch;
};

/** The images that the demo serves for task descriptions and attachments, by ID or path. */
export type DemoResources = Map<string, { mime: string; base64: string }>;

/** The shared state of one demo session. Each module reads and changes it. */
export type DemoWorld = {
  readonly clock: DemoClock;
  readonly events: DemoEvents;
  readonly workspaces: Map<string, DemoWorkspace>;
  readonly resources: DemoResources;
  /** The custom agent roles of the New Session sheet. */
  readonly customRoles: CustomAgentRole[];
  /** Set once the session engine exists. */
  sessions: DemoTaskSessionHooks;
  /** The tasks whose session waits for its worktree setup. A worktree reset waits for them. */
  readonly startingTasks: Set<DemoTask>;
  /** The PR numbers that the demo gives out. */
  nextPullRequestNumber: number;
  /** A number that the demo never gives out twice, for staged file IDs. */
  nextNumber(): number;
};

export const findWorkspace = (world: DemoWorld, workspaceId: string): DemoWorkspace => {
  const workspace = world.workspaces.get(workspaceId);
  if (!workspace) throw new Error(`The demo has no workspace ${workspaceId}. Reset the demo.`);
  return workspace;
};

export const findWorkspaceByRepo = (world: DemoWorld, repoPath: string): DemoWorkspace => {
  for (const workspace of world.workspaces.values()) {
    if (workspace.record.repoPath === repoPath) return workspace;
  }
  throw new Error(`The demo has no repository at ${repoPath}. Reset the demo.`);
};

export const findTask = (workspace: DemoWorkspace, taskId: string): DemoTask => {
  const task = workspace.tasks.get(taskId);
  if (!task) throw new Error("This task is no longer in the demo. Refresh the board.");
  return task;
};

/** A UUID made from a counter, so the demo needs no random source. */
export const demoUuid = (value: number): string =>
  `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;

export type DemoPullRequest = PullRequest;
export type { DemoFile };
