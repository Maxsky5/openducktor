import { useEffect, useRef } from "react";
import { isReadOnlyShellCommand, isSafeReadToolName } from "@/state/operations/permission-policy";
import type { AgentSessionState } from "@/types/agent-orchestrator";

type UseAgentStudioBuildWorktreeRefreshArgs = {
  viewRole: string | null;
  activeSession: AgentSessionState | null;
  refreshWorktree: () => void;
};

const EXPLICIT_NON_WORKTREE_TOOL_NAMES = new Set([
  "ast_grep_search",
  "background_output",
  "context7_query-docs",
  "context7_resolve-library-id",
  "distill",
  "grep_app_searchGitHub",
  "lsp_diagnostics",
  "lsp_find_references",
  "lsp_goto_definition",
  "lsp_prepare_rename",
  "lsp_symbols",
  "look_at",
  "odt_read_task",
  "prune",
  "question",
  "session_info",
  "session_list",
  "session_read",
  "session_search",
  "skill",
  "task",
  "todowrite",
  "webfetch",
  "websearch_web_search_exa",
]);

const SHELL_TOOL_NAMES = new Set(["bash", "shell", "exec", "command"]);

type ToolMessageMeta = Extract<
  NonNullable<AgentSessionState["messages"][number]["meta"]>,
  { kind: "tool" }
>;

const canToolAffectWorktree = (meta: ToolMessageMeta): boolean => {
  const toolName = meta.tool.trim().toLowerCase();
  if (toolName.length === 0) {
    return false;
  }
  if (EXPLICIT_NON_WORKTREE_TOOL_NAMES.has(toolName) || isSafeReadToolName(toolName)) {
    return false;
  }

  const command = typeof meta.input?.command === "string" ? meta.input.command : "";
  if (SHELL_TOOL_NAMES.has(toolName) && command.length > 0 && isReadOnlyShellCommand(command)) {
    return false;
  }

  return true;
};

export function useAgentStudioBuildWorktreeRefresh({
  viewRole,
  activeSession,
  refreshWorktree,
}: UseAgentStudioBuildWorktreeRefreshArgs): void {
  const processedToolMessageKeysRef = useRef(new Set<string>());
  const previousSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (viewRole !== "build" || activeSession?.role !== "build") {
      return;
    }

    if (previousSessionIdRef.current !== activeSession.sessionId) {
      previousSessionIdRef.current = activeSession.sessionId;
      processedToolMessageKeysRef.current.clear();
    }

    let shouldRefresh = false;
    for (const message of activeSession.messages) {
      const meta = message.meta;
      if (!meta || meta.kind !== "tool" || meta.status !== "completed") {
        continue;
      }

      const messageKey = `${activeSession.sessionId}:${message.id}`;
      if (processedToolMessageKeysRef.current.has(messageKey)) {
        continue;
      }

      processedToolMessageKeysRef.current.add(messageKey);
      if (canToolAffectWorktree(meta)) {
        shouldRefresh = true;
      }
    }

    if (shouldRefresh) {
      refreshWorktree();
    }
  }, [activeSession, refreshWorktree, viewRole]);
}
