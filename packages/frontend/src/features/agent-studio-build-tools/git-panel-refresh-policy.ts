import type { AgentChatMessageMeta } from "@/types/agent-orchestrator";

export type ToolMessageMeta = Extract<NonNullable<AgentChatMessageMeta>, { kind: "tool" }>;

const SHELL_TOOL_NAMES = new Set(["bash", "shell", "exec", "command"]);

const SHELL_COMMAND_PREFIX_PATTERN = String.raw`(?:^|[;&|\n({!]\s*)`;
const SHELL_ENV_PREFIX_PATTERN = String.raw`(?:(?:[a-z_][a-z0-9_]*=\S+\s+)|(?:env\s+(?:[a-z_][a-z0-9_]*=\S+\s+)+))*`;

const shellCommandPattern = (commandNames: readonly string[]): RegExp =>
  new RegExp(
    `${SHELL_COMMAND_PREFIX_PATTERN}${SHELL_ENV_PREFIX_PATTERN}(?:${commandNames.join("|")})\\b`,
    "i",
  );

const GIT_COMMAND_PATTERN = new RegExp(
  `${SHELL_COMMAND_PREFIX_PATTERN}${SHELL_ENV_PREFIX_PATTERN}(?:rtk\\s+)?git\\b`,
  "i",
);

const FILE_MUTATION_COMMAND_NAMES = [
  "rm",
  "mv",
  "cp",
  "mkdir",
  "rmdir",
  "touch",
  "chmod",
  "chown",
  "truncate",
  "ln",
  "tar",
  "unzip",
  "rsync",
] as const;

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
  fileMutation: [shellCommandPattern(FILE_MUTATION_COMMAND_NAMES)],
  inPlaceEdit: [/\b(?:sed|perl)\s+(?:-[a-z]*\s+)*-[a-z]*i[a-z]*(?:\s|$)/],
  redirectWrite: [/>+\s*[^&=]/, /\btee\b/],
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
  const toolType = meta.toolType;
  if (toolName.length === 0 && !toolType) {
    return false;
  }
  if (GIT_PANEL_REFRESH_TOOL_NAMES.has(toolName) || toolType === "file_edit") {
    return true;
  }

  const command = typeof meta.input?.command === "string" ? meta.input.command : "";
  if (SHELL_TOOL_NAMES.has(toolName) || toolType === "bash") {
    return shouldRefreshGitPanelAfterShellCommand(command);
  }

  return false;
};
