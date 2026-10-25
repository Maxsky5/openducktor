import { afterEach, describe, expect, test } from "bun:test";
import { createTextSegment } from "../../drafts/agent-chat-composer-draft";
import {
  toAgentChatDraftStorageKey,
  writeAgentChatDraftToStorage,
} from "../../drafts/agent-chat-draft-storage";
import {
  type AgentChatDraftStore,
  createAgentChatDraftStore,
} from "../../drafts/agent-chat-draft-store";
import { type ClientStorage, createMemoryClientStorage } from "../../platform/client-storage";
import { agentSessionIdentityKey } from "../../lib/agent-session-identity";
import type { AgentSessionIdentity } from "../../types/agent-orchestrator";
import {
  type AgentStudioChatDraftScope,
  agentStudioChatDraftScopeKey,
  createAgentStudioChatDraftPersistence,
} from "./agent-studio-chat-draft";

const stores: AgentChatDraftStore[] = [];

const createDraftStore = ({
  storage = createMemoryClientStorage(),
  now = () => new Date(),
}: { storage?: ClientStorage; now?: () => Date } = {}): AgentChatDraftStore => {
  const store = createAgentChatDraftStore({
    storage,
    stageAttachment: async (file) => {
      throw new Error(`The test draft store cannot stage '${file.name}'.`);
    },
    now,
  });
  stores.push(store);
  return store;
};

const session = (externalSessionId: string): AgentSessionIdentity => ({
  externalSessionId,
  runtimeKind: "opencode",
  workingDirectory: "/repo",
});

const scope = (overrides: Partial<AgentStudioChatDraftScope> = {}): AgentStudioChatDraftScope => ({
  taskId: "task-1",
  role: "planner",
  session: null,
  ...overrides,
});

afterEach(() => {
  for (const store of stores.splice(0)) {
    store.dispose();
  }
});

describe("Agent Studio chat draft adapter", () => {
  test("keeps the workspace, task, role, and session draft key shape", () => {
    const selectedSession = session("session-1");

    expect(agentStudioChatDraftScopeKey("workspace", scope({ session: selectedSession }))).toBe(
      `workspace:task-1:planner:${agentSessionIdentityKey(selectedSession)}`,
    );
    expect(agentStudioChatDraftScopeKey("workspace", scope())).toBe("workspace:task-1:planner:new");
  });

  test("isolates the same draft scope across workspaces", () => {
    const selectedScope = scope({ session: session("session-1") });

    expect(agentStudioChatDraftScopeKey("workspace-a", selectedScope)).not.toBe(
      agentStudioChatDraftScopeKey("workspace-b", selectedScope),
    );
  });

  test("uses stable persistence targets for equivalent session identities", () => {
    const selectedSession = session("session-1");
    const drafts = createDraftStore();
    const first = createAgentStudioChatDraftPersistence({
      drafts,
      workspaceId: "workspace",
      taskId: "task-1",
      session: selectedSession,
    });
    const refreshed = createAgentStudioChatDraftPersistence({
      drafts,
      workspaceId: "workspace",
      taskId: "task-1",
      session: { ...selectedSession },
    });
    const otherWorkspace = createAgentStudioChatDraftPersistence({
      drafts,
      workspaceId: "other-workspace",
      taskId: "task-1",
      session: selectedSession,
    });

    expect(first).not.toBeNull();
    expect(refreshed).not.toBeNull();
    expect(otherWorkspace).not.toBeNull();
    expect(first?.targetKey).toBe(refreshed?.targetKey);
    expect(first?.targetKey).not.toBe(otherWorkspace?.targetKey);
    expect(first?.targetKey).toBe(
      toAgentChatDraftStorageKey({ workspaceId: "workspace", ...selectedSession }),
    );
  });

  test("reads an existing version 2 payload without migration", () => {
    const storage = createMemoryClientStorage();
    const selectedSession = session("session-1");
    const identity = { workspaceId: "workspace", ...selectedSession };
    const draft = {
      segments: [createTextSegment("persisted", "text-1")],
      attachments: [],
    };
    const drafts = createDraftStore({
      storage,
      now: () => new Date("2026-07-08T10:00:01.000Z"),
    });
    writeAgentChatDraftToStorage({
      storage,
      identity,
      taskId: "task-1",
      draft,
      updatedAt: "2026-07-08T10:00:00.000Z",
    });
    const existingPayload = storage.getItem(toAgentChatDraftStorageKey(identity));

    const persistence = createAgentStudioChatDraftPersistence({
      drafts,
      workspaceId: "workspace",
      taskId: "task-1",
      session: selectedSession,
    });

    expect(persistence?.hydrate()).toEqual(draft);
    expect(storage.getItem(toAgentChatDraftStorageKey(identity))).toBe(existingPayload);
  });
});
