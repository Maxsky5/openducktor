import {
  type AgentSessionActivity,
  type AgentSessionLiveSnapshot,
  agentSessionLiveSnapshotSchema,
} from "@openducktor/contracts";
import type { AgentEvent } from "@openducktor/core";
import type { z } from "zod";
import { HostValidationError } from "../../effect/host-errors";

export type OpenCodeRetainedSession = {
  snapshot: AgentSessionLiveSnapshot;
  runtimeActivity: AgentSessionActivity;
};

export type OpenCodeLiveSnapshotInput = z.input<typeof agentSessionLiveSnapshotSchema>;

export const openCodeLiveSnapshotsEqual = (
  left: AgentSessionLiveSnapshot,
  right: AgentSessionLiveSnapshot,
): boolean => JSON.stringify(left) === JSON.stringify(right);

export const openCodeActivityForPending = (
  session: OpenCodeRetainedSession,
): AgentSessionActivity => {
  if (session.snapshot.pendingQuestions.length > 0) {
    return "waiting_for_question";
  }
  if (session.snapshot.pendingApprovals.length > 0) {
    return "waiting_for_permission";
  }
  return session.runtimeActivity;
};

export const parseOpenCodeLiveSnapshot = (
  value: OpenCodeLiveSnapshotInput,
  operation: string,
): AgentSessionLiveSnapshot => {
  const parsed = agentSessionLiveSnapshotSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  throw new HostValidationError({
    message: parsed.error.message,
    cause: parsed.error,
    details: { operation },
  });
};

export const openCodeActivityFromEvent = (event: AgentEvent): AgentSessionActivity | null => {
  if (
    event.type === "session_idle" ||
    event.type === "session_error" ||
    event.type === "session_finished"
  ) {
    return "idle";
  }
  if (event.type !== "session_status") {
    return null;
  }
  if (event.status.type === "busy") {
    return "running";
  }
  return event.status.type === "retry" ? "retrying" : "idle";
};

export const openCodeEventChildId = (event: AgentEvent): string | null => {
  if (event.type === "assistant_part" && event.part.kind === "subagent") {
    return event.part.externalSessionId ?? null;
  }
  if ("childExternalSessionId" in event) {
    return event.childExternalSessionId ?? null;
  }
  return null;
};

export const openCodeEventParentId = (event: AgentEvent): string | null => {
  if ("parentExternalSessionId" in event) {
    return event.parentExternalSessionId ?? null;
  }
  return event.type === "assistant_part" && event.part.kind === "subagent"
    ? event.externalSessionId
    : null;
};
