import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import type { GitFileDiff } from "@openducktor/contracts";
import type { InlineCommentOwner } from "@openducktor/frontend-core/drafts/inline-comment-owner";
import type { DiffScope } from "@/features/agent-studio-git";
import { toFailedScopeState } from "@/features/agent-studio-git/model/scope-state";
import type { AgentStudioGitPanelModel } from "./types";
import { createHookHarness } from "@openducktor/frontend-core/test-support/react-hook-harness";
import {
  createBuildToolsSnapshotFixture,
  createEmptyScopeStateFixture,
} from "@/pages/agents/shell/agents-page-build-tools.test-support";
import { createElement, type PropsWithChildren, type ReactElement } from "react";
import type { ClientConnection } from "@openducktor/frontend-core/connection/client-connection";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { readInlineCommentDraftsFromStorage } from "@openducktor/frontend-core/drafts/inline-comment-draft-storage";
import {
  type AddInlineCommentDraftInput,
  toInlineCommentDraftOwnerKey,
} from "@openducktor/frontend-core/drafts/inline-comment-draft-store";
import {
  type ClientStorage,
  createMemoryClientStorage,
} from "@openducktor/frontend-core/platform/client-storage";
import { useGitCommentDraftValidation } from "./use-git-comment-draft-validation";

const createFileDiff = (file: string): GitFileDiff => ({
  file,
  type: "modified",
  additions: 1,
  deletions: 0,
  diff: "",
});

const createCommentInput = (
  overrides: Partial<AddInlineCommentDraftInput> = {},
): AddInlineCommentDraftInput => ({
  filePath: "src/file.ts",
  diffScope: "uncommitted",
  startLine: 4,
  endLine: 4,
  side: "new",
  text: "Please change this.",
  codeContext: [{ lineNumber: 4, text: "const value = 1;", isSelected: true }],
  language: "ts",
  ...overrides,
});

const requireOwnerKey = (value: string | null): string => {
  if (value === null) {
    throw new Error("Expected an inline comment owner key.");
  }
  return value;
};

let COMMENT_OWNER_KEY: string;

// Each connection stands for one app session. A reload opens a new one over the same storage.
const connections: ClientConnection[] = [];

const currentConnection = (): ClientConnection => {
  const connection = connections.at(-1);
  if (!connection) throw new Error("Open a comment connection first.");
  return connection;
};

const commentDrafts = () => currentConnection().drafts.inlineComments;

function CommentConnection({ children }: PropsWithChildren): ReactElement {
  return createElement(ClientConnectionProvider, { connection: currentConnection() }, children);
}

const harnessOptions = { wrapper: CommentConnection };

const setCommentStorage = (storage: ClientStorage): void => {
  connections.push(createTestClientConnection({ storage, scheduleTask: () => () => {} }));
};

const reloadCommentStore = (storage: ClientStorage): void => {
  setCommentStorage(storage);
  commentDrafts().getState().hydrate(COMMENT_OWNER_KEY);
};

const seedStoredComments = (inputs: AddInlineCommentDraftInput[]): void => {
  const store = commentDrafts().getState();
  for (const input of inputs) {
    store.addDraft(COMMENT_OWNER_KEY, input);
  }
  store.flush();
};

const pendingCommentPaths = (): string[] =>
  commentDrafts()
    .getState()
    .getPendingDrafts(COMMENT_OWNER_KEY)
    .map((draft) => draft.filePath);

const setScopeState = (
  snapshot: AgentStudioGitPanelModel,
  scope: "uncommitted" | "target",
  state: AgentStudioGitPanelModel["scopeStatesByScope"]["target"],
): void => {
  snapshot.scopeStatesByScope = {
    ...snapshot.scopeStatesByScope,
    [scope]: state,
  };
};

const createModel = (owner: InlineCommentOwner): AgentStudioGitPanelModel => ({
  ...createBuildToolsSnapshotFixture().diffData,
  refresh: async () => {},
  subjectKey: "chat",
  targetBranch: "main",
  commentOwner: owner,
});
for (const owner of [
  { kind: "task", workspaceId: "workspace-repo", taskId: "task-1" },
  { kind: "workspace_session", workspaceId: "workspace-repo", sessionId: "task-1" },
] satisfies InlineCommentOwner[]) {
  describe(`Git comment draft validation for ${owner.kind}`, () => {
    beforeEach(() => {
      COMMENT_OWNER_KEY = requireOwnerKey(toInlineCommentDraftOwnerKey(owner));
    });
    afterEach(async () => {
      await Promise.all(connections.splice(0).map((connection) => connection.dispose()));
    });
    test("drops restored comments for files missing from a loaded scope and persists the drop", async () => {
      const storage = createMemoryClientStorage();
      setCommentStorage(storage);
      seedStoredComments([
        createCommentInput({ filePath: "src/present.ts" }),
        createCommentInput({ filePath: "src/missing.ts" }),
      ]);
      reloadCommentStore(storage);
      expect(pendingCommentPaths()).toEqual(["src/missing.ts", "src/present.ts"]);

      const snapshot = createModel(owner);
      setScopeState(snapshot, "uncommitted", {
        ...createEmptyScopeStateFixture(),
        fileDiffs: [createFileDiff("src/present.ts")],
      });

      const harness = createHookHarness(useGitCommentDraftValidation, snapshot, harnessOptions);
      await harness.mount();

      expect(pendingCommentPaths()).toEqual(["src/present.ts"]);
      const stored = readInlineCommentDraftsFromStorage({ storage, ownerKey: COMMENT_OWNER_KEY });
      if (stored.status !== "restored") {
        throw new Error("Expected restored comments after missing-file validation.");
      }
      expect(stored.comments.map((comment) => comment.filePath)).toEqual(["src/present.ts"]);

      await harness.unmount();
    });

    test("skips unloaded and failed scopes and validates each owner scope once", async () => {
      const storage = createMemoryClientStorage();
      setCommentStorage(storage);
      seedStoredComments([
        createCommentInput({ filePath: "src/missing-uncommitted.ts" }),
        createCommentInput({ filePath: "src/missing-target.ts", diffScope: "target" }),
      ]);
      reloadCommentStore(storage);

      const snapshot = createModel(owner);
      snapshot.loadedScopesByScope = { target: false, uncommitted: false };

      const harness = createHookHarness(useGitCommentDraftValidation, snapshot, harnessOptions);
      await harness.mount();
      expect(pendingCommentPaths()).toEqual([
        "src/missing-target.ts",
        "src/missing-uncommitted.ts",
      ]);

      snapshot.loadedScopesByScope = { target: false, uncommitted: true };
      setScopeState(snapshot, "uncommitted", createEmptyScopeStateFixture());
      await harness.update({ ...snapshot });
      expect(pendingCommentPaths()).toEqual(["src/missing-target.ts"]);

      snapshot.loadedScopesByScope = { target: true, uncommitted: true };
      setScopeState(snapshot, "target", {
        ...createEmptyScopeStateFixture(),
        error: "Failed to load the target diff.",
      });
      await harness.update({ ...snapshot });
      expect(pendingCommentPaths()).toEqual(["src/missing-target.ts"]);

      setScopeState(snapshot, "target", createEmptyScopeStateFixture());
      await harness.update({ ...snapshot });
      expect(pendingCommentPaths()).toEqual([]);

      commentDrafts()
        .getState()
        .addDraft(
          COMMENT_OWNER_KEY,
          createCommentInput({ filePath: "src/late.ts", diffScope: "target" }),
        );
      setScopeState(snapshot, "target", {
        ...createEmptyScopeStateFixture(),
        fileDiffs: [createFileDiff("src/other.ts")],
      });
      await harness.update({ ...snapshot });
      expect(pendingCommentPaths()).toEqual(["src/late.ts"]);

      await harness.unmount();
    });
    test.each([
      { targetBranch: "HEAD", comparisonUnavailableReason: "No upstream branch" },
      { targetBranch: null, comparisonUnavailableReason: null },
    ])(
      "keeps target drafts when the comparison is unavailable: $targetBranch",
      async (comparison) => {
        const storage = createMemoryClientStorage();
        setCommentStorage(storage);
        seedStoredComments([createCommentInput({ diffScope: "target" })]);
        reloadCommentStore(storage);
        const model = {
          ...createModel(owner),
          ...comparison,
        };
        model.loadedScopesByScope = { target: true, uncommitted: true };
        model.scopeStatesByScope = {
          target: createEmptyScopeStateFixture(),
          uncommitted: createEmptyScopeStateFixture(),
        };
        const harness = createHookHarness(useGitCommentDraftValidation, model, harnessOptions);
        await harness.mount();
        expect(pendingCommentPaths()).toEqual(["src/file.ts"]);
        await harness.unmount();
      },
    );

    test.each(["target", "uncommitted"] satisfies DiffScope[])(
      "keeps restored %s comments through a failed read and other-scope reads until recovery",
      async (failedScope) => {
        const storage = createMemoryClientStorage();
        setCommentStorage(storage);
        seedStoredComments([createCommentInput({ diffScope: failedScope })]);
        reloadCommentStore(storage);
        const savedPayload = storage.getItem(COMMENT_OWNER_KEY);
        const otherScope = failedScope === "target" ? "uncommitted" : "target";
        const model = (
          scopes: Partial<
            Record<DiffScope, AgentStudioGitPanelModel["scopeStatesByScope"]["target"]>
          >,
        ): AgentStudioGitPanelModel => ({
          ...createModel(owner),
          loadedScopesByScope: {
            target: scopes.target !== undefined,
            uncommitted: scopes.uncommitted !== undefined,
          },
          scopeStatesByScope: {
            target: scopes.target ?? createEmptyScopeStateFixture(),
            uncommitted: scopes.uncommitted ?? createEmptyScopeStateFixture(),
          },
        });
        const failed = toFailedScopeState(
          createEmptyScopeStateFixture(),
          "Failed to read the diff.",
        );
        const harness = createHookHarness(
          useGitCommentDraftValidation,
          model({ [failedScope]: failed }),
          harnessOptions,
        );
        await harness.mount();
        try {
          await harness.update(
            model({ [failedScope]: failed, [otherScope]: createEmptyScopeStateFixture() }),
          );
          expect(pendingCommentPaths()).toEqual(["src/file.ts"]);
          expect(storage.getItem(COMMENT_OWNER_KEY)).toBe(savedPayload);

          await harness.update(
            model({
              [failedScope]: createEmptyScopeStateFixture(),
              [otherScope]: createEmptyScopeStateFixture(),
            }),
          );
          expect(pendingCommentPaths()).toEqual([]);
          expect(storage.getItem(COMMENT_OWNER_KEY)).toBeNull();
        } finally {
          await harness.unmount();
        }
      },
    );
  });
}
