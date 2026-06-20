import type {
  AgentPendingApprovalRequest,
  AgentPendingQuestionRequest,
  AgentSessionRuntimeActivity,
  AgentSessionRuntimeSnapshotSource,
} from "@openducktor/core";
import { formatWorkflowAgentSessionTitle } from "@openducktor/core";
import { unwrapData } from "./data-utils";
import { readStringProp } from "./guards";
import { listOpencodeLiveSessionPendingInput } from "./pending-input-ops";
import { isLocalSessionBusy, isUserMessageSendInFlight } from "./session-activity";
import { toIsoFromEpoch } from "./session-runtime-utils";
import type { ClientFactory, SessionRecord } from "./types";

export type ListOpencodeRuntimeSnapshotSourcesInput = {
  createClient: ClientFactory;
  runtimeEndpoint: string;
  directories?: string[];
  now: () => string;
};

export type OpencodeLocalRuntimeSnapshotInput = {
  sessions: ReadonlyMap<string, SessionRecord>;
  runtimeId: string;
  repoPath: string;
  runtimeKind: string;
};

export type ListOpencodeLocalRuntimeSnapshotsInput = OpencodeLocalRuntimeSnapshotInput & {
  directories?: string[];
  existingExternalSessionIds: ReadonlySet<string>;
};

export type ReadOpencodeLocalRuntimeSnapshotInput = OpencodeLocalRuntimeSnapshotInput & {
  workingDirectory: string;
  externalSessionId: string;
};

export type ApplyOpencodeInFlightSendToRuntimeSnapshotInput = {
  sessions: ReadonlyMap<string, SessionRecord>;
  runtimeId: string;
  snapshot: OpencodeRuntimeSnapshotSource;
};

export type OpencodeRuntimeSnapshotSource = AgentSessionRuntimeSnapshotSource & {
  externalSessionId: string;
  workingDirectory: string;
};

type OpencodeLiveSessionPendingInputBySessionId = Record<
  string,
  {
    approvals: AgentPendingApprovalRequest[];
    questions: AgentPendingQuestionRequest[];
  }
>;

const toOpencodeRuntimeActivity = (status: unknown): AgentSessionRuntimeActivity => {
  if (status === undefined || status === null) {
    return "idle";
  }
  if (typeof status !== "object" || !("type" in status)) {
    throw new Error("Malformed live agent session status payload from Opencode.");
  }

  const type = (status as { type?: unknown }).type;
  if (type === "busy") {
    return "running";
  }
  if (type === "idle") {
    return "idle";
  }

  if (type === "retry") {
    return "retrying";
  }

  throw new Error(`Unsupported Opencode live agent session status type: ${String(type)}`);
};

const toOpencodeSessionStatusMap = (
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

export const toOpencodeLocalRuntimeSnapshot = (
  session: SessionRecord,
): OpencodeRuntimeSnapshotSource => ({
  externalSessionId: session.externalSessionId,
  title: session.input.role
    ? formatWorkflowAgentSessionTitle(session.input.role, session.input.taskId)
    : "OpenCode",
  workingDirectory: session.input.workingDirectory,
  startedAt: session.summary.startedAt,
  runtimeActivity: isLocalSessionBusy(session) ? "running" : "idle",
  pendingApprovals: [],
  pendingQuestions: [],
});

export const applyOpencodeInFlightSendToRuntimeSnapshot = ({
  sessions,
  runtimeId,
  snapshot,
}: ApplyOpencodeInFlightSendToRuntimeSnapshotInput): OpencodeRuntimeSnapshotSource => {
  const localSession = sessions.get(snapshot.externalSessionId);
  if (
    !localSession ||
    localSession.runtimeId !== runtimeId ||
    !isUserMessageSendInFlight(localSession) ||
    snapshot.runtimeActivity !== "idle"
  ) {
    return snapshot;
  }

  return {
    ...snapshot,
    runtimeActivity: "running",
  };
};

export const listOpencodeLocalRuntimeSnapshots = ({
  sessions,
  runtimeId,
  repoPath,
  runtimeKind,
  directories,
  existingExternalSessionIds,
}: ListOpencodeLocalRuntimeSnapshotsInput): OpencodeRuntimeSnapshotSource[] => {
  const requestedDirectorySet =
    directories && directories.length > 0
      ? new Set(
          directories
            .map((directory) => normalizeSessionDirectory(directory))
            .filter((directory): directory is string => directory !== undefined),
        )
      : null;

  const snapshots: OpencodeRuntimeSnapshotSource[] = [];
  for (const session of sessions.values()) {
    if (
      existingExternalSessionIds.has(session.externalSessionId) ||
      session.runtimeId !== runtimeId ||
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
      ...toOpencodeLocalRuntimeSnapshot(session),
      workingDirectory,
    });
  }
  return snapshots;
};

export const findOpencodeLocalRuntimeSnapshot = ({
  sessions,
  runtimeId,
  repoPath,
  runtimeKind,
  workingDirectory,
  externalSessionId,
}: ReadOpencodeLocalRuntimeSnapshotInput): OpencodeRuntimeSnapshotSource | null => {
  const localSession = sessions.get(externalSessionId);
  const localSessionWorkingDirectory = normalizeSessionDirectory(
    localSession?.input.workingDirectory,
  );
  const requestedWorkingDirectory = normalizeSessionDirectory(workingDirectory);
  if (
    !localSession ||
    localSession.runtimeId !== runtimeId ||
    localSession.input.repoPath !== repoPath ||
    localSession.input.runtimeKind !== runtimeKind ||
    localSessionWorkingDirectory === undefined ||
    localSessionWorkingDirectory !== requestedWorkingDirectory
  ) {
    return null;
  }
  return {
    ...toOpencodeLocalRuntimeSnapshot(localSession),
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

const readParentExternalSessionId = (session: unknown): string | undefined => {
  const parentId = readStringProp(session, ["parentID", "parentId", "parent_id"])?.trim();
  return parentId || undefined;
};

const mergeOpencodePendingInputBySession = (
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

export const listOpencodeRuntimeSnapshotSources = async ({
  createClient,
  runtimeEndpoint,
  directories,
  now,
}: ListOpencodeRuntimeSnapshotSourcesInput): Promise<OpencodeRuntimeSnapshotSource[]> => {
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
        toOpencodeSessionStatusMap(unwrapData(statusPayload, "get session status"), directory),
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
  const pendingInputBySession = mergeOpencodePendingInputBySession(pendingInputEntries);

  return filteredSessions.map((session) => {
    const normalizedDirectory = requireSessionDirectory(session.directory, session.id);
    const directoryStatuses = statusesByDirectory.get(normalizedDirectory);
    const parentExternalSessionId = readParentExternalSessionId(session);
    return {
      externalSessionId: session.id,
      ...(parentExternalSessionId ? { parentExternalSessionId } : {}),
      title: requireSessionTitle(session.title, session.id),
      workingDirectory: normalizedDirectory,
      startedAt: toIsoFromEpoch(session.time?.created, now),
      runtimeActivity: toOpencodeRuntimeActivity(directoryStatuses?.[session.id]),
      pendingApprovals: pendingInputBySession[session.id]?.approvals ?? [],
      pendingQuestions: pendingInputBySession[session.id]?.questions ?? [],
    };
  });
};
