import { describe, expect, mock, test } from "bun:test";
import type { PropsWithChildren, ReactElement } from "react";
import { host } from "@/state/operations/host";
import { IsolatedQueryWrapper } from "@/test-utils/isolated-query-wrapper";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createDeferred, createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { useKanbanTaskCardView } from "./use-kanban-task-card-view";

const wrapper = ({ children }: PropsWithChildren): ReactElement => (
  <IsolatedQueryWrapper>{children}</IsolatedQueryWrapper>
);

describe("useKanbanTaskCardView", () => {
  test("updates optimistically and restores the saved view when persistence fails", async () => {
    const initialSnapshot = createSettingsSnapshotFixture({
      kanban: { doneVisibleDays: 1, emptyColumnDisplay: "show", taskCardView: "normal" },
    });
    const write = createDeferred<never>();
    const originalRead = host.workspaceGetSettingsSnapshot;
    const originalWrite = host.workspaceUpdateKanbanTaskCardView;
    host.workspaceGetSettingsSnapshot = mock(async () => initialSnapshot);
    host.workspaceUpdateKanbanTaskCardView = mock(async () => write.promise);
    const harness = createHookHarness(useKanbanTaskCardView, undefined, { wrapper });

    try {
      await harness.mount();
      await harness.waitFor((state) => state.taskCardView === "normal", 2000);
      await harness.run((state) => state.changeTaskCardView("compact"));
      await harness.waitFor((state) => state.taskCardView === "compact" && state.isPending, 2000);

      write.reject(new Error("Disk is read-only"));
      await harness.waitFor((state) => state.taskCardView === "normal" && !state.isPending, 2000);
      expect(host.workspaceUpdateKanbanTaskCardView).toHaveBeenCalledWith("compact");
    } finally {
      await harness.unmount();
      host.workspaceGetSettingsSnapshot = originalRead;
      host.workspaceUpdateKanbanTaskCardView = originalWrite;
    }
  });
});
