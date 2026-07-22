import { ODT_WORKFLOW_AGENT_TOOL_NAMES, OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentToolType } from "@openducktor/core";

export type OpenCodeToolPreviewStrategy =
  | "shell"
  | "read"
  | "list"
  | "search"
  | "skill"
  | "todo"
  | "question"
  | "task"
  | "workflow"
  | "web"
  | "context"
  | "github_search"
  | "lsp"
  | "session"
  | "generic";

type OpenCodeToolStrategyDefinition = {
  toolType: AgentToolType;
  previewStrategy: OpenCodeToolPreviewStrategy;
  resolveCanonicalName: (normalizedName: string) => string | null;
};

export type ResolvedOpenCodeToolStrategy = {
  normalizedName: string;
  canonicalName: string;
  toolType: AgentToolType;
  previewStrategy: OpenCodeToolPreviewStrategy;
};

const SHELL_TOOL_NAMES = new Set(["bash", "shell", "exec", "command"]);
const READ_TOOL_NAMES = new Set(["read", "cat", "view"]);
const LIST_TOOL_NAMES = new Set(["list", "ls"]);
const SEARCH_TOOL_NAMES = new Set(["glob", "grep", "find", "search", "ast_grep_search"]);
const TODO_TOOL_NAMES = new Set(["todowrite", "todoread"]);
const TASK_TOOL_NAMES = new Set(["task", "delegate"]);
const SESSION_TOOL_NAMES = new Set([
  "session_info",
  "session_list",
  "session_read",
  "session_search",
]);
const LSP_TOOL_NAMES = new Set([
  "lsp_diagnostic",
  "lsp_diagnostics",
  "lsp_find_references",
  "lsp_goto_definition",
  "lsp_prepare_rename",
  "lsp_symbols",
]);
const FILE_EDIT_TOOL_NAMES = new Set([
  "edit",
  "multiedit",
  "write",
  "create",
  "file_write",
  "apply_patch",
  "str_replace",
  "str_replace_based_edit_tool",
  "patch",
  "insert",
  "replace",
]);

const normalizeToolName = (value: string): string => {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("functions.") ? normalized.slice("functions.".length) : normalized;
};

const createWorkflowCanonicalNameByAlias = (): ReadonlyMap<string, string> => {
  const canonicalNameByAlias = new Map<string, string>();

  for (const canonicalName of ODT_WORKFLOW_AGENT_TOOL_NAMES) {
    canonicalNameByAlias.set(normalizeToolName(canonicalName), canonicalName);
    const aliases = OPENCODE_RUNTIME_DESCRIPTOR.workflowToolAliasesByCanonical[canonicalName] ?? [];
    for (const alias of aliases) {
      canonicalNameByAlias.set(normalizeToolName(alias), canonicalName);
    }
  }

  return canonicalNameByAlias;
};

const WORKFLOW_CANONICAL_NAME_BY_ALIAS = createWorkflowCanonicalNameByAlias();

const matchExact =
  (toolNames: ReadonlySet<string>) =>
  (normalizedName: string): string | null =>
    toolNames.has(normalizedName) ? normalizedName : null;

export const OPENCODE_TOOL_STRATEGY_CATALOG = [
  {
    toolType: "bash",
    previewStrategy: "shell",
    resolveCanonicalName: matchExact(SHELL_TOOL_NAMES),
  },
  {
    toolType: "read",
    previewStrategy: "read",
    resolveCanonicalName: matchExact(READ_TOOL_NAMES),
  },
  {
    toolType: "list",
    previewStrategy: "list",
    resolveCanonicalName: matchExact(LIST_TOOL_NAMES),
  },
  {
    toolType: "search",
    previewStrategy: "search",
    resolveCanonicalName: matchExact(SEARCH_TOOL_NAMES),
  },
  {
    toolType: "generic",
    previewStrategy: "skill",
    resolveCanonicalName: (normalizedName) => (normalizedName === "skill" ? normalizedName : null),
  },
  {
    toolType: "todo",
    previewStrategy: "todo",
    resolveCanonicalName: (normalizedName) =>
      TODO_TOOL_NAMES.has(normalizedName) ||
      normalizedName.endsWith("_todowrite") ||
      normalizedName.endsWith("_todoread")
        ? normalizedName
        : null,
  },
  {
    toolType: "file_edit",
    previewStrategy: "generic",
    resolveCanonicalName: matchExact(FILE_EDIT_TOOL_NAMES),
  },
  {
    toolType: "question",
    previewStrategy: "question",
    resolveCanonicalName: (normalizedName) =>
      normalizedName === "question" || normalizedName.endsWith("_question") ? normalizedName : null,
  },
  {
    toolType: "generic",
    previewStrategy: "task",
    resolveCanonicalName: matchExact(TASK_TOOL_NAMES),
  },
  {
    toolType: "workflow",
    previewStrategy: "workflow",
    resolveCanonicalName: (normalizedName) =>
      WORKFLOW_CANONICAL_NAME_BY_ALIAS.get(normalizedName) ?? null,
  },
  {
    toolType: "web",
    previewStrategy: "web",
    resolveCanonicalName: (normalizedName) =>
      normalizedName === "webfetch" || normalizedName.startsWith("websearch")
        ? normalizedName
        : null,
  },
  {
    toolType: "web",
    previewStrategy: "generic",
    resolveCanonicalName: (normalizedName) =>
      normalizedName.startsWith("webfetch") ? normalizedName : null,
  },
  {
    toolType: "generic",
    previewStrategy: "context",
    resolveCanonicalName: (normalizedName) =>
      normalizedName.startsWith("context7_") ? normalizedName : null,
  },
  {
    toolType: "generic",
    previewStrategy: "github_search",
    resolveCanonicalName: (normalizedName) =>
      normalizedName === "grep_app_searchgithub" ? normalizedName : null,
  },
  {
    toolType: "generic",
    previewStrategy: "lsp",
    resolveCanonicalName: matchExact(LSP_TOOL_NAMES),
  },
  {
    toolType: "generic",
    previewStrategy: "session",
    resolveCanonicalName: matchExact(SESSION_TOOL_NAMES),
  },
] as const satisfies readonly OpenCodeToolStrategyDefinition[];

export const resolveOpencodeToolStrategy = (toolName: string): ResolvedOpenCodeToolStrategy => {
  const normalizedName = normalizeToolName(toolName);

  for (const strategy of OPENCODE_TOOL_STRATEGY_CATALOG) {
    const canonicalName = strategy.resolveCanonicalName(normalizedName);
    if (canonicalName) {
      return {
        normalizedName,
        canonicalName,
        toolType: strategy.toolType,
        previewStrategy: strategy.previewStrategy,
      };
    }
  }

  return {
    normalizedName,
    canonicalName: normalizedName,
    toolType: "generic",
    previewStrategy: "generic",
  };
};
