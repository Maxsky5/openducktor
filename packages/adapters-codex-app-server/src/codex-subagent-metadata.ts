import { AgentRuntimeQueryError } from "@openducktor/core";
import { codexThreadSnapshot, type CodexThreadSnapshot } from "./codex-app-server-threads";
import type { CodexAppServerClient } from "./types";

export type CodexSubagentScope = {
  parentThreadId: string;
  workingDirectory?: string;
};

export const readCodexSubagentThread = async (
  client: CodexAppServerClient,
  childThreadId: string,
  scope: CodexSubagentScope,
): Promise<CodexThreadSnapshot> => {
  const result = await client.threadRead({ threadId: childThreadId, includeTurns: false });
  const thread = codexThreadSnapshot(result.thread);
  if (
    thread.id !== childThreadId ||
    (scope.workingDirectory !== undefined && thread.cwd !== scope.workingDirectory) ||
    thread.parentThreadId !== scope.parentThreadId ||
    (thread.subAgentSource && thread.subAgentSource.parentThreadId !== scope.parentThreadId)
  ) {
    throw new AgentRuntimeQueryError(
      "scope_mismatch",
      `Codex subagent metadata for '${childThreadId}' does not match its parent and working directory. Reload the matching session.`,
    );
  }
  return thread;
};
