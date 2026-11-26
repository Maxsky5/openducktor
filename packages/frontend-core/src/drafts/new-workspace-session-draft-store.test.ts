import { UPSTREAM_TARGET_BRANCH } from "@openducktor/contracts";
import { describe, expect, test } from "bun:test";
import { createMemoryClientStorage, type ClientStorage } from "../platform/client-storage";
import { createTestClientConnection } from "../test-support/test-client-connection";
import { createEmptyComposerDraft } from "./agent-chat-composer-draft";
import { createAgentChatDraftStore } from "./agent-chat-draft-store";
import {
  createNewWorkspaceSessionDraftStore,
  NEW_WORKSPACE_SESSION_LAST_LOCATION_STORAGE_KEY,
  toNewWorkspaceSessionDraftStorageKey,
  workspaceSessionDraftTitle,
} from "./new-workspace-session-draft-store";

const draftWithText = (text: string) => ({
  segments: [{ id: "t1", kind: "text" as const, text }],
  attachments: [],
});

const createStores = (options?: { storage?: ClientStorage }) => {
  const storage = options?.storage ?? createMemoryClientStorage();
  const chatDrafts = createAgentChatDraftStore({
    storage,
    stageAttachment: async () => "/staged/file",
    scheduleTask: () => () => {},
  });
  const store = createNewWorkspaceSessionDraftStore({ storage, chatDrafts });
  return { storage, chatDrafts, store };
};

describe("NewWorkspaceSessionDraftStore", () => {
  test("keeps focus on open untouched draft and creates new independent drafts otherwise", () => {
    const { store } = createStores();
    const first = store.ensureDraftForNewSession("ws-1", null);
    expect(first.lifecycle).toBe("untouched");
    expect(store.ensureDraftForNewSession("ws-1", first.id).id).toBe(first.id);

    store.updateComposer(first.id, draftWithText("Hello world"));
    expect(store.getDraft(first.id)?.lifecycle).toBe("retained");

    const second = store.ensureDraftForNewSession("ws-1", first.id);
    expect(second.id).not.toBe(first.id);
    expect(second.lifecycle).toBe("untouched");
    expect(store.getSnapshot()).toHaveLength(2);
  });

  test("auto-discards untouched drafts on view leave and restores retained drafts via AgentChatDraftStore", async () => {
    const { storage, chatDrafts, store: store1 } = createStores();

    const blank = store1.createDraft("ws-1");
    const releaseBlank = store1.attachDraftView(blank.id);
    releaseBlank();
    await Promise.resolve();
    expect(store1.getDraft(blank.id)).toBeNull();

    const edited = store1.createDraft("ws-1");
    store1.updateComposer(edited.id, draftWithText("  First line title  \nSecond line"));
    store1.updateOptions(edited.id, { location: "local_worktree" });
    await chatDrafts.saveAll();

    expect(workspaceSessionDraftTitle(store1.getDraft(edited.id)!)).toBe("First line title");
    expect(storage.getItem(toNewWorkspaceSessionDraftStorageKey("ws-1", edited.id))).not.toBeNull();

    const { store: store2 } = createStores({ storage });
    const restored = store2.getDraft(edited.id);
    expect(restored).not.toBeNull();
    expect(restored?.lifecycle).toBe("retained");
    expect(restored?.options.location).toBe("local_worktree");
    expect(workspaceSessionDraftTitle(restored!)).toBe("First line title");
  });

  test("clears Tracked upstream when leaving Current checkout", () => {
    const { store } = createStores();
    const draft = store.createDraft("ws-1");
    store.updateOptions(draft.id, { targetBranch: { branch: UPSTREAM_TARGET_BRANCH } });
    expect(store.getDraft(draft.id)?.options.targetBranch).toEqual({
      branch: UPSTREAM_TARGET_BRANCH,
    });
    store.updateOptions(draft.id, { location: "local_worktree" });
    expect(store.getDraft(draft.id)?.options.targetBranch).toBeNull();
  });

  test("remembers last used work location in storage and defaults to current checkout", async () => {
    const { storage, store: store1 } = createStores();
    const first = store1.createDraft("ws-1");
    expect(first.options.location).toBe("local_repo_root");
    expect(first.lifecycle).toBe("untouched");

    store1.updateOptions(first.id, { location: "local_worktree" });
    expect(storage.getItem(NEW_WORKSPACE_SESSION_LAST_LOCATION_STORAGE_KEY)).toBe("local_worktree");
    expect(store1.getDraft(first.id)?.lifecycle).toBe("retained");

    const { store: store2 } = createStores({ storage });
    const second = store2.createDraft("ws-1");
    expect(second.options.location).toBe("local_worktree");
    expect(second.lifecycle).toBe("untouched");

    const releaseSecond = store2.attachDraftView(second.id);
    releaseSecond();
    await Promise.resolve();
    expect(store2.getDraft(second.id)).toBeNull();

    const third = store2.createDraft("ws-1");
    store2.updateOptions(third.id, { location: "existing_worktree" });
    expect(storage.getItem(NEW_WORKSPACE_SESSION_LAST_LOCATION_STORAGE_KEY)).toBe(
      "existing_worktree",
    );
    expect(store2.getDraft(third.id)?.lifecycle).toBe("retained");
  });

  test("switchWorkspace keeps text, attachments, location, and role while stripping workspace references", async () => {
    const { storage, chatDrafts, store } = createStores();
    const draft = store.createDraft("ws-1");
    store.updateOptions(draft.id, {
      location: "local_worktree",
      worktree: { mode: "from_name", name: "old-wt", branchName: "feat/old" },
      customAgentRoleId: "role-1",
      targetBranch: { remote: "origin", branch: "main" },
      selectedModel: { runtimeKind: "codex", providerId: "openai", modelId: "gpt-5" },
    });
    store.updateComposer(draft.id, {
      segments: [
        { id: "t1", kind: "text", text: "Check " },
        {
          id: "f1",
          kind: "file_reference",
          file: { id: "f1", path: "src/a.ts", name: "a.ts", kind: "code" },
        },
        {
          id: "s1",
          kind: "skill_mention",
          skill: {
            id: "s1",
            name: "skill",
            path: "/repo/.agents/skills/skill",
            description: "desc",
          },
        },
      ],
      attachments: [{ id: "att-1", path: "/staged/a.png", name: "a.png", kind: "image" }],
    });
    await chatDrafts.saveAll();

    const persistence = store.composerPersistence(draft.id);
    let changeCount = 0;
    const unsubscribe = persistence.subscribeExternalChange?.(() => {
      changeCount += 1;
    });
    try {
      const { removedReferenceCount } = store.switchWorkspace(draft.id, "ws-2");
      expect(removedReferenceCount).toBe(2);
      expect(changeCount).toBe(1);
      const moved = store.getDraft(draft.id)!;
      expect(moved.workspaceId).toBe("ws-2");
      expect(moved.options.customAgentRoleId).toBe("role-1");
      expect(moved.options.location).toBe("local_worktree");
      expect(moved.options.worktree).toEqual({ mode: "from_name", name: "", branchName: null });
      expect(moved.options.existingWorktreeDirectory).toBeNull();
      expect(moved.options.targetBranch).toBeNull();
      expect(moved.options.selectedModel).toBeNull();
      expect(moved.composer.attachments).toHaveLength(1);
      expect(persistence.hydrate().segments).toEqual([{ id: "t1", kind: "text", text: "Check " }]);
      expect(storage.getItem(toNewWorkspaceSessionDraftStorageKey("ws-1", draft.id))).toBeNull();
    } finally {
      unsubscribe?.();
    }
  });

  test("derives starting state from StartupAttemptStore, blocks discard while pending, and retires on save", async () => {
    const connection = createTestClientConnection();
    const store = connection.drafts.newWorkspaceSessions;
    const draft = store.createDraft("ws-1");
    const persistence = store.composerPersistence(draft.id);
    persistence.set(draftWithText("Ship it"));
    await persistence.flush();

    expect(persistence.clear()).toBe(false);
    expect(store.getDraft(draft.id)).not.toBeNull();

    const attemptId = connection.startupAttempts.begin({
      origin: {
        workspaceId: "ws-1",
        repoPath: "/repo",
        scope: { kind: "workspace", draftId: draft.id },
      },
      label: "Ship it",
      presentation: "inline",
      submittedComposer: draftWithText("Ship it"),
    });
    expect(store.isStarting(draft.id)).toBe(true);
    expect(store.discard(draft.id)).toBe(false);

    connection.startupAttempts.fail(attemptId, "Failed to create worktree");
    expect(store.isStarting(draft.id)).toBe(false);
    expect(store.getDraft(draft.id)?.lifecycle).toBe("retained");

    connection.startupAttempts.setSaved(attemptId, {
      state: "saved",
      target: {
        kind: "workspace",
        record: {
          id: "saved-1",
          runtimeKind: "codex",
          externalSessionId: "native-1",
          executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
          roleSnapshot: null,
          selectedModel: null,
          generatedTitle: "Ship it",
          manualTitle: null,
          targetBranch: null,
          createdAt: 1000,
          updatedAt: 1000,
          archivedAt: null,
        },
      },
    });
    expect(store.getDraft(draft.id)).toBeNull();
    expect(
      connection.storage.getItem(toNewWorkspaceSessionDraftStorageKey("ws-1", draft.id)),
    ).toBeNull();
  });

  test("prunes drafts for removed workspaces while keeping closed-workspace drafts", async () => {
    const { storage, chatDrafts, store } = createStores();
    const open = store.createDraft("ws-open");
    const closed = store.createDraft("ws-closed");
    const removed = store.createDraft("ws-removed");
    store.updateComposer(open.id, draftWithText("Open"));
    store.updateComposer(closed.id, draftWithText("Closed"));
    store.updateComposer(removed.id, draftWithText("Removed"));
    await chatDrafts.saveAll();

    store.pruneRemovedWorkspaces(new Set(["ws-open", "ws-closed"]));
    expect(store.getDraft(open.id)).not.toBeNull();
    expect(store.getDraft(closed.id)).not.toBeNull();
    expect(store.getDraft(removed.id)).toBeNull();
    expect(
      storage.getItem(toNewWorkspaceSessionDraftStorageKey("ws-removed", removed.id)),
    ).toBeNull();
    expect(createEmptyComposerDraft().segments).toHaveLength(1);
  });

  test("attachDraftView tolerates StrictMode remounts and workspace switches", async () => {
    const { store } = createStores();
    const draft = store.createDraft("ws-1");

    const releaseFirst = store.attachDraftView(draft.id);
    releaseFirst();
    const releaseSecond = store.attachDraftView(draft.id);
    await Promise.resolve();
    expect(store.getDraft(draft.id)).not.toBeNull();

    // Switching workspace suppresses leave from the previous workspace's view lease.
    store.switchWorkspace(draft.id, "ws-2");
    releaseSecond();
    await Promise.resolve();
    expect(store.getDraft(draft.id)?.workspaceId).toBe("ws-2");

    // Normal leave in the current workspace discards an untouched draft.
    const releaseThird = store.attachDraftView(draft.id);
    releaseThird();
    await Promise.resolve();
    expect(store.getDraft(draft.id)).toBeNull();
  });
});
