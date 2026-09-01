import type {
  AgentPendingApprovalRequest,
  AgentPendingQuestionRequest,
  AgentSessionAssociation,
  AgentSessionRuntimeActivity,
  AgentSessionRuntimeSnapshotSource,
} from "@openducktor/core";
import type { SessionStatus } from "@opencode-ai/sdk/v2/client";
import { unwrapData } from "./data-utils";
import { parseOpencodeSessionListPayload, type ParsedOpencodeSession } from "./opencode-ingress";
import { listOpencodeLiveSessionPendingInput } from "./pending-input-ops";
import { toIsoFromEpoch } from "./session-runtime-utils";
import type { ClientFactory, ReadOpencodeDirectory } from "./types";
import { z } from "zod";

export type ListOpencodeRuntimeSnapshotSourcesInput = {
  createClient: ClientFactory;
  runtimeEndpoint: string;
  directories?: string[];
  readDirectory: ReadOpencodeDirectory;
  now: () => string;
};

export type OpencodeRuntimeSnapshotSource = AgentSessionRuntimeSnapshotSource & {
  externalSessionId: string;
  sessionAssociation: AgentSessionAssociation;
  workingDirectory: string;
};

type OpencodeLiveSessionPendingInputBySessionId = Record<
  string,
  {
    approvals: AgentPendingApprovalRequest[];
    questions: AgentPendingQuestionRequest[];
  }
>;

const opencodeSessionStatusSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("idle") }),
  z.object({
    type: z.literal("retry"),
    attempt: z.number().int().nonnegative(),
    message: z.string(),
    action: z
      .object({
        reason: z.string(),
        provider: z.string(),
        title: z.string(),
        message: z.string(),
        label: z.string(),
        link: z.string().optional(),
      })
      .optional(),
    next: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("busy") }),
]);

const opencodeSessionStatusMapSchema = z.record(z.string(), opencodeSessionStatusSchema);
type OpencodeSessionStatus = z.output<typeof opencodeSessionStatusSchema>;
type OpencodeSessionStatusMap = z.output<typeof opencodeSessionStatusMapSchema>;

const toOpencodeRuntimeActivity = (
  status: OpencodeSessionStatus | undefined,
): AgentSessionRuntimeActivity => {
  if (status === undefined) {
    return "idle";
  }
  switch (status.type) {
    case "busy":
      return "running";
    case "idle":
      return "idle";
    case "retry":
      return "retrying";
  }
};

const toOpencodeSessionStatusMap = (
  payload: Record<string, SessionStatus>,
  directory: string,
): OpencodeSessionStatusMap => {
  const parsedPayload = opencodeSessionStatusMapSchema.safeParse(payload);
  if (!parsedPayload.success) {
    throw new Error(`Malformed Opencode session status response for directory '${directory}'.`);
  }
  return parsedPayload.data;
};

const normalizeSessionDirectory = (directory: string | undefined): string | undefined => {
  if (directory === undefined) {
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

const requireSessionDirectory = (
  directory: ParsedOpencodeSession["directory"],
  sessionId: string,
): string => {
  const normalized = normalizeSessionDirectory(directory);
  if (normalized !== undefined) {
    return normalized;
  }
  throw new Error(`Malformed Opencode session payload for '${sessionId}': missing directory.`);
};

const readParentExternalSessionId = (session: ParsedOpencodeSession): string | undefined => {
  const parentId = session.parentID?.trim();
  return parentId || undefined;
};

const mergeOpencodePendingInputBySession = (
  entries: OpencodeLiveSessionPendingInputBySessionId[],
) => {
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

  return merged satisfies OpencodeLiveSessionPendingInputBySessionId;
};

export const listOpencodeRuntimeSnapshotSources = async ({
  createClient,
  runtimeEndpoint,
  directories,
  readDirectory,
  now,
}: ListOpencodeRuntimeSnapshotSourcesInput): Promise<OpencodeRuntimeSnapshotSource[]> => {
  const unscopedClient = createClient({ runtimeEndpoint });
  const sessionsPayload = await unscopedClient.session.list();
  const sessions = parseOpencodeSessionListPayload(unwrapData(sessionsPayload, "list sessions"));
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
  const directoryEntries = await Promise.all(
    sessionDirectories.map((directory) =>
      readDirectory(directory, async () => {
        const [statusPayload, pendingInput] = await Promise.all([
          unscopedClient.session.status({ directory }),
          listOpencodeLiveSessionPendingInput(createClient, {
            runtimeEndpoint,
            workingDirectory: directory,
          }),
        ]);
        return {
          directory,
          statuses: toOpencodeSessionStatusMap(
            unwrapData(statusPayload, "get session status"),
            directory,
          ),
          pendingInput,
        };
      }),
    ),
  );
  const availableDirectoryEntries = directoryEntries.filter(
    (entry): entry is NonNullable<typeof entry> => entry !== null,
  );
  const statusesByDirectory = new Map(
    availableDirectoryEntries.map(({ directory, statuses }) => [directory, statuses]),
  );
  const availableDirectories = new Set(statusesByDirectory.keys());
  const pendingInputBySession = mergeOpencodePendingInputBySession(
    availableDirectoryEntries.map(({ pendingInput }) => pendingInput),
  );

  return filteredSessions.flatMap((session) => {
    const normalizedDirectory = requireSessionDirectory(session.directory, session.id);
    if (!availableDirectories.has(normalizedDirectory)) {
      return [];
    }
    const directoryStatuses = statusesByDirectory.get(normalizedDirectory);
    const parentExternalSessionId = readParentExternalSessionId(session);
    const snapshot: OpencodeRuntimeSnapshotSource = {
      externalSessionId: session.id,
      sessionAssociation: { kind: "unbound" },
      title: session.title,
      workingDirectory: normalizedDirectory,
      startedAt: toIsoFromEpoch(session.time?.created, now),
      runtimeActivity: toOpencodeRuntimeActivity(directoryStatuses?.[session.id]),
      pendingApprovals: pendingInputBySession[session.id]?.approvals ?? [],
      pendingQuestions: pendingInputBySession[session.id]?.questions ?? [],
    };
    if (parentExternalSessionId) {
      snapshot.parentExternalSessionId = parentExternalSessionId;
    }
    return [snapshot];
  });
};
