import {
  importSessionToStore,
  type SessionKey,
  type SessionStore,
  type SessionStoreEntry,
} from "@anthropic-ai/claude-agent-sdk";
import { isRecord, readStringProp } from "./claude-agent-sdk-utils";

export type ClaudeTranscriptMirrorAppend = {
  entries: SessionStoreEntry[];
  key: SessionKey;
};

export type ClaudeTranscriptToolUseResult = {
  entry: SessionStoreEntry;
  toolUseResult: Record<string, unknown>;
};

export type ClaudeTranscriptMirrorStore = SessionStore & {
  entriesForSession(input: {
    sessionId: string;
    subpath?: string | undefined;
  }): SessionStoreEntry[];
  findToolUseResult(input: {
    sessionId: string;
    toolUseId: string;
  }): ClaudeTranscriptToolUseResult | null;
  hasSession(sessionId: string): boolean;
  registerSessionDirectory(input: { dir: string; sessionId: string }): void;
};

const keyString = (key: SessionKey): string =>
  `${key.projectKey}\u0000${key.sessionId}\u0000${key.subpath ?? ""}`;

const toolUseResultKey = (input: {
  sessionId: string;
  subpath?: string | undefined;
  toolUseId: string;
}): string => `${input.sessionId}\u0000${input.subpath ?? ""}\u0000${input.toolUseId}`;

const keyMatchesSession = (
  key: SessionKey,
  input: { sessionId: string; subpath?: string | undefined },
): boolean => key.sessionId === input.sessionId && key.subpath === input.subpath;

const readToolUseResultRecord = (entry: SessionStoreEntry): Record<string, unknown> | null => {
  const toolUseResult = entry.toolUseResult ?? entry.tool_use_result;
  return isRecord(toolUseResult) ? toolUseResult : null;
};

export const createClaudeTranscriptMirrorStore = ({
  onAppend,
}: {
  onAppend?: ((append: ClaudeTranscriptMirrorAppend) => void) | undefined;
} = {}): ClaudeTranscriptMirrorStore => {
  const entriesByKey = new Map<string, { entries: SessionStoreEntry[]; key: SessionKey }>();
  const sessionIdsWithEntries = new Set<string>();
  const sessionDirectories = new Map<string, string>();
  const loadingKeys = new Set<string>();
  const toolUseResultsByKey = new Map<string, ClaudeTranscriptToolUseResult>();

  const append: SessionStore["append"] = async (key, nextEntries) => {
    const mapKey = keyString(key);
    const bucket = entriesByKey.get(mapKey) ?? { entries: [], key };
    const seenUuids = new Set(
      bucket.entries
        .map((entry) => (typeof entry.uuid === "string" ? entry.uuid : null))
        .filter((uuid): uuid is string => uuid !== null),
    );
    const appended: SessionStoreEntry[] = [];
    for (const entry of nextEntries) {
      if (typeof entry.uuid === "string" && seenUuids.has(entry.uuid)) {
        continue;
      }
      bucket.entries.push(entry);
      appended.push(entry);
      sessionIdsWithEntries.add(key.sessionId);
      if (typeof entry.uuid === "string") {
        seenUuids.add(entry.uuid);
      }
      const toolUseId =
        entry.type === "user" ? readStringProp(entry, "parent_tool_use_id") : undefined;
      const toolUseResult = toolUseId ? readToolUseResultRecord(entry) : null;
      if (toolUseId && toolUseResult) {
        toolUseResultsByKey.set(
          toolUseResultKey({ sessionId: key.sessionId, subpath: key.subpath, toolUseId }),
          { entry, toolUseResult },
        );
      }
    }
    entriesByKey.set(mapKey, bucket);
    if (appended.length > 0) {
      onAppend?.({ entries: appended, key });
    }
  };

  const load: SessionStore["load"] = async (key) => {
    const mapKey = keyString(key);
    const existing = entriesByKey.get(mapKey)?.entries;
    if (existing && existing.length > 0) {
      return [...existing];
    }
    if (loadingKeys.has(mapKey)) {
      return null;
    }

    loadingKeys.add(mapKey);
    try {
      const dir = sessionDirectories.get(key.sessionId);
      if (!dir) {
        return null;
      }
      await importSessionToStore(key.sessionId, store, {
        dir,
        includeSubagents: key.subpath !== undefined,
      });
    } catch (error) {
      if (error instanceof Error && error.message === `Session ${key.sessionId} not found`) {
        return null;
      }
      throw error;
    } finally {
      loadingKeys.delete(mapKey);
    }

    const imported = entriesByKey.get(mapKey)?.entries;
    return imported && imported.length > 0 ? [...imported] : null;
  };

  const store: ClaudeTranscriptMirrorStore = {
    append,
    load,
    entriesForSession: (input) =>
      [...entriesByKey.values()]
        .filter((bucket) => keyMatchesSession(bucket.key, input))
        .flatMap((bucket) => bucket.entries),
    findToolUseResult: ({ sessionId, toolUseId }) =>
      toolUseResultsByKey.get(toolUseResultKey({ sessionId, toolUseId })) ?? null,
    hasSession: (sessionId) => sessionIdsWithEntries.has(sessionId),
    listSubkeys: async ({ sessionId }) =>
      [...entriesByKey.values()]
        .map((bucket) => bucket.key)
        .filter((key) => key.sessionId === sessionId && key.subpath !== undefined)
        .map((key) => key.subpath as string),
    registerSessionDirectory: ({ dir, sessionId }) => {
      sessionDirectories.set(sessionId, dir);
    },
  };

  return store;
};
