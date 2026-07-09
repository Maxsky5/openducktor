import { describe, expect, test } from "bun:test";
import {
  type AgentChatComposerDraft,
  createComposerAttachment,
  createFileReferenceSegment,
  createSkillReferenceSegment,
  createSlashCommandSegment,
  createSubagentReferenceSegment,
  createTextSegment,
} from "./agent-chat-composer-draft";
import {
  AGENT_CHAT_DRAFT_STORAGE_MAX_BYTES,
  type AgentChatDraftSessionIdentity,
  cleanupExpiredAgentChatDraftStorage,
  measureAgentChatDraftPayloadBytes,
  readAgentChatDraftFromStorage,
  serializeAgentChatDraftPayload,
  toAgentChatDraftStorageKey,
  writeAgentChatDraftToStorage,
} from "./agent-chat-draft-storage";

type TestStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

const createMemoryStorage = (): TestStorage => {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    key: (index) => Array.from(store.keys())[index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
};

const identity: AgentChatDraftSessionIdentity = {
  workspaceId: "workspace:one",
  externalSessionId: "session/one",
  runtimeKind: "opencode",
  workingDirectory: "/workspace/one",
};

const command = {
  id: "compact",
  trigger: "compact",
  title: "Compact",
  hints: ["compact"],
};

const file = {
  id: "src/main.ts",
  path: "src/main.ts",
  name: "main.ts",
  kind: "code" as const,
};

const skill = {
  id: "/skills/review/SKILL.md",
  name: "review",
  path: "/skills/review/SKILL.md",
};

const subagent = {
  id: "reviewer",
  name: "reviewer",
  label: "Reviewer",
};

const buildStructuredDraft = (): AgentChatComposerDraft => ({
  segments: [
    createTextSegment("Please ", "text-1"),
    createSlashCommandSegment(command, "slash-1"),
    createTextSegment(" inspect ", "text-2"),
    createFileReferenceSegment(file, "file-1"),
    createTextSegment(" with ", "text-3"),
    createSkillReferenceSegment(skill, "skill-1"),
    createTextSegment(" and ", "text-4"),
    createSubagentReferenceSegment(subagent, "subagent-1"),
  ],
  attachments: [
    createComposerAttachment(
      {
        name: "brief.pdf",
        kind: "pdf",
        mime: "application/pdf",
        path: "/tmp/brief.pdf",
      },
      "attachment-1",
    ),
  ],
});

describe("agent chat draft storage", () => {
  test("builds storage keys from workspace and canonical session identity", () => {
    expect(toAgentChatDraftStorageKey(identity)).toBe(
      "openducktor:agent-chat:draft:v2:workspace%3Aone:session%2Fone|opencode|%2Fworkspace%2Fone",
    );
  });

  test("round-trips structured segments and path-backed attachment metadata", () => {
    const storage = createMemoryStorage();
    const draft = buildStructuredDraft();

    const writeResult = writeAgentChatDraftToStorage({
      storage,
      identity,
      taskId: "task-1",
      draft,
      updatedAt: "2026-07-01T10:00:00.000Z",
    });

    expect(writeResult.status).toBe("serialized");
    const readResult = readAgentChatDraftFromStorage({
      storage,
      identity,
      now: new Date("2026-07-02T10:00:00.000Z"),
    });

    expect(readResult.status).toBe("restored");
    if (readResult.status !== "restored") {
      throw new Error("Expected restored draft");
    }
    expect(readResult.value.draft.segments).toEqual(draft.segments);
    expect(readResult.value.draft.attachments).toEqual([
      expect.objectContaining({
        id: "attachment-1",
        path: "/tmp/brief.pdf",
        name: "brief.pdf",
        kind: "pdf",
        mime: "application/pdf",
      }),
    ]);
    expect(readResult.value.draft.attachments?.[0]?.file).toBeUndefined();
    expect(readResult.value.draft.attachments?.[0]?.previewUrl).toBeUndefined();
  });

  test("removes invalid stored payloads for only the affected key", () => {
    const storage = createMemoryStorage();
    const key = toAgentChatDraftStorageKey(identity);
    storage.setItem(key, "{not-json");
    storage.setItem("unrelated", "kept");

    const result = readAgentChatDraftFromStorage({
      storage,
      identity,
      now: new Date("2026-07-02T10:00:00.000Z"),
    });

    expect(result.status).toBe("invalid");
    expect(storage.getItem(key)).toBeNull();
    expect(storage.getItem("unrelated")).toBe("kept");
  });

  test("removes payloads with malformed nested reference segments", () => {
    const storage = createMemoryStorage();
    const key = toAgentChatDraftStorageKey(identity);
    storage.setItem(
      key,
      JSON.stringify({
        version: 2,
        workspaceId: identity.workspaceId,
        externalSessionId: identity.externalSessionId,
        runtimeKind: identity.runtimeKind,
        workingDirectory: identity.workingDirectory,
        taskId: "task-1",
        updatedAt: "2026-07-01T10:00:00.000Z",
        draft: {
          segments: [
            { id: "text-1", kind: "text", text: "Use " },
            { id: "skill-1", kind: "skill_mention", skill: {} },
          ],
          attachments: [],
        },
      }),
    );

    const result = readAgentChatDraftFromStorage({
      storage,
      identity,
      now: new Date("2026-07-02T10:00:00.000Z"),
    });

    expect(result.status).toBe("invalid");
    expect(storage.getItem(key)).toBeNull();
  });

  test("removes payloads whose canonical session identity does not match the key", () => {
    const storage = createMemoryStorage();
    const key = toAgentChatDraftStorageKey(identity);
    storage.setItem(
      key,
      JSON.stringify({
        version: 2,
        workspaceId: identity.workspaceId,
        externalSessionId: identity.externalSessionId,
        runtimeKind: identity.runtimeKind,
        workingDirectory: "/another/workspace",
        taskId: "task-1",
        updatedAt: "2026-07-01T10:00:00.000Z",
        draft: {
          segments: [{ id: "text-1", kind: "text", text: "wrong workspace" }],
          attachments: [],
        },
      }),
    );

    const result = readAgentChatDraftFromStorage({
      storage,
      identity,
      now: new Date("2026-07-02T10:00:00.000Z"),
    });

    expect(result.status).toBe("invalid");
    expect(storage.getItem(key)).toBeNull();
  });

  test("removes drafts older than seven days during restore", () => {
    const storage = createMemoryStorage();
    const key = toAgentChatDraftStorageKey(identity);
    writeAgentChatDraftToStorage({
      storage,
      identity,
      taskId: "task-1",
      draft: { segments: [createTextSegment("old", "text-1")], attachments: [] },
      updatedAt: "2026-07-01T10:00:00.000Z",
    });

    const result = readAgentChatDraftFromStorage({
      storage,
      identity,
      now: new Date("2026-07-08T10:00:00.000Z"),
    });

    expect(result.status).toBe("expired");
    expect(storage.getItem(key)).toBeNull();
  });

  test("removes drafts with future update dates during restore", () => {
    const storage = createMemoryStorage();
    const key = toAgentChatDraftStorageKey(identity);
    writeAgentChatDraftToStorage({
      storage,
      identity,
      taskId: "task-1",
      draft: { segments: [createTextSegment("future", "text-1")], attachments: [] },
      updatedAt: "2026-07-09T10:00:01.000Z",
    });

    const result = readAgentChatDraftFromStorage({
      storage,
      identity,
      now: new Date("2026-07-09T10:00:00.000Z"),
    });

    expect(result.status).toBe("invalid");
    expect(storage.getItem(key)).toBeNull();
  });

  test("persists payloads at the size boundary and removes stale payloads above it", () => {
    const storage = createMemoryStorage();
    const key = toAgentChatDraftStorageKey(identity);
    const buildDraft = (textLength: number): AgentChatComposerDraft => ({
      segments: [createTextSegment("x".repeat(textLength), "text-1")],
      attachments: [],
    });
    const byteLengthForText = (textLength: number): number => {
      const result = serializeAgentChatDraftPayload({
        identity,
        taskId: "task-1",
        draft: buildDraft(textLength),
        updatedAt: "2026-07-01T10:00:00.000Z",
      });
      return result.status === "serialized" || result.status === "oversized"
        ? result.byteLength
        : 0;
    };

    let low = 1;
    let high = AGENT_CHAT_DRAFT_STORAGE_MAX_BYTES;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (byteLengthForText(mid) <= AGENT_CHAT_DRAFT_STORAGE_MAX_BYTES) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }

    const boundaryResult = writeAgentChatDraftToStorage({
      storage,
      identity,
      taskId: "task-1",
      draft: buildDraft(low),
      updatedAt: "2026-07-01T10:00:00.000Z",
    });
    expect(boundaryResult.status).toBe("serialized");
    expect(storage.getItem(key)).not.toBeNull();
    expect(measureAgentChatDraftPayloadBytes(storage.getItem(key) ?? "")).toBeLessThanOrEqual(
      AGENT_CHAT_DRAFT_STORAGE_MAX_BYTES,
    );

    const oversizedResult = writeAgentChatDraftToStorage({
      storage,
      identity,
      taskId: "task-1",
      draft: buildDraft(low + 1),
      updatedAt: "2026-07-01T10:00:00.000Z",
    });
    expect(oversizedResult.status).toBe("oversized");
    expect(storage.getItem(key)).toBeNull();
  });

  test("cleanup scans only chat draft keys", () => {
    const storage = createMemoryStorage();
    const expiredIdentity = {
      workspaceId: "workspace",
      externalSessionId: "expired",
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo",
    };
    const freshIdentity = {
      workspaceId: "workspace",
      externalSessionId: "fresh",
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo",
    };
    writeAgentChatDraftToStorage({
      storage,
      identity: expiredIdentity,
      taskId: "task-1",
      draft: { segments: [createTextSegment("old", "text-1")], attachments: [] },
      updatedAt: "2026-07-01T10:00:00.000Z",
    });
    writeAgentChatDraftToStorage({
      storage,
      identity: freshIdentity,
      taskId: "task-2",
      draft: { segments: [createTextSegment("fresh", "text-1")], attachments: [] },
      updatedAt: "2026-07-08T09:00:00.000Z",
    });
    storage.setItem("openducktor:agent-chat:draft:v1:workspace:legacy-session", "legacy");
    storage.setItem("openducktor:other-feature", "keep");

    cleanupExpiredAgentChatDraftStorage({
      storage,
      now: new Date("2026-07-08T10:00:00.000Z"),
    });

    expect(storage.getItem(toAgentChatDraftStorageKey(expiredIdentity))).toBeNull();
    expect(storage.getItem(toAgentChatDraftStorageKey(freshIdentity))).not.toBeNull();
    expect(storage.getItem("openducktor:agent-chat:draft:v1:workspace:legacy-session")).toBeNull();
    expect(storage.getItem("openducktor:other-feature")).toBe("keep");
  });
});
