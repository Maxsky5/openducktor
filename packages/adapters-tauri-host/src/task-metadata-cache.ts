import {
  type AgentSessionRecord,
  agentSessionRecordSchema,
  type TaskMetadataPayload,
  taskMetadataPayloadSchema,
} from "@openducktor/contracts";
import type { InvokeFn } from "./invoke-utils";

export type ParsedTaskMetadata = Omit<TaskMetadataPayload, "agentSessions"> & {
  agentSessions: AgentSessionRecord[];
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

export class TaskMetadataCache {
  private readonly inFlight = new Map<string, Promise<ParsedTaskMetadata>>();
  private readonly cache = new Map<string, ParsedTaskMetadata>();

  private key(repoPath: string, taskId: string): string {
    return `${repoPath}::${taskId}`;
  }

  invalidate(repoPath: string, taskId: string): void {
    const cacheKey = this.key(repoPath, taskId);
    this.cache.delete(cacheKey);
    this.inFlight.delete(cacheKey);
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
  }

  async get(invokeFn: InvokeFn, repoPath: string, taskId: string): Promise<ParsedTaskMetadata> {
    const cacheKey = this.key(repoPath, taskId);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const inflight = this.inFlight.get(cacheKey);
    if (inflight) {
      return inflight;
    }

    const next = invokeFn("task_metadata_get", { repoPath, taskId })
      .then((payload) => {
        const parsed = taskMetadataPayloadSchema.parse(payload);
        const metadata = {
          ...parsed,
          agentSessions: parseAgentSessions(parsed.agentSessions, taskId),
        };

        if (this.inFlight.get(cacheKey) === next) {
          this.cache.set(cacheKey, metadata);
        }

        return metadata;
      })
      .finally(() => {
        this.inFlight.delete(cacheKey);
      });

    this.inFlight.set(cacheKey, next);
    return next;
  }
}
