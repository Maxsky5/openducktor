import { useEffect, useRef } from "react";
import {
  forEachSessionMessage,
  forEachSessionMessageFrom,
} from "@/state/operations/agent-orchestrator/support/messages";
import { isReadOnlyShellCommand, isSafeReadToolName } from "@/state/operations/permission-policy";

import type { AgentChatMessageMeta, AgentSessionState } from "@/types/agent-orchestrator";
import { findFirstChangedMessageIndex } from "./agent-session-message-diff";

type UseAgentStudioBuildWorktreeRefreshArgs = {
  viewRole: string | null;
  activeSession: AgentSessionState | null;
  isSessionHistoryHydrating: boolean;
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

type ToolMessageMeta = Extract<NonNullable<AgentChatMessageMeta>, { kind: "tool" }>;

const isReadOnlyNonWorktreeTool = (toolName: string): boolean =>
  EXPLICIT_NON_WORKTREE_TOOL_NAMES.has(toolName) || isSafeReadToolName(toolName);

const canToolAffectWorktree = (meta: ToolMessageMeta): boolean => {
  const toolName = meta.tool.trim().toLowerCase();
  if (toolName.length === 0) {
    return false;
  }
  if (isReadOnlyNonWorktreeTool(toolName)) {
    return false;
  }

  const command = typeof meta.input?.command === "string" ? meta.input.command : "";
  if (SHELL_TOOL_NAMES.has(toolName) && command.length > 0 && isReadOnlyShellCommand(command)) {
    return false;
  }

  return true;
};

const seedProcessedToolMessageKeys = (session: AgentSessionState): Set<string> => {
  const keys = new Set<string>();
  forEachSessionMessage(session, (message) => {
    const meta = message.meta;
    if (!meta || meta.kind !== "tool" || meta.status !== "completed") {
      return;
    }

    keys.add(`${session.sessionId}:${message.id}`);
  });
  return keys;
};

export function useAgentStudioBuildWorktreeRefresh({
  viewRole,
  activeSession,
  isSessionHistoryHydrating,
  refreshWorktree,
}: UseAgentStudioBuildWorktreeRefreshArgs): void {
  const processedToolMessageKeysRef = useRef(new Set<string>());
  const previousSessionIdRef = useRef<string | null>(null);
  const previousMessagesRef = useRef<AgentSessionState["messages"] | null>(null);
  const wasSessionHistoryHydratingRef = useRef(false);

  useEffect(() => {
    if (viewRole !== "build" || activeSession?.role !== "build") {
      return;
    }

    if (isSessionHistoryHydrating) {
      wasSessionHistoryHydratingRef.current = true;
      return;
    }

    if (previousSessionIdRef.current !== activeSession.sessionId) {
      previousSessionIdRef.current = activeSession.sessionId;
      previousMessagesRef.current = activeSession.messages;
      processedToolMessageKeysRef.current = seedProcessedToolMessageKeys(activeSession);
      return;
    }

    if (wasSessionHistoryHydratingRef.current) {
      wasSessionHistoryHydratingRef.current = false;
      previousMessagesRef.current = activeSession.messages;
      processedToolMessageKeysRef.current = seedProcessedToolMessageKeys(activeSession);
      return;
    }

    const firstChangedMessageIndex = findFirstChangedMessageIndex(
      previousMessagesRef.current,
      activeSession,
    );
    if (firstChangedMessageIndex < 0) {
      previousMessagesRef.current = activeSession.messages;
      return;
    }

    let shouldRefresh = false;
    forEachSessionMessageFrom(activeSession, firstChangedMessageIndex, (message) => {
      const meta = message.meta;
      if (!meta || meta.kind !== "tool" || meta.status !== "completed") {
        return;
      }

      const messageKey = `${activeSession.sessionId}:${message.id}`;
      if (processedToolMessageKeysRef.current.has(messageKey)) {
        return;
      }

      processedToolMessageKeysRef.current.add(messageKey);
      if (canToolAffectWorktree(meta)) {
        shouldRefresh = true;
      }
    });

    previousMessagesRef.current = activeSession.messages;

    if (shouldRefresh) {
      refreshWorktree();
    }
  }, [activeSession, isSessionHistoryHydrating, refreshWorktree, viewRole]);
}
