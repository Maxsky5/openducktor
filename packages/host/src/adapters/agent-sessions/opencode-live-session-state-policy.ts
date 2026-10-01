import {
  type AgentSessionActivity,
  type AgentSessionContextUsage,
  type AgentSessionScope,
  type AgentSessionLiveRef,
  type AgentSessionLiveSnapshot,
  agentSessionLiveSnapshotSchema,
} from "@openducktor/contracts";
import type { AgentEvent } from "@openducktor/core";
import type { z } from "zod";
import { HostValidationError } from "../../effect/host-errors";
import { refKey, refsEqual, toSessionRef } from "./opencode-live-session-normalization";

export type OpenCodeLiveSession = {
  snapshot: AgentSessionLiveSnapshot;
  runtimeActivity: AgentSessionActivity;
  sessionScope?: AgentSessionScope;
};

export type OpenCodeLiveSnapshotInput = z.input<typeof agentSessionLiveSnapshotSchema>;

export const requireOpenCodeLiveSession = (
  sessionsByRef: ReadonlyMap<string, OpenCodeLiveSession>,
  runtimeId: string,
  ref: AgentSessionLiveRef,
): OpenCodeLiveSession => {
  const session = sessionsByRef.get(refKey(ref));
  if (!session || !refsEqual(session.snapshot.ref, ref)) {
    throw new HostValidationError({
      field: "sessionRef",
      message: `OpenCode session '${ref.externalSessionId}' does not belong to runtime '${runtimeId}' with the supplied reference.`,
      details: { runtimeId, ref },
    });
  }
  return session;
};

export const requireOpenCodeEventSession = ({
  ownerRef,
  event,
  runtimeId,
  sessionsByRef,
  contextUsageBySessionId,
}: {
  ownerRef: AgentSessionLiveRef;
  event: AgentEvent;
  runtimeId: string;
  sessionsByRef: ReadonlyMap<string, OpenCodeLiveSession>;
  contextUsageBySessionId: ReadonlyMap<string, AgentSessionContextUsage>;
}): OpenCodeLiveSession => {
  const childExternalSessionId = openCodeEventChildId(event);
  const parentExternalSessionId = openCodeEventParentId(event);
  if (!childExternalSessionId || childExternalSessionId === ownerRef.externalSessionId) {
    return requireOpenCodeLiveSession(sessionsByRef, runtimeId, ownerRef);
  }
  if (!parentExternalSessionId) {
    throw new HostValidationError({
      field: "parentExternalSessionId",
      message: `OpenCode event for child session '${childExternalSessionId}' has no registered parent lineage.`,
      details: { runtimeId, externalSessionId: childExternalSessionId },
    });
  }
  const parentRef = { ...toSessionRef(ownerRef), externalSessionId: parentExternalSessionId };
  if (!sessionsByRef.has(refKey(parentRef))) {
    throw new HostValidationError({
      field: "parentExternalSessionId",
      message: `OpenCode event for child session '${childExternalSessionId}' names unregistered parent '${parentExternalSessionId}'.`,
      details: {
        runtimeId,
        externalSessionId: childExternalSessionId,
        parentExternalSessionId,
      },
    });
  }
  const childRef = { ...toSessionRef(ownerRef), externalSessionId: childExternalSessionId };
  const existing = sessionsByRef.get(refKey(childRef));
  if (existing) {
    if (existing.snapshot.parentExternalSessionId !== parentExternalSessionId) {
      throw new HostValidationError({
        field: "parentExternalSessionId",
        message: `OpenCode child session '${childExternalSessionId}' changed parent from '${existing.snapshot.parentExternalSessionId ?? "none"}' to '${parentExternalSessionId}'.`,
        details: {
          runtimeId,
          externalSessionId: childExternalSessionId,
          parentExternalSessionId,
        },
      });
    }
    return existing;
  }
  const title =
    event.type === "assistant_part" && event.part.kind === "subagent"
      ? (event.part.agent ?? event.part.description ?? "OpenCode subagent")
      : "OpenCode subagent";
  const snapshot = parseOpenCodeLiveSnapshot(
    {
      ref: childRef,
      activity: "idle",
      title,
      startedAt: event.timestamp,
      parentExternalSessionId: parentExternalSessionId,
      pendingApprovals: [],
      pendingQuestions: [],
      contextUsage: contextUsageBySessionId.get(childExternalSessionId) ?? null,
    },
    "opencode-live-session.create-child-event-state",
  );
  return { snapshot, runtimeActivity: "idle" as const };
};

export const openCodeLiveSnapshotsEqual = (
  left: AgentSessionLiveSnapshot,
  right: AgentSessionLiveSnapshot,
): boolean => JSON.stringify(left) === JSON.stringify(right);

/** A live status event confirms the current status, so the snapshot drops its read failure. */
export const withConfirmedStatus = ({
  statusUnavailableReason: _statusUnavailableReason,
  ...snapshot
}: AgentSessionLiveSnapshot): AgentSessionLiveSnapshot => snapshot;

/** A failed status read keeps the snapshot and names why its status is not current. */
export const withStatusUnavailable = (
  session: OpenCodeLiveSession,
  reason: string,
): OpenCodeLiveSession => ({
  ...session,
  snapshot: parseOpenCodeLiveSnapshot(
    { ...session.snapshot, statusUnavailableReason: reason },
    "opencode-live-session.mark-status-unavailable",
  ),
});

/** A status read sets the status and keeps newer context, title, and pending input. */
export const withReadStatus = (
  session: OpenCodeLiveSession,
  runtimeActivity: AgentSessionActivity,
): OpenCodeLiveSession => {
  const next = { ...session, runtimeActivity, snapshot: withConfirmedStatus(session.snapshot) };
  return {
    ...next,
    snapshot: parseOpenCodeLiveSnapshot(
      { ...next.snapshot, activity: openCodeActivityForPending(next) },
      "opencode-live-session.refresh-status",
    ),
  };
};

export const openCodeActivityForPending = (session: OpenCodeLiveSession): AgentSessionActivity => {
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
