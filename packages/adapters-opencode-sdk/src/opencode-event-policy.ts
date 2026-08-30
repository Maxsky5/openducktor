import type { Event as SdkEvent } from "@opencode-ai/sdk/v2/client";

export type OpencodeEventProjectionRoute = "message" | "session" | "ignore";

export type OpencodeEventPolicy = {
  ingress: "validate" | "ignore";
  route: OpencodeEventProjectionRoute;
  invalidatesSessions: boolean;
  usesParentSessionRouting: boolean;
};

const IGNORE_EVENT = {
  ingress: "ignore",
  route: "ignore",
  invalidatesSessions: false,
  usesParentSessionRouting: false,
} as const satisfies OpencodeEventPolicy;
const MESSAGE_EVENT = {
  ingress: "validate",
  route: "message",
  invalidatesSessions: false,
  usesParentSessionRouting: false,
} as const satisfies OpencodeEventPolicy;
const SESSION_EVENT = {
  ingress: "validate",
  route: "session",
  invalidatesSessions: false,
  usesParentSessionRouting: false,
} as const satisfies OpencodeEventPolicy;
const INVALIDATING_SESSION_EVENT = {
  ingress: "validate",
  route: "session",
  invalidatesSessions: true,
  usesParentSessionRouting: false,
} as const satisfies OpencodeEventPolicy;
const INVALIDATING_PARENT_ROUTED_EVENT = {
  ingress: "validate",
  route: "session",
  invalidatesSessions: true,
  usesParentSessionRouting: true,
} as const satisfies OpencodeEventPolicy;
const INVALIDATION_ONLY_EVENT = {
  ingress: "validate",
  route: "ignore",
  invalidatesSessions: true,
  usesParentSessionRouting: false,
} as const satisfies OpencodeEventPolicy;

export const OPENCODE_EVENT_POLICY_BY_TYPE = {
  "models-dev.refreshed": IGNORE_EVENT,
  "integration.updated": IGNORE_EVENT,
  "integration.connection.updated": IGNORE_EVENT,
  "catalog.updated": IGNORE_EVENT,
  "session.created": INVALIDATING_SESSION_EVENT,
  "session.updated": INVALIDATING_SESSION_EVENT,
  "session.deleted": INVALIDATION_ONLY_EVENT,
  "message.updated": MESSAGE_EVENT,
  "message.removed": MESSAGE_EVENT,
  "message.part.updated": MESSAGE_EVENT,
  "message.part.removed": MESSAGE_EVENT,
  "session.next.agent.switched": IGNORE_EVENT,
  "session.next.model.switched": IGNORE_EVENT,
  "session.next.moved": IGNORE_EVENT,
  "session.next.prompted": IGNORE_EVENT,
  "session.next.prompt.admitted": IGNORE_EVENT,
  "session.next.context.updated": IGNORE_EVENT,
  "session.next.synthetic": IGNORE_EVENT,
  "session.next.shell.started": IGNORE_EVENT,
  "session.next.shell.ended": IGNORE_EVENT,
  "session.next.step.started": IGNORE_EVENT,
  "session.next.step.ended": IGNORE_EVENT,
  "session.next.step.failed": IGNORE_EVENT,
  "session.next.text.started": IGNORE_EVENT,
  "session.next.text.delta": IGNORE_EVENT,
  "session.next.text.ended": IGNORE_EVENT,
  "session.next.reasoning.started": IGNORE_EVENT,
  "session.next.reasoning.delta": IGNORE_EVENT,
  "session.next.reasoning.ended": IGNORE_EVENT,
  "session.next.tool.input.started": IGNORE_EVENT,
  "session.next.tool.input.delta": IGNORE_EVENT,
  "session.next.tool.input.ended": IGNORE_EVENT,
  "session.next.tool.called": IGNORE_EVENT,
  "session.next.tool.progress": IGNORE_EVENT,
  "session.next.tool.success": IGNORE_EVENT,
  "session.next.tool.failed": IGNORE_EVENT,
  "session.next.retried": IGNORE_EVENT,
  "session.next.compaction.started": IGNORE_EVENT,
  "session.next.compaction.delta": IGNORE_EVENT,
  "session.next.compaction.ended": IGNORE_EVENT,
  "session.next.revert.staged": IGNORE_EVENT,
  "session.next.revert.cleared": IGNORE_EVENT,
  "session.next.revert.committed": IGNORE_EVENT,
  "message.part.delta": MESSAGE_EVENT,
  "session.diff": IGNORE_EVENT,
  "session.error": SESSION_EVENT,
  "installation.updated": IGNORE_EVENT,
  "installation.update-available": IGNORE_EVENT,
  "file.edited": IGNORE_EVENT,
  "reference.updated": IGNORE_EVENT,
  "permission.v2.asked": INVALIDATING_PARENT_ROUTED_EVENT,
  "permission.v2.replied": INVALIDATING_PARENT_ROUTED_EVENT,
  "plugin.added": IGNORE_EVENT,
  "project.directories.updated": IGNORE_EVENT,
  "file.watcher.updated": IGNORE_EVENT,
  "pty.created": IGNORE_EVENT,
  "pty.updated": IGNORE_EVENT,
  "pty.exited": IGNORE_EVENT,
  "pty.deleted": IGNORE_EVENT,
  "question.v2.asked": INVALIDATING_PARENT_ROUTED_EVENT,
  "question.v2.replied": INVALIDATING_PARENT_ROUTED_EVENT,
  "question.v2.rejected": INVALIDATING_PARENT_ROUTED_EVENT,
  "todo.updated": SESSION_EVENT,
  "lsp.updated": IGNORE_EVENT,
  "permission.asked": INVALIDATING_PARENT_ROUTED_EVENT,
  "permission.replied": INVALIDATING_PARENT_ROUTED_EVENT,
  "tui.prompt.append": IGNORE_EVENT,
  "tui.command.execute": IGNORE_EVENT,
  "tui.toast.show": IGNORE_EVENT,
  "tui.session.select": IGNORE_EVENT,
  "mcp.tools.changed": IGNORE_EVENT,
  "mcp.browser.open.failed": IGNORE_EVENT,
  "command.executed": IGNORE_EVENT,
  "project.updated": IGNORE_EVENT,
  "session.status": SESSION_EVENT,
  "session.idle": SESSION_EVENT,
  "question.asked": INVALIDATING_PARENT_ROUTED_EVENT,
  "question.replied": INVALIDATING_PARENT_ROUTED_EVENT,
  "question.rejected": INVALIDATING_PARENT_ROUTED_EVENT,
  "session.compacted": SESSION_EVENT,
  "vcs.branch.updated": IGNORE_EVENT,
  "workspace.ready": IGNORE_EVENT,
  "workspace.failed": IGNORE_EVENT,
  "workspace.status": IGNORE_EVENT,
  "worktree.ready": IGNORE_EVENT,
  "worktree.failed": IGNORE_EVENT,
  "server.connected": IGNORE_EVENT,
  "global.disposed": IGNORE_EVENT,
  "server.instance.disposed": IGNORE_EVENT,
} as const satisfies Record<SdkEvent["type"], OpencodeEventPolicy>;

type OpencodeEventType = keyof typeof OPENCODE_EVENT_POLICY_BY_TYPE;

export type ConsumedOpencodeEventType = {
  [
    Type in OpencodeEventType
  ]: (typeof OPENCODE_EVENT_POLICY_BY_TYPE)[Type]["ingress"] extends "validate" ? Type : never;
}[OpencodeEventType];

export const isKnownOpencodeEventType = (value: string): value is OpencodeEventType =>
  Object.hasOwn(OPENCODE_EVENT_POLICY_BY_TYPE, value);

export const isConsumedOpencodeEventType = (value: string): value is ConsumedOpencodeEventType =>
  isKnownOpencodeEventType(value) && OPENCODE_EVENT_POLICY_BY_TYPE[value].ingress === "validate";
