import type { SessionLaunchActionId } from "@openducktor/frontend-core/lib/session-launch-actions";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import type { ChangedFileGroup } from "@/features/review/changes-model";
import type { ChangesFocus } from "@/features/review/changes-view-state";

/**
 * Typed route builders. The root screen of each tab lives in the stack of its tab. Sessions,
 * tasks, and work views are pushed on the app stack above the tabs, so they cover the tab bar.
 */
export type SessionRouteParams = {
  workspaceId: string;
  externalSessionId: string;
  runtimeKind: string;
  workingDirectory: string;
  /** Opens a Subagent session as a Read-only Session View. */
  readOnly?: "1";
  /** Scrolls to the pending input of the session. */
  focus?: "pending-input";
  /** The title that the opening row shows, for the navigation bar of the first frame. */
  title?: string;
  /** The session belongs to a task, so its title opens the task. */
  task?: "1";
};

/** The owner of work views: a task, or a chat (Workspace Session). */
export type WorkOwnerParams =
  | { workspaceId: string; taskId: string }
  | {
      workspaceId: string;
      externalSessionId: string;
      runtimeKind: string;
      workingDirectory: string;
    };

export const sessionParams = (
  workspaceId: string,
  identity: AgentSessionIdentity,
): SessionRouteParams => ({
  workspaceId,
  externalSessionId: identity.externalSessionId,
  runtimeKind: identity.runtimeKind,
  workingDirectory: identity.workingDirectory,
});

/**
 * The params that open another session of the same task in the open session screen. A switch
 * between the sessions of one task is a switch between peers, so it plays no screen transition.
 * It clears the params that belong to the session that the screen showed before.
 */
export const switchedSessionParams = (workspaceId: string, identity: AgentSessionIdentity) => ({
  ...sessionParams(workspaceId, identity),
  readOnly: undefined,
  focus: undefined,
  title: undefined,
  task: undefined,
});

/**
 * The push options of a task workflow sheet. The sheet route stays single, so a fast second tap
 * does not push a second sheet.
 */
export const SINGLE_SHEET = { dangerouslySingular: true } as const;

export const routes = {
  sessions: () => ({ pathname: "/" }) as const,
  archivedChats: () => ({ pathname: "/archived-chats" }) as const,
  task: (workspaceId: string, taskId: string) =>
    ({ pathname: "/task/[workspaceId]/[taskId]", params: { workspaceId, taskId } }) as const,
  session: (params: SessionRouteParams) => ({ pathname: "/session", params }) as const,
  /** The Changes view, opened on the scope and the diff of `focus` when given. */
  changes: (owner: WorkOwnerParams, focus?: ChangesFocus) =>
    ({
      pathname: "/work/changes",
      params: focus ? { ...owner, scope: focus.scope, file: focus.path } : owner,
    }) as const,
  /** The File Diff of a changed file in its group, such as the Staged version. */
  diff: (owner: WorkOwnerParams, path: string, group: ChangedFileGroup) =>
    ({ pathname: "/work/diff", params: { ...owner, path, group } }) as const,
  /** The file browser of a work owner, at the repository root or in one folder. */
  files: (owner: WorkOwnerParams, dir?: string) =>
    ({ pathname: "/work/files", params: dir ? { ...owner, dir } : owner }) as const,
  file: (owner: WorkOwnerParams, path: string) =>
    ({ pathname: "/work/file", params: { ...owner, path } }) as const,
  /** The task documents, opened on `document` when given. */
  documents: (workspaceId: string, taskId: string, document?: "spec" | "plan" | "qa") =>
    ({
      pathname: "/work/documents",
      params: document ? { workspaceId, taskId, document } : { workspaceId, taskId },
    }) as const,
  /** The artifacts of a task: its workflow documents and its saved files. */
  artifacts: (workspaceId: string, taskId: string) =>
    ({ pathname: "/work/artifacts", params: { workspaceId, taskId } }) as const,
  /** One saved file of a task, by its stable code. */
  artifact: (workspaceId: string, taskId: string, code: string) =>
    ({ pathname: "/work/artifact", params: { workspaceId, taskId, code } }) as const,
  checks: (workspaceId: string, taskId: string) =>
    ({ pathname: "/work/checks", params: { workspaceId, taskId } }) as const,
  terminals: (owner: WorkOwnerParams) => ({ pathname: "/work/terminals", params: owner }) as const,
  terminal: (owner: WorkOwnerParams, terminalId: string) =>
    ({ pathname: "/work/terminal", params: { ...owner, terminalId } }) as const,
  hosts: () => ({ pathname: "/host" }) as const,
  diagnostics: () => ({ pathname: "/host/diagnostics" }) as const,
  // Sheets above the tabs.
  workspaceSwitcher: () => ({ pathname: "/workspace-switcher" }) as const,
  newTask: (workspaceId: string) => ({ pathname: "/new-task", params: { workspaceId } }) as const,
  editTask: (workspaceId: string, taskId: string) =>
    ({ pathname: "/edit-task", params: { workspaceId, taskId } }) as const,
  importIssues: (workspaceId: string) =>
    ({ pathname: "/import-issues", params: { workspaceId } }) as const,
  newChat: (workspaceId: string) => ({ pathname: "/new-chat", params: { workspaceId } }) as const,
  addHost: () => ({ pathname: "/add-host" }) as const,
  scanHost: () => ({ pathname: "/scan-host" }) as const,
  /** The QR scan of the first screen, while no host is active. */
  setupScan: () => ({ pathname: "/scan" }) as const,
  // Task workflow sheets. Each sheet runs the action that its params name.
  startSession: (workspaceId: string, taskId: string, action: StartSessionSheetAction) =>
    ({ pathname: "/start-session", params: { workspaceId, taskId, action } }) as const,
  /** The start sheet of a desktop quick action, which names its session launch action. */
  quickAction: (workspaceId: string, taskId: string, launch: SessionLaunchActionId) =>
    ({ pathname: "/start-session", params: { workspaceId, taskId, launch } }) as const,
  approveTask: (workspaceId: string, taskId: string) =>
    ({ pathname: "/approve-task", params: { workspaceId, taskId } }) as const,
  requestChanges: (workspaceId: string, taskId: string) =>
    ({ pathname: "/request-changes", params: { workspaceId, taskId } }) as const,
  // Model, runtime profile, effort, and speed of the session that the composer sends to.
  composerOptions: (params: ComposerOptionsParams) =>
    ({ pathname: "/composer-options", params }) as const,
  // Chat sheets. Each sheet reads the chat from the chat list of its workspace.
  renameChat: (workspaceId: string, sessionId: string) =>
    ({ pathname: "/rename-chat", params: { workspaceId, sessionId } }) as const,
  archiveChat: (workspaceId: string, sessionId: string) =>
    ({ pathname: "/archive-chat", params: { workspaceId, sessionId } }) as const,
  /** Forks a chat after the reply with this message ID. */
  forkChat: (workspaceId: string, sessionId: string, messageId: string) =>
    ({ pathname: "/fork-chat", params: { workspaceId, sessionId, messageId } }) as const,
};

/** The task workflow actions that the start sheet runs. */
export type StartSessionSheetAction = "set_spec" | "set_plan" | "build_start" | "qa_start";

/** The session whose message options the composer options sheet changes. */
export type ComposerOptionsParams = Pick<
  SessionRouteParams,
  "workspaceId" | "externalSessionId" | "runtimeKind" | "workingDirectory"
>;
