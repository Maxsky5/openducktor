import type { AgentChatMessageMeta } from "@/types/agent-orchestrator";

export type ToolMessageMeta = Extract<NonNullable<AgentChatMessageMeta>, { kind: "tool" }>;

const SHELL_TOOL_NAMES = new Set(["bash", "shell", "exec", "command"]);

const GIT_COMMAND_PATTERN = /(?:^|[;&|\n]\s*)(?:rtk\s+)?git(?:\s|$)/;

const GIT_PANEL_REFRESH_TOOL_NAMES_BY_REASON = {
  fileEdit: [
    "apply_patch",
    "edit",
    "file_write",
    "multiedit",
    "multi_edit",
    "patch",
    "str_replace",
    "str_replace_based_edit_tool",
    "write",
  ],
  fileCreateOrReplace: ["create", "insert", "replace"],
  languageServerMutation: ["ast_grep_replace", "lsp_rename"],
} as const satisfies Record<string, readonly string[]>;

const GIT_PANEL_REFRESH_TOOL_NAMES: ReadonlySet<string> = new Set(
  Object.values(GIT_PANEL_REFRESH_TOOL_NAMES_BY_REASON).flat(),
);

const GIT_PANEL_REFRESH_SHELL_PATTERNS_BY_REASON = {
  gitState: [GIT_COMMAND_PATTERN],
  fileMutation: [/\b(rm|mv|cp|mkdir|rmdir|touch|chmod|chown|truncate)\b/],
  inPlaceEdit: [/\b(sed\s+-i|perl\s+-i)\b/],
  redirectWrite: [/>+\s*[^=]/, /\btee\b/],
} as const satisfies Record<string, readonly RegExp[]>;

const GIT_PANEL_REFRESH_SHELL_PATTERNS = Object.values(
  GIT_PANEL_REFRESH_SHELL_PATTERNS_BY_REASON,
).flat();

const shouldRefreshGitPanelAfterShellCommand = (command: string): boolean => {
  const normalized = command.trim().toLowerCase();
  return (
    normalized.length > 0 &&
    GIT_PANEL_REFRESH_SHELL_PATTERNS.some((pattern) => pattern.test(normalized))
  );
};

export const shouldRefreshGitPanelAfterToolCompletion = (meta: ToolMessageMeta): boolean => {
  const toolName = meta.tool.trim().toLowerCase();
  if (toolName.length === 0) {
    return false;
  }
  if (GIT_PANEL_REFRESH_TOOL_NAMES.has(toolName)) {
    return true;
  }

  const command = typeof meta.input?.command === "string" ? meta.input.command : "";
  if (SHELL_TOOL_NAMES.has(toolName)) {
    return shouldRefreshGitPanelAfterShellCommand(command);
  }

  return false;
};
