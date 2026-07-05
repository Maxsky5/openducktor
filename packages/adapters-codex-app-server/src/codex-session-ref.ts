import type { SessionRef } from "@openducktor/core";
import type { CodexSessionState } from "./types";

export const codexSessionRef = (session: CodexSessionState): SessionRef => ({
  externalSessionId: session.threadId,
  repoPath: session.repoPath,
  runtimeKind: session.summary.runtimeKind,
  workingDirectory: session.workingDirectory,
});
