import { expect, test } from "bun:test";
import { waitFor } from "@testing-library/react";
import type { SettingsSnapshot } from "@openducktor/contracts";
import { workspaceQueryKeys } from "@openducktor/frontend-core/queries/workspace";
import { prepareSettingsSnapshotForSave } from "./settings-save/settings-snapshot";
import { diffSettingsSnapshot } from "@openducktor/contracts";
import type { ClientConnection } from "@openducktor/frontend-core/connection/client-connection";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { createHookHarness } from "@openducktor/frontend-core/test-support/react-hook-harness";
import {
  createRepoSettingsConfigFixture,
  createSettingsSnapshotFixture,
} from "@/test-utils/shared-test-fixtures";
import { useSettingsModalSnapshotState } from "./use-settings-modal-snapshot-state";

const createSnapshotHarness = (
  connection: ClientConnection,
  props: Parameters<typeof useSettingsModalSnapshotState>[0],
) =>
  createHookHarness(useSettingsModalSnapshotState, props, {
    wrapper: ({ children }) => (
      <ClientConnectionProvider connection={connection}>{children}</ClientConnectionProvider>
    ),
  });

test("a failed settings read ends loading and shows its error only while open", async () => {
  let rejectRead!: (cause: Error) => void;
  const pending = new Promise<SettingsSnapshot>((_resolve, reject) => {
    rejectRead = reject;
  });
  const connection = createTestClientConnection({
    client: { workspaceGetSettingsSnapshot: () => pending },
  });
  const props = {
    open: true,
    workspaceSelectionPolicy: { kind: "preferred" as const, repoPath: null },
  };
  const harness = createSnapshotHarness(connection, props);
  try {
    await harness.mount();
    expect(harness.getLatest().isLoadingSettings).toBe(true);
    expect(harness.getLatest().snapshotDraft).toBeNull();
    await harness.run(() => rejectRead(new Error("Settings database is unavailable.")));
    await waitFor(() =>
      expect(harness.getLatest().settingsError).toBe("Settings database is unavailable."),
    );
    expect(harness.getLatest().isLoadingSettings).toBe(false);
    expect(harness.getLatest().snapshotDraft).toBeNull();
    await harness.update({ ...props, open: false });
    expect(harness.getLatest().settingsError).toBeNull();
  } finally {
    await harness.unmount();
    await connection.dispose();
  }
});

test.each(["partial", "failed"] as const)(
  "a reopened settings view rebases %s edits onto fresh saved fields",
  async (outcome) => {
    const original = createSettingsSnapshotFixture({
      workspaces: {
        alpha: createRepoSettingsConfigFixture("alpha", "/repos/alpha"),
        removed: createRepoSettingsConfigFixture("removed", "/repos/removed"),
      },
    });
    const draft: SettingsSnapshot = {
      ...original,
      git: { ...original.git, removeWorktreeOnClose: false },
      system: { preferredOpenInToolId: "zed" as const },
      reusablePrompts: [
        { id: "snippet", name: "Review", description: "", content: "Review this." },
      ],
      chat: { ...original.chat, showThinkingMessages: true },
      workspaces: {
        ...original.workspaces,
        alpha: {
          ...original.workspaces.alpha!,
          workspaceName: outcome === "failed" ? "" : "alpha",
        },
      },
    };
    const connection = createTestClientConnection();
    connection.queryClient.setQueryData(workspaceQueryKeys.settingsSnapshot(), original);
    const props = {
      open: true,
      workspaceSelectionPolicy: { kind: "preferred" as const, repoPath: null },
    };
    const first = createSnapshotHarness(connection, props);
    const second = createSnapshotHarness(connection, props);
    try {
      await first.mount();
      expect(first.getLatest().loadedSnapshot).toEqual(original);
      await first.run((state) => state.setSnapshotDraft(() => draft));
      if (outcome === "partial")
        await first.run((state) =>
          state.acknowledgeSave(true, prepareSettingsSnapshotForSave(draft, original)),
        );
      else await first.run((state) => state.retainDraft());
      const saved: SettingsSnapshot = {
        ...original,
        git: outcome === "partial" ? draft.git : original.git,
        appearance: { ...original.appearance, horizontalScrollbarVisibility: "hide" },
        workspaces: { alpha: { ...original.workspaces.alpha!, branchPrefix: "foreign" } },
      };
      await first.update({ ...props, open: false });
      await first.unmount();
      connection.queryClient.setQueryData(workspaceQueryKeys.settingsSnapshot(), saved);
      await second.mount();
      expect(second.getLatest().loadedSnapshot).toEqual(saved);
      expect(second.getLatest().snapshotDraft).toMatchObject({
        git: draft.git,
        system: draft.system,
        reusablePrompts: draft.reusablePrompts,
        chat: draft.chat,
        appearance: saved.appearance,
        workspaces: {
          alpha: {
            workspaceName: outcome === "failed" ? "" : "alpha",
            branchPrefix: "foreign",
          },
        },
      });
      expect(second.getLatest().snapshotDraft?.workspaces.removed).toBeUndefined();
      expect(second.getLatest().loadedSnapshot).toMatchObject({
        git: saved.git,
        system: original.system,
        reusablePrompts: original.reusablePrompts,
        chat: original.chat,
      });
      await second.run((state) =>
        state.acknowledgeSave(
          false,
          prepareSettingsSnapshotForSave(
            {
              ...state.snapshotDraft!,
              workspaces: {
                ...state.snapshotDraft!.workspaces,
                alpha: { ...state.snapshotDraft!.workspaces.alpha!, workspaceName: "alpha" },
              },
            },
            state.draftBaseline!,
          ),
        ),
      );
      expect(connection.drafts.settings.retained).toBeNull();
    } finally {
      await first.unmount();
      await second.unmount();
      await connection.dispose();
    }
  },
);

test.each([false, true])(
  "an open settings view refreshes clean fields and preserves edits: dirty=%s",
  async (dirty) => {
    const original = createSettingsSnapshotFixture({
      workspaces: { alpha: createRepoSettingsConfigFixture("alpha", "/repos/alpha") },
    });
    const connection = createTestClientConnection();
    connection.queryClient.setQueryData(workspaceQueryKeys.settingsSnapshot(), original);
    const harness = createSnapshotHarness(connection, {
      open: true,
      workspaceSelectionPolicy: { kind: "preferred", repoPath: null },
    });
    try {
      await harness.mount();
      expect(harness.getLatest().snapshotDraft).toEqual(original);
      if (dirty)
        await harness.run((state) =>
          state.setSnapshotDraft(
            (current) =>
              current && { ...current, chat: { ...current.chat, showThinkingMessages: true } },
          ),
        );
      const saved: SettingsSnapshot = {
        ...original,
        git: { ...original.git, defaultMergeMethod: "squash" },
      };
      await harness.run(() => {
        connection.queryClient.setQueryData(workspaceQueryKeys.settingsSnapshot(), saved);
      });
      await waitFor(() =>
        expect(harness.getLatest().snapshotDraft?.git.defaultMergeMethod).toBe("squash"),
      );
      expect(harness.getLatest().loadedSnapshot?.git.defaultMergeMethod).toBe("squash");
      expect(harness.getLatest().snapshotDraft?.chat.showThinkingMessages).toBe(dirty);
      expect(
        diffSettingsSnapshot(
          harness.getLatest().loadedSnapshot!,
          harness.getLatest().snapshotDraft!,
        ),
      ).toEqual(dirty ? { global: { chat: { showThinkingMessages: true } } } : {});
    } finally {
      await harness.unmount();
      await connection.dispose();
    }
  },
);

test.each(["role", "workspace"] as const)(
  "a removed %s keeps its edit intent and retained text until Discard",
  async (target) => {
    const original = createSettingsSnapshotFixture({
      customAgentRoles: [{ id: "review", name: "Reviewer", systemPrompt: "Original" }],
      workspaces: { alpha: createRepoSettingsConfigFixture("alpha", "/repos/shared") },
    });
    const connection = createTestClientConnection();
    connection.queryClient.setQueryData(workspaceQueryKeys.settingsSnapshot(), original);
    const props = {
      open: true,
      workspaceSelectionPolicy: { kind: "preferred" as const, repoPath: null },
    };
    const first = createSnapshotHarness(connection, props);
    const second = createSnapshotHarness(connection, props);
    try {
      await first.mount();
      expect(first.getLatest().snapshotDraft).toEqual(original);
      await first.run((state) =>
        state.setSnapshotDraft(
          (current) =>
            current &&
            (target === "role"
              ? {
                  ...current,
                  customAgentRoles: [
                    { ...current.customAgentRoles[0]!, systemPrompt: "UNSAVED role prompt" },
                  ],
                }
              : {
                  ...current,
                  workspaces: {
                    alpha: { ...current.workspaces.alpha!, branchPrefix: "UNSAVED-prefix" },
                  },
                }),
        ),
      );
      await first.update({ ...props, open: false });
      await first.unmount();
      expect(connection.drafts.settings.retained).not.toBeNull();
      const saved: SettingsSnapshot = {
        ...original,
        customAgentRoles: target === "role" ? [] : original.customAgentRoles,
        workspaces:
          target === "workspace"
            ? { beta: createRepoSettingsConfigFixture("beta", "/repos/shared") }
            : original.workspaces,
      };
      connection.queryClient.setQueryData(workspaceQueryKeys.settingsSnapshot(), saved);
      await second.mount();
      expect(second.getLatest().loadedSnapshot).toEqual(saved);
      await waitFor(() =>
        expect(second.getLatest().unavailableTargetError).toContain("no longer available"),
      );
      const state = second.getLatest();
      const request = prepareSettingsSnapshotForSave(state.snapshotDraft!, state.draftBaseline!);
      if (target === "role") {
        expect(state.snapshotDraft?.customAgentRoles[0]?.systemPrompt).toBe("UNSAVED role prompt");
        expect(request.customAgentRoles).toEqual({
          update: { review: { systemPrompt: "UNSAVED role prompt" } },
        });
        expect(connection.drafts.settings.retained?.baseline.customAgentRoles[0]?.id).toBe(
          "review",
        );
      } else {
        expect(state.selectedWorkspaceId).toBe("alpha");
        expect(state.snapshotDraft?.workspaces.alpha?.branchPrefix).toBe("UNSAVED-prefix");
        expect(state.loadedSnapshot?.workspaces.alpha).toBeUndefined();
        expect(request.workspaces).toEqual({
          alpha: { expectedRepoPath: "/repos/shared", branchPrefix: "UNSAVED-prefix" },
        });
        expect(connection.drafts.settings.retained?.draft.workspaces.alpha?.branchPrefix).toBe(
          "UNSAVED-prefix",
        );
      }
      await second.run((current) => current.discardDraft());
      expect(connection.drafts.settings.retained).toBeNull();
      expect(second.getLatest().snapshotDraft).toEqual(saved);
      expect(second.getLatest().unavailableTargetError).toBeNull();
    } finally {
      await first.unmount();
      await second.unmount();
      await connection.dispose();
    }
  },
);
