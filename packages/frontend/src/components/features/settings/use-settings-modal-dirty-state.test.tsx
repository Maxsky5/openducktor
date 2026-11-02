import { expect, test } from "bun:test";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { useSettingsModalDirtyState } from "./use-settings-modal-dirty-state";

test("a partial save baseline leaves failed preference edits dirty", () => {
  const baseline = createSettingsSnapshotFixture();
  const draft = {
    ...baseline,
    git: { ...baseline.git, removeWorktreeOnClose: !baseline.git.removeWorktreeOnClose },
    chat: { ...baseline.chat, showThinkingMessages: !baseline.chat.showThinkingMessages },
  };
  const sharedSaved = { ...baseline, git: draft.git };
  const state = useSettingsModalDirtyState({
    open: true,
    baseline: sharedSaved,
    draft,
  });
  expect(state.dirtySections.globalGit).toBe(false);
  expect(state.dirtySections.chat).toBe(true);
  expect(
    useSettingsModalDirtyState({
      open: true,
      baseline: sharedSaved,
      draft: sharedSaved,
    }).dirtySections.chat,
  ).toBe(false);
});

test("reordered object keys do not mark a section dirty", () => {
  const baseline = createSettingsSnapshotFixture();
  const reorderedGit: typeof baseline.git = {
    removeWorktreeOnClose: baseline.git.removeWorktreeOnClose,
    defaultMergeMethod: baseline.git.defaultMergeMethod,
  };
  expect(JSON.stringify(reorderedGit)).not.toBe(JSON.stringify(baseline.git));
  const state = useSettingsModalDirtyState({
    open: true,
    baseline,
    draft: { ...baseline, git: reorderedGit },
  });
  expect(state.dirtySections.globalGit).toBe(false);
});
