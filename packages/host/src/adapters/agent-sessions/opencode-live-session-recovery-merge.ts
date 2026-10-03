import { refKey } from "./opencode-live-session-normalization";
import type {
  OpenCodePendingRequestRouter,
  OpenCodePendingRoute,
} from "./opencode-pending-request-router";
import { openCodeActivityForPending } from "./opencode-live-session-state-policy";
import type { OpenCodeLiveSession } from "./opencode-live-session-state-policy";

const snapshotFields = [
  "title",
  "startedAt",
  "parentExternalSessionId",
  "contextUsage",
  "model",
  "repositoryScope",
] as const;
type SourceField = (typeof snapshotFields)[number] | "runtimeActivity";

export type OpenCodeSourceRead = {
  readonly versions: ReadonlyMap<string, number>;
  readonly sessions: ReadonlyMap<string, OpenCodeLiveSession>;
  readonly fields: ReadonlyMap<string, ReadonlyMap<SourceField, number>>;
  readonly pending: ReadonlyMap<string, number>;
};

/** Track live changes so source reads cannot replace newer fields or replies. */
export const createOpenCodeSourceReadTracker = (
  versions: Map<string, number>,
  sessions: ReadonlyMap<string, OpenCodeLiveSession>,
  pendingRequests: OpenCodePendingRequestRouter,
) => {
  const fieldVersions = new Map<string, Map<SourceField, number>>();
  const touch = (key: string, field: SourceField): void => {
    const fields = fieldVersions.get(key) ?? new Map<SourceField, number>();
    fields.set(field, (fields.get(field) ?? 0) + 1);
    fieldVersions.set(key, fields);
  };
  return {
    touch: (key: string, field: SourceField): void => {
      touch(key, field);
      versions.set(key, (versions.get(key) ?? 0) + 1);
    },
    record: (previous: OpenCodeLiveSession | undefined, next: OpenCodeLiveSession): void => {
      const key = refKey(next.snapshot.ref);
      for (const field of snapshotFields)
        if (JSON.stringify(previous?.snapshot[field]) !== JSON.stringify(next.snapshot[field]))
          touch(key, field);
      if (previous?.runtimeActivity !== next.runtimeActivity) touch(key, "runtimeActivity");
    },
    finish: (read: OpenCodeSourceRead): void => {
      pendingRequests.finishRead(read.pending);
    },
    capture: (): OpenCodeSourceRead => ({
      versions: new Map(versions),
      sessions: new Map(sessions),
      fields: new Map([...fieldVersions].map(([key, fields]) => [key, new Map(fields)])),
      pending: pendingRequests.captureVersions(),
    }),
    merge: (
      session: OpenCodeLiveSession,
      read: OpenCodeSourceRead,
      routes: ReadonlyArray<OpenCodePendingRoute>,
    ): OpenCodeLiveSession | null => {
      const key = refKey(session.snapshot.ref);
      const current = sessions.get(key);
      if (!current && (read.versions.get(key) ?? 0) !== (versions.get(key) ?? 0)) return null;
      const resolved = new Set(
        routes
          .filter(
            (route) =>
              pendingRequests.changedSince(route, read.pending) &&
              !pendingRequests.findNative(route.ref, route.nativeRequestId, route.kind),
          )
          .map((route) => route.occurrenceId),
      );
      const recovered = {
        ...session,
        snapshot: {
          ...session.snapshot,
          pendingApprovals: session.snapshot.pendingApprovals.filter(
            (request) => !resolved.has(request.requestId),
          ),
          pendingQuestions: session.snapshot.pendingQuestions.filter(
            (request) => !resolved.has(request.requestId),
          ),
        },
      };
      return mergeOpenCodeRecoveredSession(
        recovered,
        read.sessions.get(key),
        current,
        new Set(
          [...snapshotFields, "runtimeActivity" as const].filter(
            (field) =>
              (read.fields.get(key)?.get(field) ?? 0) !== (fieldVersions.get(key)?.get(field) ?? 0),
          ),
        ),
      );
    },
  };
};

const mergeOpenCodeRecoveredSession = (
  recovered: OpenCodeLiveSession,
  baseline: OpenCodeLiveSession | undefined,
  current: OpenCodeLiveSession | undefined,
  changedFields: ReadonlySet<SourceField>,
): OpenCodeLiveSession => {
  if (!current) return recovered;
  const snapshot = { ...recovered.snapshot };
  for (const field of snapshotFields) {
    if (!changedFields.has(field)) continue;
    Object.assign(snapshot, { [field]: current.snapshot[field] });
  }
  snapshot.pendingApprovals = mergePending(
    recovered.snapshot.pendingApprovals,
    baseline?.snapshot.pendingApprovals ?? [],
    current.snapshot.pendingApprovals,
  );
  snapshot.pendingQuestions = mergePending(
    recovered.snapshot.pendingQuestions,
    baseline?.snapshot.pendingQuestions ?? [],
    current.snapshot.pendingQuestions,
  );
  const merged = {
    ...recovered,
    snapshot,
    runtimeActivity: changedFields.has("runtimeActivity")
      ? current.runtimeActivity
      : recovered.runtimeActivity,
  };
  snapshot.activity = openCodeActivityForPending(merged);
  return merged;
};

const mergePending = <Request extends { requestId: string }>(
  recovered: Request[],
  baseline: Request[],
  current: Request[],
): Request[] => {
  const before = new Map(baseline.map((request) => [request.requestId, request]));
  const currentIds = new Set(current.map((request) => request.requestId));
  const changed = new Map(
    current
      .filter(
        (request) => JSON.stringify(before.get(request.requestId)) !== JSON.stringify(request),
      )
      .map((request) => [request.requestId, request]),
  );
  const result = recovered
    .filter((request) => !before.has(request.requestId) || currentIds.has(request.requestId))
    .map((request) => changed.get(request.requestId) ?? request);
  const included = new Set(result.map((request) => request.requestId));
  return [
    ...result,
    ...current.filter(
      (request) => changed.has(request.requestId) && !included.has(request.requestId),
    ),
  ];
};
