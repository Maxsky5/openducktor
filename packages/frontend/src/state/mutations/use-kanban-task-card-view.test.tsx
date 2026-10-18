import { describe, expect, mock, test } from "bun:test";
import type { SettingsSnapshot } from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import { useQueryClient } from "@tanstack/react-query";
import type { PropsWithChildren, ReactElement } from "react";
import { createHookHarness } from "@openducktor/frontend-core/test-support/react-hook-harness";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { QueryProvider } from "@/test-utils/query-provider";
import { createDeferred, createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import {
  loadSettingsSnapshotFromQuery,
  workspaceQueryKeys,
} from "@openducktor/frontend-core/queries/workspace";
import { useKanbanTaskCardView } from "./use-kanban-task-card-view";

const createKanbanTaskCardViewHarness = (client: Partial<HostClient>) => {
  const connection = createTestClientConnection({ client });
  const wrapper = ({ children }: PropsWithChildren): ReactElement => (
    <QueryProvider connection={connection}>{children}</QueryProvider>
  );
  return createHookHarness(
    () => ({ ...useKanbanTaskCardView(), queryClient: useQueryClient() }),
    undefined,
    { wrapper },
  );
};

describe("useKanbanTaskCardView", () => {
  test("keeps the optimistic view out of the saved settings cache", async () => {
    const initialSnapshot = createSettingsSnapshotFixture({
      kanban: { doneVisibleDays: 1, emptyColumnDisplay: "show", taskCardView: "normal" },
    });
    const write = createDeferred<never>();
    const workspaceGetSettingsSnapshot = mock(async () => initialSnapshot);
    const workspaceUpdateKanbanTaskCardView = mock(async () => write.promise);
    const harness = createKanbanTaskCardViewHarness({
      workspaceGetSettingsSnapshot,
      workspaceUpdateKanbanTaskCardView,
    });

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
    const harness = createKanbanTaskCardViewHarness({
      workspaceGetSettingsSnapshot,
      workspaceUpdateKanbanTaskCardView,
    });

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

  test("allows a card view write after a refetch error retains cached settings", async () => {
    const initialSnapshot = createSettingsSnapshotFixture({
      kanban: { doneVisibleDays: 1, emptyColumnDisplay: "show", taskCardView: "normal" },
    });
    const savedSnapshot = createSettingsSnapshotFixture({
      kanban: { doneVisibleDays: 1, emptyColumnDisplay: "show", taskCardView: "compact" },
    });
    const write = createDeferred<typeof savedSnapshot>();
    let shouldFailSettingsRead = false;
    const workspaceGetSettingsSnapshot = mock(async () => {
      if (shouldFailSettingsRead) {
        throw new Error("Settings unavailable");
      }
      return initialSnapshot;
    });
    const workspaceUpdateKanbanTaskCardView = mock(async () => write.promise);
    const harness = createKanbanTaskCardViewHarness({
      workspaceGetSettingsSnapshot,
      workspaceUpdateKanbanTaskCardView,
    });

    try {
      await harness.mount();
      await harness.waitFor((state) => state.taskCardView === "normal", 2000);
      shouldFailSettingsRead = true;
      await harness.run(async (state) => {
        await state.queryClient.invalidateQueries({
          queryKey: workspaceQueryKeys.settingsSnapshot(),
          exact: true,
        });
      });
      await harness.waitFor(
        (state) =>
          state.queryClient.getQueryState(workspaceQueryKeys.settingsSnapshot())?.status ===
            "error" && state.taskCardView === "normal",
        2000,
      );

      await harness.run((state) => state.changeTaskCardView("compact"));
      await harness.waitFor((state) => state.taskCardView === "compact" && state.isPending, 2000);
      expect(workspaceUpdateKanbanTaskCardView).toHaveBeenCalledWith("compact");

      write.resolve(savedSnapshot);
      await harness.waitFor((state) => !state.isPending, 2000);
    } finally {
      await harness.unmount();
    }
  });
});
