import type { AgentSessionRef } from "@openducktor/core";
import type { CodexSessionState } from "./types";

export const codexSessionRef = (session: CodexSessionState): AgentSessionRef => ({
  externalSessionId: session.threadId,
  repoPath: session.repoPath,
  runtimeKind: session.summary.runtimeKind,
  workingDirectory: session.workingDirectory,
});
