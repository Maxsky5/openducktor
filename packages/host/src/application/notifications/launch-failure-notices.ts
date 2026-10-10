import type { NotificationOccurrence } from "@openducktor/contracts";
import { normalizeSessionErrorMessage } from "@openducktor/core";
import {
  type createSessionNotificationBuilder,
  type SessionNotificationSource,
  toNotificationStatus,
} from "./session-notification-builder";

type LaunchFailureSource = SessionNotificationSource & {
  unownedTerminals: Map<string, NotificationOccurrence>;
};

const NOTIFIED_LIMIT = 256;

/**
 * Notifies each launch failure once. The notified ids outlive a removed session, so a session that
 * comes back does not notify its old failure again. A launch failure does not end the turn, so it
 * keeps the idle and error episode state of the session.
 */
export const createLaunchFailureNotices = ({
  sessionOccurrence,
  sessionTarget,
}: Pick<
  ReturnType<typeof createSessionNotificationBuilder>,
  "sessionOccurrence" | "sessionTarget"
>) => {
  const notified = new Set<string>();
  return (projection: LaunchFailureSource | undefined): NotificationOccurrence[] => {
    const failure = projection?.snapshot.launchFailure;
    if (!projection || !failure || notified.has(failure.messageId)) return [];
    if (projection.snapshot.parentExternalSessionId !== undefined) return [];
    notified.add(failure.messageId);
    // A Set keeps insertion order, so the first value is the oldest id.
    if (notified.size > NOTIFIED_LIMIT) notified.delete(notified.values().next().value ?? "");
    const occurrence = sessionOccurrence(projection, {
      kind: "agent.session_error",
      suffix: failure.messageId,
      status:
        toNotificationStatus(normalizeSessionErrorMessage(failure.message)) ||
        "The session launch failed. Open it for details.",
      navigationTarget: {
        type: "session_error",
        ...sessionTarget(projection),
        errorId: failure.messageId,
      },
    });
    if (projection.association) return [occurrence];
    // Keep it apart from the episode entry, so a later idle notice cannot replace it.
    projection.unownedTerminals.set(failure.messageId, occurrence);
    return [];
  };
};
