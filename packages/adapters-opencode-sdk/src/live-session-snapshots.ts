import type {
  AgentPendingApprovalRequest,
  AgentPendingQuestionRequest,
  LiveAgentSessionSnapshot,
  LiveAgentSessionSummary,
} from "@openducktor/core";
import { unwrapData } from "./data-utils";
import { listOpencodeLiveSessionPendingInput } from "./message-ops";
import { toIsoFromEpoch } from "./session-runtime-utils";
import type { ClientFactory } from "./types";

export type ListOpencodeLiveAgentSessionSnapshotsInput = {
  createClient: ClientFactory;
  runtimeEndpoint: string;
  directories?: string[];
  now: () => string;
};

type OpencodeLiveSessionPendingInputBySessionId = Record<
  string,
  {
    approvals: AgentPendingApprovalRequest[];
    questions: AgentPendingQuestionRequest[];
  }
>;

export const toLiveAgentSessionStatus = (status: unknown): LiveAgentSessionSummary["status"] => {
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

export const toLiveAgentSessionStatusMap = (
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

export const requireSessionDirectory = (directory: unknown, sessionId: string): string => {
  const normalized = normalizeSessionDirectory(directory);
  if (normalized !== undefined) {
    return normalized;
  }
  throw new Error(`Malformed Opencode session payload for '${sessionId}': missing directory.`);
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
      title: session.title,
      workingDirectory: normalizedDirectory,
      startedAt: toIsoFromEpoch(session.time?.created, now),
      status: toLiveAgentSessionStatus(directoryStatuses?.[session.id]),
      pendingApprovals: pendingInputBySession[session.id]?.approvals ?? [],
      pendingQuestions: pendingInputBySession[session.id]?.questions ?? [],
    };
  });
};
