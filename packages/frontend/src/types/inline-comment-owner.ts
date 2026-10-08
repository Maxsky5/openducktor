export type InlineCommentOwner =
  | { kind: "task"; workspaceId: string; taskId: string }
  | { kind: "workspace_session"; workspaceId: string; sessionId: string };
