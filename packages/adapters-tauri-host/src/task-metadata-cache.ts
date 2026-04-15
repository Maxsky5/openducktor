import {
  type AgentSessionRecord,
  agentSessionRecordSchema,
  type TaskMetadataPayload,
  taskMetadataPayloadSchema,
} from "@openducktor/contracts";
import type { InvokeFn } from "./invoke-utils";

type MetadataIssue = {
  path: PropertyKey[];
  message: string;
};

export type ParsedTaskMetadata = Omit<TaskMetadataPayload, "agentSessions"> & {
  agentSessions: AgentSessionRecord[];
};

export type TaskMetadataReadOptions = {
  forceFresh?: boolean;
};

const parseAgentSessions = (entries: unknown[], taskId: string): AgentSessionRecord[] => {
  const sessions: AgentSessionRecord[] = [];
  const invalidEntries: string[] = [];

  for (const [index, entry] of entries.entries()) {
    const parsed = agentSessionRecordSchema.safeParse(entry);
    if (parsed.success) {
      sessions.push(parsed.data);
      continue;
    }

    invalidEntries.push(
      `agentSessions[${index}]: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
    );
  }

  if (invalidEntries.length > 0) {
    throw new Error(
      `Task metadata for ${taskId} contains invalid persisted agent sessions: ${invalidEntries.join(" | ")}`,
    );
  }

  return sessions;
};

const isAgentSessionIssue = (issue: MetadataIssue): boolean => issue.path[0] === "agentSessions";

const formatAgentSessionIssue = (issue: MetadataIssue): string => {
  const path = issue.path.length > 1 ? issue.path.slice(1) : ["unknown"];
  const [index, ...rest] = path;
  const suffix = rest.length > 0 ? `.${rest.join(".")}` : "";
  return `agentSessions[${String(index)}]${suffix}: ${issue.message}`;
};

const parseTaskMetadataPayload = (payload: unknown, taskId: string): TaskMetadataPayload => {
  const parsed = taskMetadataPayloadSchema.safeParse(payload);
  if (parsed.success) {
    return parsed.data;
  }

  const agentSessionIssues = parsed.error.issues.filter(isAgentSessionIssue);
  if (agentSessionIssues.length === 0) {
    throw parsed.error;
  }

  throw new Error(
    `Task metadata for ${taskId} contains invalid persisted agent sessions: ${agentSessionIssues
      .map(formatAgentSessionIssue)
      .join(" | ")}`,
  );
};

export class TaskMetadataCache {
  private readonly inFlight = new Map<string, Promise<ParsedTaskMetadata>>();
  private readonly forceFreshInFlight = new Map<string, Promise<ParsedTaskMetadata>>();
  private readonly cache = new Map<string, ParsedTaskMetadata>();
  private readonly latestFetchTokenByKey = new Map<string, number>();
  private nextFetchToken = 0;

  private key(repoPath: string, taskId: string): string {
    return `${repoPath}::${taskId}`;
  }

  invalidate(repoPath: string, taskId: string): void {
    const cacheKey = this.key(repoPath, taskId);
    this.cache.delete(cacheKey);
    this.inFlight.delete(cacheKey);
    this.forceFreshInFlight.delete(cacheKey);
    this.latestFetchTokenByKey.delete(cacheKey);
  }

  invalidateRepo(repoPath: string): void {
    for (const cacheKey of [...this.cache.keys()]) {
      if (cacheKey.startsWith(`${repoPath}::`)) {
        this.cache.delete(cacheKey);
      }
    }
    for (const cacheKey of [...this.inFlight.keys()]) {
      if (cacheKey.startsWith(`${repoPath}::`)) {
        this.inFlight.delete(cacheKey);
      }
    }
    for (const cacheKey of [...this.forceFreshInFlight.keys()]) {
      if (cacheKey.startsWith(`${repoPath}::`)) {
        this.forceFreshInFlight.delete(cacheKey);
      }
    }
    for (const cacheKey of [...this.latestFetchTokenByKey.keys()]) {
      if (cacheKey.startsWith(`${repoPath}::`)) {
        this.latestFetchTokenByKey.delete(cacheKey);
      }
    }
  }

  private fetchMetadata(
    invokeFn: InvokeFn,
    repoPath: string,
    taskId: string,
    options: TaskMetadataReadOptions,
  ): Promise<ParsedTaskMetadata> {
    const cacheKey = this.key(repoPath, taskId);
    const forceFresh = options.forceFresh === true;

    const activeForceFresh = this.forceFreshInFlight.get(cacheKey);
    if (activeForceFresh) {
      return activeForceFresh;
    }

    if (!forceFresh) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return Promise.resolve(cached);
      }

      const inflight = this.inFlight.get(cacheKey);
      if (inflight) {
        return inflight;
      }
    }

    const fetchToken = this.nextFetchToken + 1;
    this.nextFetchToken = fetchToken;
    this.latestFetchTokenByKey.set(cacheKey, fetchToken);

    const next = invokeFn("task_metadata_get", { repoPath, taskId })
      .then((payload) => {
        const parsed = parseTaskMetadataPayload(payload, taskId);
        const metadata = {
          ...parsed,
          agentSessions: parseAgentSessions(parsed.agentSessions, taskId),
        };

        if (this.latestFetchTokenByKey.get(cacheKey) === fetchToken) {
          this.cache.set(cacheKey, metadata);
        }

        return metadata;
      })
      .finally(() => {
        if (forceFresh) {
          if (this.forceFreshInFlight.get(cacheKey) === next) {
            this.forceFreshInFlight.delete(cacheKey);
          }
          return;
        }

        if (this.inFlight.get(cacheKey) === next) {
          this.inFlight.delete(cacheKey);
        }
      });

    if (forceFresh) {
      this.forceFreshInFlight.set(cacheKey, next);
    } else {
      this.inFlight.set(cacheKey, next);
    }

    return next;
  }

  async get(
    invokeFn: InvokeFn,
    repoPath: string,
    taskId: string,
    options: TaskMetadataReadOptions = {},
  ): Promise<ParsedTaskMetadata> {
    return this.fetchMetadata(invokeFn, repoPath, taskId, options);
  }
}
