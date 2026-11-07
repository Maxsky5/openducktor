import {
  type RuntimeKind,
  type TaskCard,
  taskCardSchema,
  taskRecordDataSchema,
  type WorkspaceRecord,
  type WorkspaceSession,
} from "@openducktor/contracts";
import { CHAT_TITLES } from "@openducktor/product-scenes/sample/chats";
import { TASKS as STORY_TASKS, type TaskKey } from "@openducktor/product-scenes/sample/tasks";
import {
  taskId,
  WORKSPACES as STORY_WORKSPACES,
  type WorkspaceName,
} from "@openducktor/product-scenes/sample/workspace";
import type { SessionNavigationEntry } from "@openducktor/frontend-core/sessions/navigation/session-navigation-read-model";
import {
  type SessionNavigationTarget,
  sessionNavigationTargetKey,
} from "@openducktor/frontend-core/sessions/navigation/session-navigation-target";
import {
  type ResolvedTaskCard,
  resolveWorkflowTaskCards,
  SPEC_PLAN_BUILD_BOARD,
  specPlanBuildWorkflow,
  type WorkflowRoleId,
  workflowReferenceKey,
  workflowRoleCatalog,
} from "@openducktor/workflows";

// Fixed sample data of the tour pictures: the fictional Fieldnotes notes app of the marketing
// website. The product scenes package owns the names, the ids, and the titles. The pictures read no
// app state and no user data.

/** The handler of each control in a picture. */
export const noop = (): void => {};

/** The fixed time of the samples, so relative times such as "3h" never change. */
export const SAMPLE_NOW = Date.UTC(2026, 0, 15, 12, 0, 0);

/** The time `minutesAgo` minutes before `now`, in milliseconds. */
export const sampleTime = (minutesAgo: number, now = SAMPLE_NOW): number =>
  now - minutesAgo * 60_000;

const SAMPLE_DATE = new Date(sampleTime(120)).toISOString();

const sampleWorkspace = (name: WorkspaceName): WorkspaceRecord => {
  const workspace = STORY_WORKSPACES.find((entry) => entry.name === name);
  if (!workspace) throw new Error(`The sample has no workspace "${name}".`);
  return {
    workspaceId: name,
    workspaceName: name,
    abbreviation: workspace.tile,
    tileColor: null,
    repoPath: `/code/${name}`,
    iconDataUrl: null,
    isActive: false,
    hasConfig: true,
    configuredWorktreeBasePath: null,
    defaultWorktreeBasePath: null,
    effectiveWorktreeBasePath: null,
  };
};

export const WORKSPACES = {
  fieldnotes: sampleWorkspace("fieldnotes"),
  fableApi: sampleWorkspace("fable-api"),
  designSystem: sampleWorkspace("design-system"),
} as const satisfies Record<string, WorkspaceRecord>;

const { fieldnotes, fableApi, designSystem } = WORKSPACES;

/** The workspaces of the rail, in rail order. */
export const WORKSPACE_LIST = [fieldnotes, fableApi, designSystem] as const;

type DocumentCode = "spec" | "plan" | "qaReport";

/** The host that serves the samples: the built-in workflow on the built-in board. */
const SAMPLE_HOST = "feature-tour";
const SAMPLE_CATALOG = {
  hostInstanceId: SAMPLE_HOST,
  roles: workflowRoleCatalog([specPlanBuildWorkflow]),
  workflows: new Map([
    [workflowReferenceKey(specPlanBuildWorkflow.reference), specPlanBuildWorkflow],
  ]),
};
const SAMPLE_WORKSPACE_WORKFLOWS = {
  hostInstanceId: SAMPLE_HOST,
  board: SPEC_PLAN_BUILD_BOARD,
  workflows: [specPlanBuildWorkflow.reference],
  newTaskWorkflow: specPlanBuildWorkflow.reference,
};

/**
 * A task card of the built-in workflow, as the app reads it from the host: the workflow
 * projection of the stored task, joined to its workflow and its board column. So the card has
 * the real next actions, steps, and state of its status and artifacts.
 */
export const sampleTaskCard = ({
  documents = [],
  ...fields
}: Pick<TaskCard, "id" | "title" | "issueType" | "status"> & {
  /** The workflow artifacts of the task. */
  documents?: readonly DocumentCode[];
}): ResolvedTaskCard => {
  const artifactSummary = specPlanBuildWorkflow.emptyArtifactSummary();
  for (const code of documents) {
    artifactSummary[code] =
      code === "qaReport"
        ? { present: true, verdict: "approved", updatedAt: SAMPLE_DATE }
        : { present: true, updatedAt: SAMPLE_DATE };
  }
  const task = taskRecordDataSchema.parse({
    ...fields,
    artifactSummary,
    updatedAt: SAMPLE_DATE,
    createdAt: SAMPLE_DATE,
  });
  const card = taskCardSchema.parse({ ...task, ...specPlanBuildWorkflow.project(task) });
  const [resolved] = resolveWorkflowTaskCards(SAMPLE_CATALOG, SAMPLE_WORKSPACE_WORKFLOWS, [card]);
  if (!resolved) throw new Error(`The sample task "${fields.id}" did not resolve.`);
  return resolved;
};

/** A task of the Fieldnotes workspace in `status`. */
const sampleTask = (
  key: TaskKey,
  status: ResolvedTaskCard["status"],
  documents: readonly DocumentCode[] = [],
): ResolvedTaskCard =>
  sampleTaskCard({
    id: taskId(key, fieldnotes.workspaceId),
    title: STORY_TASKS[key].title,
    issueType: STORY_TASKS[key].kind,
    status,
    documents,
  });

export const TASKS = {
  titles: sampleTask("h5w3", "spec_ready", ["spec"]),
  empty: sampleTask("p6d4", "in_progress"),
  wordCount: sampleTask("n2r6", "in_progress"),
  shortcut: sampleTask("k3x9", "in_progress", ["spec", "plan"]),
  focus: sampleTask("r9c2", "ai_review"),
  shortcutReview: sampleTask("k3x9", "human_review", ["spec", "plan", "qaReport"]),
} as const satisfies Record<string, ResolvedTaskCard>;

/** A session of the Fieldnotes workspace, last active `hoursAgo` hours before the sample clock. */
const sampleChat = (
  id: string,
  title: string,
  runtimeKind: RuntimeKind,
  hoursAgo: number,
): WorkspaceSession => ({
  id,
  runtimeKind,
  externalSessionId: null,
  executionTarget: { kind: "local_repo_root", workingDirectory: fieldnotes.repoPath },
  roleSnapshot: null,
  selectedModel: null,
  generatedTitle: null,
  manualTitle: title,
  targetBranch: null,
  createdAt: sampleTime((hoursAgo + 1) * 60),
  lastActivityAt: sampleTime(hoursAgo * 60),
  updatedAt: sampleTime(hoursAgo * 60),
  archivedAt: null,
});

/** The workspace of a sidebar session. */
const NAVIGATION_WORKSPACE: SessionNavigationEntry["workspace"] = {
  workspaceId: fieldnotes.workspaceId,
  workspaceName: fieldnotes.workspaceName,
  repoPath: fieldnotes.repoPath,
  abbreviation: fieldnotes.abbreviation,
  tileColor: fieldnotes.tileColor,
  iconDataUrl: fieldnotes.iconDataUrl ?? null,
};

/** The sidebar state of a task session: it runs, it waits for an answer, or it is done. */
type TaskSessionState = "running" | "question" | "done";

const WORKFLOW_TONES = {
  running: "in_progress",
  question: "waiting_input",
  done: "done",
} as const satisfies Record<TaskSessionState, SessionNavigationEntry["workflowTone"]>;

/** The sidebar entry of a task session. */
export type TaskSessionEntry = SessionNavigationEntry & {
  target: Extract<SessionNavigationTarget, { kind: "task_session" }>;
  context: Extract<SessionNavigationEntry["context"], { kind: "task" }>;
};

const taskSession = (
  task: ResolvedTaskCard,
  role: WorkflowRoleId,
  runtimeKind: RuntimeKind,
  state: TaskSessionState,
  minutesAgo: number,
): TaskSessionEntry => {
  const at = sampleTime(minutesAgo);
  const target: TaskSessionEntry["target"] = {
    kind: "task_session",
    workspaceId: fieldnotes.workspaceId,
    taskId: task.id,
    role,
    identity: {
      externalSessionId: `${task.id}-${role}`,
      runtimeKind,
      workingDirectory: fieldnotes.repoPath,
    },
  };
  return {
    key: sessionNavigationTargetKey(target),
    target,
    workspace: NAVIGATION_WORKSPACE,
    title: task.title,
    runtimeKind,
    workflowTone: WORKFLOW_TONES[state],
    attention: state === "question" ? [state] : [],
    status: state === "done" ? { kind: "settled", failed: false } : { kind: "running" },
    startedAt: at,
    time: { kind: "activity", at },
    fault: null,
    context: { kind: "task", task, sessions: [] },
  };
};

const chatSession = (session: WorkspaceSession): SessionNavigationEntry => {
  const target: SessionNavigationTarget = {
    kind: "workspace_session",
    workspaceId: fieldnotes.workspaceId,
    sessionId: session.id,
  };
  return {
    key: sessionNavigationTargetKey(target),
    target,
    workspace: NAVIGATION_WORKSPACE,
    title: session.manualTitle ?? "Session",
    runtimeKind: session.runtimeKind,
    workflowTone: null,
    attention: [],
    status: { kind: "settled", failed: false },
    startedAt: session.createdAt,
    time: { kind: "activity", at: session.lastActivityAt ?? session.createdAt },
    fault: null,
    context: { kind: "workspace", session },
  };
};

/** The sidebar sessions of the samples. */
export const SESSIONS = {
  emptyBuild: taskSession(TASKS.empty, "build", "codex", "question", 1),
  shortcutBuild: taskSession(TASKS.shortcut, "build", "codex", "running", 4),
  wordCountQuestion: taskSession(TASKS.wordCount, "build", "codex", "question", 1),
  focusQa: taskSession(TASKS.focus, "qa", "opencode", "running", 2),
  titlesSpec: taskSession(TASKS.titles, "spec", "codex", "done", 12),
  shortcutReviewBuild: taskSession(TASKS.shortcutReview, "build", "codex", "done", 8),
  tagsChat: chatSession(sampleChat("chat-tags", CHAT_TITLES.tags, "codex", 1)),
} as const satisfies Record<string, SessionNavigationEntry>;
