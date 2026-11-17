import type { AgentSessionLiveRef } from "@openducktor/contracts";

/** Copies the session identity without the additional fields of a control request. */
export const toLiveSessionRef = (ref: AgentSessionLiveRef): AgentSessionLiveRef => ({
  repoPath: ref.repoPath,
  runtimeKind: ref.runtimeKind,
  workingDirectory: ref.workingDirectory,
  externalSessionId: ref.externalSessionId,
});

export const liveSessionRefKey = (ref: AgentSessionLiveRef): string =>
  [ref.repoPath, ref.runtimeKind, ref.workingDirectory, ref.externalSessionId].join("\u0000");
