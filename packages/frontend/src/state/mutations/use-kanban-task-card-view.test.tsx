import { describe, expect, mock, test } from "bun:test";
import type { SettingsSnapshot } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import type { PropsWithChildren, ReactElement } from "react";
import { IsolatedQueryWrapper } from "@/test-utils/isolated-query-wrapper";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createDeferred, createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { loadSettingsSnapshotFromQuery, workspaceQueryKeys } from "@/state/queries/workspace";
import { useKanbanTaskCardView } from "./use-kanban-task-card-view";

const wrapper = ({ children }: PropsWithChildren): ReactElement => (
  <IsolatedQueryWrapper>{children}</IsolatedQueryWrapper>
);

describe("useKanbanTaskCardView", () => {
  test("keeps the optimistic view out of the saved settings cache", async () => {
    const initialSnapshot = createSettingsSnapshotFixture({
      kanban: { doneVisibleDays: 1, emptyColumnDisplay: "show", taskCardView: "normal" },
    });
    const write = createDeferred<never>();
    const workspaceGetSettingsSnapshot = mock(async () => initialSnapshot);
    const workspaceUpdateKanbanTaskCardView = mock(async () => write.promise);
    const testHost = { workspaceGetSettingsSnapshot, workspaceUpdateKanbanTaskCardView };
    const harness = createHookHarness(
      () => ({ ...useKanbanTaskCardView(testHost), queryClient: useQueryClient() }),
      undefined,
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.taskCardView === "normal", 2000);
      await harness.run((state) => state.changeTaskCardView("compact"));
      await harness.waitFor((state) => state.taskCardView === "compact" && state.isPending, 2000);
      expect(
        harness
          .getLatest()
          .queryClient.getQueryData<SettingsSnapshot>(workspaceQueryKeys.settingsSnapshot())?.kanban
          .taskCardView,
      ).toBe("normal");

      const settingsSnapshotWhilePending = await loadSettingsSnapshotFromQuery(
        harness.getLatest().queryClient,
        testHost,
      );
      expect(settingsSnapshotWhilePending.kanban.taskCardView).toBe("normal");

      await harness.run((state) => {
        state.queryClient.setQueryData(workspaceQueryKeys.settingsSnapshot(), {
          ...initialSnapshot,
          theme: "dark",
        });
      });

      write.reject(new Error("Disk is read-only"));
      await harness.waitFor((state) => state.taskCardView === "normal" && !state.isPending, 2000);
      expect(workspaceUpdateKanbanTaskCardView).toHaveBeenCalledWith("compact");
      expect(
        harness
          .getLatest()
          .queryClient.getQueryData<SettingsSnapshot>(workspaceQueryKeys.settingsSnapshot())?.kanban
          .taskCardView,
      ).toBe("normal");
      expect(
        harness
          .getLatest()
          .queryClient.getQueryData<{ theme: string }>(workspaceQueryKeys.settingsSnapshot())
          ?.theme,
      ).toBe("dark");
    } finally {
      await harness.unmount();
    }
  });

  test("replaces the optimistic value with the saved snapshot", async () => {
    const initialSnapshot = createSettingsSnapshotFixture({
      kanban: { doneVisibleDays: 1, emptyColumnDisplay: "show", taskCardView: "normal" },
    });
    const savedSnapshot = createSettingsSnapshotFixture({
      theme: "dark",
      kanban: { doneVisibleDays: 1, emptyColumnDisplay: "show", taskCardView: "compact" },
    });
    const write = createDeferred<typeof savedSnapshot>();
    const workspaceGetSettingsSnapshot = mock(async () => initialSnapshot);
    const workspaceUpdateKanbanTaskCardView = mock(async () => write.promise);
    const testHost = { workspaceGetSettingsSnapshot, workspaceUpdateKanbanTaskCardView };
    const harness = createHookHarness(
      () => ({ ...useKanbanTaskCardView(testHost), queryClient: useQueryClient() }),
      undefined,
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.taskCardView === "normal", 2000);
      await harness.run((state) => state.changeTaskCardView("compact"));
      await harness.waitFor((state) => state.taskCardView === "compact" && state.isPending, 2000);
      expect(
        harness
          .getLatest()
          .queryClient.getQueryData<SettingsSnapshot>(workspaceQueryKeys.settingsSnapshot())?.kanban
          .taskCardView,
      ).toBe("normal");

      write.resolve(savedSnapshot);
      await harness.waitFor((state) => state.taskCardView === "compact" && !state.isPending, 2000);
      expect(
        harness
          .getLatest()
          .queryClient.getQueryData<{ theme: string }>(workspaceQueryKeys.settingsSnapshot())
          ?.theme,
      ).toBe("dark");
    } finally {
      await harness.unmount();
    }
  });
});
