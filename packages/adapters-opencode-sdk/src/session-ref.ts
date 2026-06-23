import type { AgentSessionRef } from "@openducktor/core";
import type { SessionRecord } from "./types";

export const opencodeSessionRef = (session: SessionRecord): AgentSessionRef => ({
  externalSessionId: session.externalSessionId,
  repoPath: session.input.repoPath,
  runtimeKind: session.input.runtimeKind,
  workingDirectory: session.input.workingDirectory,
});
