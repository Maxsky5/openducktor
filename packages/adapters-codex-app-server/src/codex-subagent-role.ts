import { AgentRuntimeQueryError } from "@openducktor/core";
import { codexSubAgentSourceMetadata } from "./codex-app-server-threads";
import type { CodexAppServerClient } from "./types";

export type CodexSubagentScope = {
  parentThreadId: string;
  workingDirectory?: string;
};

export const readCodexSubagentRole = async (
  client: CodexAppServerClient,
  childThreadId: string,
  scope: CodexSubagentScope,
): Promise<string | undefined> => {
  const { thread } = await client.threadRead({ threadId: childThreadId, includeTurns: false });
  const source = codexSubAgentSourceMetadata(thread.source);
  if (
    thread.id !== childThreadId ||
    (scope.workingDirectory !== undefined && thread.cwd !== scope.workingDirectory) ||
    (thread.parentThreadId ?? source?.parentThreadId) !== scope.parentThreadId ||
    (source && source.parentThreadId !== scope.parentThreadId)
  ) {
    throw new AgentRuntimeQueryError(
      "scope_mismatch",
      `Codex subagent metadata for '${childThreadId}' does not match its parent and working directory. Reload the matching session.`,
    );
  }
  return thread.agentRole ?? source?.agentRole ?? undefined;
};
