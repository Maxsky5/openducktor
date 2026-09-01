import type { AgentSessionContextUsage, AgentSessionLiveRef } from "@openducktor/contracts";
import type { AgentSessionSummary } from "@openducktor/core";
import { HostValidationError } from "../../effect/host-errors";
import type { OpenCodeRuntimeInstance } from "./opencode-live-session-normalization";
import {
  openCodeActivityForPending,
  type OpenCodeLiveSnapshotInput,
  type OpenCodeRetainedSession,
  parseOpenCodeLiveSnapshot,
} from "./opencode-live-session-state-policy";

export const toOpenCodeRetainedControlSummary = ({
  runtime,
  summary,
  previous,
  contextUsage,
}: {
  runtime: OpenCodeRuntimeInstance;
  summary: AgentSessionSummary;
  previous: OpenCodeRetainedSession | undefined;
  contextUsage: AgentSessionContextUsage | undefined;
}): OpenCodeRetainedSession => {
  if (summary.runtimeKind !== "opencode") {
    throw new HostValidationError({
      field: "runtimeKind",
      message: `OpenCode runtime '${runtime.runtimeId}' returned runtime kind '${summary.runtimeKind}'.`,
      details: { runtimeId: runtime.runtimeId },
    });
  }
  const ref: AgentSessionLiveRef = {
    repoPath: runtime.repoPath,
    runtimeKind: "opencode",
    workingDirectory: summary.workingDirectory,
    externalSessionId: summary.externalSessionId,
  };
  const runtimeActivity =
    summary.status === "starting" || summary.status === "running" ? "running" : "idle";
  const snapshotInput: OpenCodeLiveSnapshotInput = {
    ref,
    activity: runtimeActivity,
    title: summary.title ?? previous?.snapshot.title ?? "OpenCode",
    startedAt: summary.startedAt,
    pendingApprovals: previous?.snapshot.pendingApprovals ?? [],
    pendingQuestions: previous?.snapshot.pendingQuestions ?? [],
    contextUsage: contextUsage ?? previous?.snapshot.contextUsage ?? null,
  };
  if (summary.sessionAssociation.kind === "repository") {
    snapshotInput.repositoryScope = summary.sessionAssociation;
  }
  const retained: OpenCodeRetainedSession = {
    runtimeActivity,
    snapshot: parseOpenCodeLiveSnapshot(
      snapshotInput,
      "opencode-live-session.retain-control-summary",
    ),
  };
  retained.snapshot = parseOpenCodeLiveSnapshot(
    { ...retained.snapshot, activity: openCodeActivityForPending(retained) },
    "opencode-live-session.retain-control-activity",
  );
  return retained;
};
