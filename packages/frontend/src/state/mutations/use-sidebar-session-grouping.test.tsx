import { describe, expect, mock, test } from "bun:test";
import type { SettingsSnapshot } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import type { PropsWithChildren, ReactElement } from "react";
import { IsolatedQueryWrapper } from "@/test-utils/isolated-query-wrapper";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createDeferred, createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { workspaceQueryKeys } from "@/state/queries/workspace";
import { useSidebarSessionGrouping } from "./use-sidebar-session-grouping";

const wrapper = ({ children }: PropsWithChildren): ReactElement => (
  <IsolatedQueryWrapper>{children}</IsolatedQueryWrapper>
);

describe("Sidebar session grouping preference", () => {
  test("starts grouped and prevents writes until settings are loaded", async () => {
    const read = createDeferred<SettingsSnapshot>();
    const saved = createSettingsSnapshotFixture();
    const workspaceUpdateSidebarSessionGrouping = mock(async () => saved);
    const harness = createHookHarness(
      () =>
        useSidebarSessionGrouping({
          workspaceGetSettingsSnapshot: async () => read.promise,
          workspaceUpdateSidebarSessionGrouping,
        }),
      undefined,
      { wrapper },
    );
    try {
      await harness.mount();
      expect(harness.getLatest().grouping).toBe("task");
      expect(harness.getLatest().disabled).toBe(true);
      await harness.run((state) => state.changeGrouping("none"));
      expect(workspaceUpdateSidebarSessionGrouping).not.toHaveBeenCalled();
      read.resolve(saved);
      await harness.waitFor((state) => !state.disabled);
    } finally {
      await harness.unmount();
    }
  });

  test.each(["success", "failure"] as const)(
    "shows a pending mode at once without putting it in the saved cache: %s",
    async (result) => {
      const initial = createSettingsSnapshotFixture();
      const saved = createSettingsSnapshotFixture({
        theme: "dark",
        appearance: { ...initial.appearance, sidebarSessionGrouping: "none" },
      });
      const write = createDeferred<SettingsSnapshot>();
      const workspaceUpdateSidebarSessionGrouping = mock(async () => write.promise);
      const harness = createHookHarness(
        () => ({
          ...useSidebarSessionGrouping({
            workspaceGetSettingsSnapshot: async () => initial,
            workspaceUpdateSidebarSessionGrouping,
          }),
          queryClient: useQueryClient(),
        }),
        undefined,
        { wrapper },
      );
      try {
        await harness.mount();
        await harness.waitFor((state) => !state.disabled);
        await harness.run((state) => state.changeGrouping("none"));
        await harness.waitFor((state) => state.grouping === "none" && state.disabled);
        const client = harness.getLatest().queryClient;
        expect(
          client.getQueryData<SettingsSnapshot>(workspaceQueryKeys.settingsSnapshot())?.appearance
            .sidebarSessionGrouping,
        ).toBe("task");
        await harness.run((state) => {
          state.changeGrouping("task");
          client.setQueryData(workspaceQueryKeys.settingsSnapshot(), { ...initial, theme: "dark" });
        });
        expect(workspaceUpdateSidebarSessionGrouping).toHaveBeenCalledTimes(1);
        expect(workspaceUpdateSidebarSessionGrouping).toHaveBeenCalledWith("none");
        if (result === "success") write.resolve(saved);
        else write.reject(new Error("Config directory is read-only"));
        await harness.waitFor(
          (state) => !state.disabled && state.grouping === (result === "success" ? "none" : "task"),
        );
        expect(
          client.getQueryData<SettingsSnapshot>(workspaceQueryKeys.settingsSnapshot())?.theme,
        ).toBe("dark");
        expect(
          client.getQueryData<SettingsSnapshot>(workspaceQueryKeys.settingsSnapshot())?.appearance
            .sidebarSessionGrouping,
        ).toBe(result === "success" ? "none" : "task");
      } finally {
        await harness.unmount();
      }
    },
  );
});
