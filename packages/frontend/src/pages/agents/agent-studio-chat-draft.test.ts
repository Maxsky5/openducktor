import { afterEach, describe, expect, test } from "bun:test";
import { createTextSegment } from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import {
  toAgentChatDraftStorageKey,
  writeAgentChatDraftToStorage,
} from "@/components/features/agents/agent-chat/agent-chat-draft-storage";
import {
  resetAgentChatDraftStoreForTests,
  setAgentChatDraftNowProviderForTests,
  setAgentChatDraftStorageForTests,
} from "@/components/features/agents/agent-chat/agent-chat-draft-store";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import {
  type AgentStudioChatDraftScope,
  agentStudioChatDraftScopeKey,
  createAgentStudioChatDraftPersistence,
  didAgentStudioChatDraftScopeSwitchSessionOnly,
} from "./agent-studio-chat-draft";

type TestStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

const createMemoryStorage = (): TestStorage => {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    key: (index) => Array.from(values.keys())[index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
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
  resetAgentChatDraftStoreForTests();
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

  test("recognizes only session changes within the same task and role", () => {
    expect(
      didAgentStudioChatDraftScopeSwitchSessionOnly(
        scope({ session: session("session-1") }),
        scope({ session: session("session-2") }),
      ),
    ).toBe(true);
    expect(
      didAgentStudioChatDraftScopeSwitchSessionOnly(
        scope({ session: session("session-1") }),
        scope({ taskId: "task-2", session: session("session-2") }),
      ),
    ).toBe(false);
    expect(
      didAgentStudioChatDraftScopeSwitchSessionOnly(
        scope({ session: session("session-1") }),
        scope({ role: "build", session: session("session-2") }),
      ),
    ).toBe(false);
  });

  test("uses stable persistence targets for equivalent session identities", () => {
    const selectedSession = session("session-1");
    const first = createAgentStudioChatDraftPersistence({
      workspaceId: "workspace",
      taskId: "task-1",
      session: selectedSession,
    });
    const refreshed = createAgentStudioChatDraftPersistence({
      workspaceId: "workspace",
      taskId: "task-1",
      session: { ...selectedSession },
    });
    const otherWorkspace = createAgentStudioChatDraftPersistence({
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
    const storage = createMemoryStorage();
    const selectedSession = session("session-1");
    const identity = { workspaceId: "workspace", ...selectedSession };
    const draft = {
      segments: [createTextSegment("persisted", "text-1")],
      attachments: [],
    };
    setAgentChatDraftStorageForTests(storage);
    setAgentChatDraftNowProviderForTests(() => new Date("2026-07-08T10:00:01.000Z"));
    writeAgentChatDraftToStorage({
      storage,
      identity,
      taskId: "task-1",
      draft,
      updatedAt: "2026-07-08T10:00:00.000Z",
    });
    const existingPayload = storage.getItem(toAgentChatDraftStorageKey(identity));

    const persistence = createAgentStudioChatDraftPersistence({
      workspaceId: "workspace",
      taskId: "task-1",
      session: selectedSession,
    });

    expect(persistence?.hydrate()).toEqual(draft);
    expect(storage.getItem(toAgentChatDraftStorageKey(identity))).toBe(existingPayload);
  });
});
