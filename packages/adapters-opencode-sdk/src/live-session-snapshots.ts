import type {
  AgentPendingApprovalRequest,
  AgentPendingQuestionRequest,
  AgentSessionAssociation,
  AgentSessionRuntimeActivity,
  AgentSessionRuntimeSnapshotSource,
  SessionRef,
} from "@openducktor/core";
import type { SessionStatus } from "@opencode-ai/sdk/v2/client";
import { unwrapData } from "./data-utils";
import {
  opencodeSessionDetailPayloadSchema,
  parseOpencodeSessionListPayload,
  type ParsedOpencodeSession,
} from "./opencode-ingress";
import { listOpencodeLiveSessionPendingInput } from "./pending-input-ops";
import { clearAwaitingRuntimeTurnStart, isAwaitingRuntimeTurnStart } from "./session-activity";
import { toIsoFromEpoch } from "./session-runtime-utils";
import type { ClientFactory, ReadOpencodeDirectory, SessionRecord } from "./types";
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

export type OpencodeWorkflowRootRead =
  | {
      readonly type: "present";
      readonly ref: SessionRef;
      readonly sources: OpencodeRuntimeSnapshotSource[];
    }
  | { readonly type: "missing"; readonly ref: SessionRef };

type ApplyOpencodeAwaitingTurnStartToRuntimeSnapshotInput = {
  sessions: ReadonlyMap<string, SessionRecord>;
  runtimeId: string;
  snapshot: OpencodeRuntimeSnapshotSource;
};

export const applyOpencodeAwaitingTurnStartToRuntimeSnapshot = ({
  sessions,
  runtimeId,
  snapshot,
}: ApplyOpencodeAwaitingTurnStartToRuntimeSnapshotInput): OpencodeRuntimeSnapshotSource => {
  const localSession = sessions.get(snapshot.externalSessionId);
  if (!localSession || localSession.runtimeId !== runtimeId) {
    return snapshot;
  }

  const hasRuntimeTurnStartEvidence =
    snapshot.runtimeActivity !== "idle" ||
    snapshot.pendingApprovals.length > 0 ||
    snapshot.pendingQuestions.length > 0;
  if (hasRuntimeTurnStartEvidence) {
    clearAwaitingRuntimeTurnStart(localSession);
    return snapshot;
  }
  if (!isAwaitingRuntimeTurnStart(localSession)) {
    return snapshot;
  }
  return { ...snapshot, runtimeActivity: "running" };
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
        const [statusResult, pendingInputResult] = await Promise.allSettled([
          unscopedClient.session.status({ directory }),
          listOpencodeLiveSessionPendingInput(createClient, {
            runtimeEndpoint,
            workingDirectory: directory,
          }),
        ]);
        if (statusResult.status === "rejected") {
          throw statusResult.reason;
        }
        if (pendingInputResult.status === "rejected") {
          throw pendingInputResult.reason;
        }
        return {
          directory,
          statuses: toOpencodeSessionStatusMap(
            unwrapData(statusResult.value, "get session status"),
            directory,
          ),
          pendingInput: pendingInputResult.value,
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

export const readOpencodeWorkflowRoots = async ({
  createClient,
  runtimeEndpoint,
  refs,
  readDirectory,
  now,
  onRootPresent,
}: {
  createClient: ClientFactory;
  runtimeEndpoint: string;
  refs: ReadonlyArray<SessionRef>;
  readDirectory: ReadOpencodeDirectory;
  now: () => string;
  onRootPresent: (ref: SessionRef, detail: ParsedOpencodeSession) => Promise<void>;
}): Promise<OpencodeWorkflowRootRead[]> => {
  const results = await Promise.all(
    refs.map(async (ref) => {
      if (ref.runtimeKind !== "opencode") {
        throw new Error(
          `Cannot refresh registered OpenCode session '${ref.externalSessionId}' for runtime '${ref.runtimeKind}'.`,
        );
      }
      return readDirectory(ref.workingDirectory, async () => {
        const client = createClient({
          runtimeEndpoint,
          workingDirectory: ref.workingDirectory,
        });
        const detailResponse = await client.session.get({
          directory: ref.workingDirectory,
          sessionID: ref.externalSessionId,
        });
        const missingRoot =
          detailResponse.response?.status === 404 &&
          z.object({ name: z.literal("NotFoundError") }).safeParse(detailResponse.error).success;
        if (missingRoot) {
          return { type: "missing", ref } as const;
        }
        const detail = opencodeSessionDetailPayloadSchema.parse(
          unwrapData(detailResponse, "get registered session"),
        );
        if (detail.id !== ref.externalSessionId || detail.directory !== ref.workingDirectory) {
          throw new Error(
            `OpenCode returned session '${detail.id}' in '${detail.directory}' for registered session '${ref.externalSessionId}' in '${ref.workingDirectory}'.`,
          );
        }
        await onRootPresent(ref, detail);

        const sessions = new Map<string, ParsedOpencodeSession>();
        const queue = [detail];
        for (let index = 0; index < queue.length; index += 1) {
          const parent = queue[index];
          if (!parent || sessions.has(parent.id)) {
            continue;
          }
          sessions.set(parent.id, parent);
          const childrenResponse = await client.session.children({
            directory: ref.workingDirectory,
            sessionID: parent.id,
          });
          const children = z
            .array(opencodeSessionDetailPayloadSchema)
            .parse(unwrapData(childrenResponse, "get registered session children"));
          for (const child of children) {
            if (child.parentID !== parent.id) {
              throw new Error(
                `OpenCode child session '${child.id}' does not name registered lineage parent '${parent.id}'.`,
              );
            }
            queue.push(child);
          }
        }
        const [statusResponse, pendingBySessionId] = await Promise.all([
          client.session.status({ directory: ref.workingDirectory }),
          listOpencodeLiveSessionPendingInput(createClient, {
            runtimeEndpoint,
            workingDirectory: ref.workingDirectory,
          }),
        ]);
        const statuses = toOpencodeSessionStatusMap(
          unwrapData(statusResponse, "get session status"),
          ref.workingDirectory,
        );
        const sources = [...sessions.values()].map((session) => {
          const pending = pendingBySessionId[session.id] ?? { approvals: [], questions: [] };
          const source: OpencodeRuntimeSnapshotSource = {
            externalSessionId: session.id,
            sessionAssociation: { kind: "unbound" },
            title: session.title,
            workingDirectory: ref.workingDirectory,
            startedAt: toIsoFromEpoch(session.time.created, now),
            runtimeActivity: toOpencodeRuntimeActivity(statuses[session.id]),
            pendingApprovals: pending.approvals,
            pendingQuestions: pending.questions,
          };
          if (session.parentID) {
            source.parentExternalSessionId = session.parentID;
          }
          return source;
        });
        return { type: "present", ref, sources } as const;
      });
    }),
  );
  return results.filter((result): result is OpencodeWorkflowRootRead => result !== null);
};
