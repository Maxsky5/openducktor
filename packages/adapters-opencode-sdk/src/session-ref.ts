import type { SessionRef } from "@openducktor/core";
import type { SessionRecord } from "./types";

export const opencodeSessionRef = (session: SessionRecord): SessionRef => ({
  externalSessionId: session.externalSessionId,
  repoPath: session.input.repoPath,
  runtimeKind: session.input.runtimeKind,
  workingDirectory: session.input.workingDirectory,
});
