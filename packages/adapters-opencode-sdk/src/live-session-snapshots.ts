import type {
  AgentPendingApprovalRequest,
  AgentPendingQuestionRequest,
  LiveAgentSessionSnapshot,
  LiveAgentSessionSummary,
} from "@openducktor/core";
import { formatWorkflowAgentSessionTitle } from "@openducktor/core";
import { unwrapData } from "./data-utils";
import { listOpencodeLiveSessionPendingInput } from "./message-ops";
import { isLocalSessionBusy, isUserMessageSendInFlight } from "./session-activity";
import { toIsoFromEpoch } from "./session-runtime-utils";
import type { ClientFactory, SessionRecord } from "./types";

export type ListOpencodeLiveAgentSessionSnapshotsInput = {
  createClient: ClientFactory;
  runtimeEndpoint: string;
  directories?: string[];
  now: () => string;
};

export type OpencodeLocalPresenceSnapshotInput = {
  sessions: ReadonlyMap<string, SessionRecord>;
  runtimeEndpoint: string;
  repoPath: string;
  runtimeKind: string;
};

export type ListOpencodeLocalPresenceSnapshotsInput = OpencodeLocalPresenceSnapshotInput & {
  directories?: string[];
  existingExternalSessionIds: ReadonlySet<string>;
};

export type ReadOpencodeLocalPresenceSnapshotInput = OpencodeLocalPresenceSnapshotInput & {
  workingDirectory: string;
  externalSessionId: string;
};

export type ApplyOpencodeInFlightSendToPresenceSnapshotInput = {
  sessions: ReadonlyMap<string, SessionRecord>;
  runtimeEndpoint: string;
  snapshot: LiveAgentSessionSnapshot;
};

type OpencodeLiveSessionPendingInputBySessionId = Record<
  string,
  {
    approvals: AgentPendingApprovalRequest[];
    questions: AgentPendingQuestionRequest[];
  }
>;

const toLiveAgentSessionStatus = (status: unknown): LiveAgentSessionSummary["status"] => {
  if (status === undefined || status === null) {
    return {
      type: "idle",
    };
  }
  if (typeof status !== "object" || !("type" in status)) {
    throw new Error("Malformed live agent session status payload from Opencode.");
  }

  const type = (status as { type?: unknown }).type;
  if (type === "busy" || type === "idle") {
    return {
      type,
    };
  }

  if (type === "retry") {
    const retryStatus = status as {
      attempt?: unknown;
      message?: unknown;
      next?: unknown;
      nextEpochMs?: unknown;
    };
    const attempt = retryStatus.attempt;
    const message = retryStatus.message;
    const nextEpochMs =
      typeof retryStatus.nextEpochMs === "number" ? retryStatus.nextEpochMs : retryStatus.next;
    if (typeof attempt !== "number") {
      throw new Error("Malformed Opencode retry status: missing numeric attempt.");
    }
    if (typeof message !== "string") {
      throw new Error("Malformed Opencode retry status: missing message.");
    }
    if (typeof nextEpochMs !== "number") {
      throw new Error("Malformed Opencode retry status: missing next epoch.");
    }
    return {
      type: "retry",
      attempt,
      message,
      nextEpochMs,
    };
  }

  throw new Error(`Unsupported Opencode live agent session status type: ${String(type)}`);
};

const toLiveAgentSessionStatusMap = (
  payload: unknown,
  directory: string,
): Record<string, unknown> => {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error(
      `Malformed Opencode session status response for directory '${directory}': expected an object map.`,
    );
  }
  return payload as Record<string, unknown>;
};

export const normalizeSessionDirectory = (directory: unknown): string | undefined => {
  if (typeof directory !== "string") {
    return undefined;
  }
  let normalized = directory.trim();
  if (/^[A-Za-z]:[\\/]$/.test(normalized)) {
    return normalized;
  }
  while (normalized.length > 1 && /[\\/]/.test(normalized.at(-1) ?? "")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized.length > 0 ? normalized : undefined;
};

export const toOpencodeLocalPresenceSnapshot = (
  session: SessionRecord,
): LiveAgentSessionSnapshot => ({
  externalSessionId: session.externalSessionId,
  title: session.input.role
    ? formatWorkflowAgentSessionTitle(session.input.role, session.input.taskId)
    : "OpenCode",
  workingDirectory: session.input.workingDirectory,
  startedAt: session.summary.startedAt,
  status: isLocalSessionBusy(session) ? { type: "busy" } : { type: "idle" },
  pendingApprovals: [],
  pendingQuestions: [],
});

export const applyOpencodeInFlightSendToPresenceSnapshot = ({
  sessions,
  runtimeEndpoint,
  snapshot,
}: ApplyOpencodeInFlightSendToPresenceSnapshotInput): LiveAgentSessionSnapshot => {
  const localSession = sessions.get(snapshot.externalSessionId);
  if (
    !localSession ||
    localSession.eventTransportKey !== runtimeEndpoint ||
    !isUserMessageSendInFlight(localSession) ||
    snapshot.status.type !== "idle"
  ) {
    return snapshot;
  }

  return {
    ...snapshot,
    status: { type: "busy" },
  };
};

export const listOpencodeLocalPresenceSnapshots = ({
  sessions,
  runtimeEndpoint,
  repoPath,
  runtimeKind,
  directories,
  existingExternalSessionIds,
}: ListOpencodeLocalPresenceSnapshotsInput): LiveAgentSessionSnapshot[] => {
  const requestedDirectorySet =
    directories && directories.length > 0
      ? new Set(
          directories
            .map((directory) => normalizeSessionDirectory(directory))
            .filter((directory): directory is string => directory !== undefined),
        )
      : null;

  const snapshots: LiveAgentSessionSnapshot[] = [];
  for (const session of sessions.values()) {
    if (
      existingExternalSessionIds.has(session.externalSessionId) ||
      session.eventTransportKey !== runtimeEndpoint ||
      session.input.repoPath !== repoPath ||
      session.input.runtimeKind !== runtimeKind
    ) {
      continue;
    }

    const workingDirectory = normalizeSessionDirectory(session.input.workingDirectory);
    if (!workingDirectory) {
      continue;
    }
    if (requestedDirectorySet && !requestedDirectorySet.has(workingDirectory)) {
      continue;
    }

    snapshots.push({
      ...toOpencodeLocalPresenceSnapshot(session),
      workingDirectory,
    });
  }
  return snapshots;
};

export const findOpencodeLocalPresenceSnapshot = ({
  sessions,
  runtimeEndpoint,
  repoPath,
  runtimeKind,
  workingDirectory,
  externalSessionId,
}: ReadOpencodeLocalPresenceSnapshotInput): LiveAgentSessionSnapshot | null => {
  const localSession = sessions.get(externalSessionId);
  const localSessionWorkingDirectory = normalizeSessionDirectory(
    localSession?.input.workingDirectory,
  );
  const requestedWorkingDirectory = normalizeSessionDirectory(workingDirectory);
  if (
    !localSession ||
    localSession.eventTransportKey !== runtimeEndpoint ||
    localSession.input.repoPath !== repoPath ||
    localSession.input.runtimeKind !== runtimeKind ||
    localSessionWorkingDirectory === undefined ||
    localSessionWorkingDirectory !== requestedWorkingDirectory
  ) {
    return null;
  }
  return {
    ...toOpencodeLocalPresenceSnapshot(localSession),
    workingDirectory: localSessionWorkingDirectory,
  };
};

const requireSessionDirectory = (directory: unknown, sessionId: string): string => {
  const normalized = normalizeSessionDirectory(directory);
  if (normalized !== undefined) {
    return normalized;
  }
  throw new Error(`Malformed Opencode session payload for '${sessionId}': missing directory.`);
};

const requireSessionTitle = (title: unknown, sessionId: string): string => {
  if (typeof title === "string") {
    return title;
  }
  throw new Error(`Malformed Opencode session payload for '${sessionId}': missing title.`);
};

const mergeLiveAgentSessionPendingInput = (
  entries: OpencodeLiveSessionPendingInputBySessionId[],
): OpencodeLiveSessionPendingInputBySessionId => {
  const merged: OpencodeLiveSessionPendingInputBySessionId = {};

  for (const entry of entries) {
    for (const [sessionId, pendingInput] of Object.entries(entry)) {
      const current = merged[sessionId] ?? { approvals: [], questions: [] };
      merged[sessionId] = {
        approvals: [...current.approvals, ...pendingInput.approvals],
        questions: [...current.questions, ...pendingInput.questions],
      };
    }
  }

  return merged;
};

export const listOpencodeLiveAgentSessionSnapshots = async ({
  createClient,
  runtimeEndpoint,
  directories,
  now,
}: ListOpencodeLiveAgentSessionSnapshotsInput): Promise<LiveAgentSessionSnapshot[]> => {
  const unscopedClient = createClient({ runtimeEndpoint });
  const sessionsPayload = await unscopedClient.session.list();
  const sessions = unwrapData(sessionsPayload, "list sessions");
  const requestedDirectorySet =
    directories && directories.length > 0
      ? new Set(
          directories
            .map((directory) => normalizeSessionDirectory(directory))
            .filter((directory): directory is string => directory !== undefined),
        )
      : null;
  const filteredSessions =
    requestedDirectorySet === null
      ? sessions
      : sessions.filter((session) => {
          const directory = normalizeSessionDirectory(session.directory);
          return directory !== undefined && requestedDirectorySet.has(directory);
        });
  const sessionDirectories = Array.from(
    new Set(
      filteredSessions.map((session) => requireSessionDirectory(session.directory, session.id)),
    ),
  );
  const statusEntries = await Promise.all(
    sessionDirectories.map(async (directory) => {
      const statusPayload = await unscopedClient.session.status({ directory });
      return [
        directory,
        toLiveAgentSessionStatusMap(unwrapData(statusPayload, "get session status"), directory),
      ] as const;
    }),
  );
  const statusesByDirectory = new Map(statusEntries);
  const pendingInputEntries = await Promise.all(
    sessionDirectories.map((directory) =>
      listOpencodeLiveSessionPendingInput(createClient, {
        runtimeEndpoint,
        workingDirectory: directory,
      }),
    ),
  );
  const pendingInputBySession = mergeLiveAgentSessionPendingInput(pendingInputEntries);

  return filteredSessions.map((session) => {
    const normalizedDirectory = requireSessionDirectory(session.directory, session.id);
    const directoryStatuses = statusesByDirectory.get(normalizedDirectory);
    return {
      externalSessionId: session.id,
      title: requireSessionTitle(session.title, session.id),
      workingDirectory: normalizedDirectory,
      startedAt: toIsoFromEpoch(session.time?.created, now),
      status: toLiveAgentSessionStatus(directoryStatuses?.[session.id]),
      pendingApprovals: pendingInputBySession[session.id]?.approvals ?? [],
      pendingQuestions: pendingInputBySession[session.id]?.questions ?? [],
    };
  });
};
