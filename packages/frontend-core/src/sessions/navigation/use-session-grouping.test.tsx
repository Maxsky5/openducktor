import "../../test-support/dom-environment";
import { describe, expect, mock, test } from "bun:test";
import type { SettingsSnapshot } from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import type { PropsWithChildren, ReactElement } from "react";
import { ClientConnectionProvider } from "../../connection/client-connection-react";
import { workspaceQueryKeys } from "../../queries/workspace";
import { createFeedbackFake } from "../../test-support/feedback-fake";
import { createHookHarness } from "../../test-support/react-hook-harness";
import {
  createDeferred,
  createSettingsSnapshotFixture,
} from "../../test-support/shared-test-fixtures";
import { createTestClientConnection } from "../../test-support/test-client-connection";
import { useSessionGrouping } from "./use-session-grouping";

const createWrapper = (
  client: Partial<HostClient>,
  feedback: ReturnType<typeof createFeedbackFake> = createFeedbackFake(),
) => {
  const connection = createTestClientConnection({ client, feedback });
  return ({ children }: PropsWithChildren): ReactElement => (
    <ClientConnectionProvider connection={connection}>{children}</ClientConnectionProvider>
  );
};

describe("useSessionGrouping", () => {
  test("starts grouped and prevents writes until settings are loaded", async () => {
    const read = createDeferred<SettingsSnapshot>();
    const saved = createSettingsSnapshotFixture();
    const workspaceUpdateSidebarSessionGrouping = mock(async () => saved);
    const harness = createHookHarness(() => useSessionGrouping(), undefined, {
      wrapper: createWrapper({
        workspaceGetSettingsSnapshot: async () => read.promise,
        workspaceUpdateSidebarSessionGrouping,
      }),
    });
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
      const feedback = createFeedbackFake();
      const harness = createHookHarness(
        () => ({ ...useSessionGrouping(), queryClient: useQueryClient() }),
        undefined,
        {
          wrapper: createWrapper(
            {
              workspaceGetSettingsSnapshot: async () => initial,
              workspaceUpdateSidebarSessionGrouping,
            },
            feedback,
          ),
        },
      );
      const savedGrouping = (client: QueryClient) =>
        client.getQueryData<SettingsSnapshot>(workspaceQueryKeys.settingsSnapshot())?.appearance
          .sidebarSessionGrouping;
      try {
        await harness.mount();
        await harness.waitFor((state) => !state.disabled);
        await harness.run((state) => state.changeGrouping("none"));
        await harness.waitFor((state) => state.grouping === "none");
        const client = harness.getLatest().queryClient;
        expect(savedGrouping(client)).toBe("task");
        // A settings read during the save keeps the pending mode.
        await harness.run(() => {
          client.setQueryData(workspaceQueryKeys.settingsSnapshot(), { ...initial, theme: "dark" });
        });
        expect(harness.getLatest()).toMatchObject({ grouping: "none", disabled: false });
        if (result === "success") write.resolve(saved);
        else write.reject(new Error("Config directory is read-only"));
        await harness.waitFor((state) =>
          result === "success"
            ? savedGrouping(state.queryClient) === "none"
            : state.grouping === "task",
        );
        expect(workspaceUpdateSidebarSessionGrouping).toHaveBeenCalledTimes(1);
        expect(harness.getLatest().grouping).toBe(result === "success" ? "none" : "task");
        expect(
          client.getQueryData<SettingsSnapshot>(workspaceQueryKeys.settingsSnapshot())?.theme,
        ).toBe("dark");
        expect(feedback.shownOf("error").map((entry) => entry.message)).toEqual(
          result === "success" ? [] : ["The session grouping was not saved."],
        );
      } finally {
        await harness.unmount();
      }
    },
  );

  test("saves a change made during a save after it, and keeps the last change", async () => {
    const initial = createSettingsSnapshotFixture();
    const snapshotOf = (grouping: "task" | "none") =>
      createSettingsSnapshotFixture({
        appearance: { ...initial.appearance, sidebarSessionGrouping: grouping },
      });
    const writes = [createDeferred<SettingsSnapshot>(), createDeferred<SettingsSnapshot>()];
    const workspaceUpdateSidebarSessionGrouping = mock(
      async (_grouping: "task" | "none") =>
        // SAFETY: the test makes exactly two writes.
        writes[workspaceUpdateSidebarSessionGrouping.mock.calls.length - 1]!.promise,
    );
    const harness = createHookHarness(() => useSessionGrouping(), undefined, {
      wrapper: createWrapper({
        workspaceGetSettingsSnapshot: async () => initial,
        workspaceUpdateSidebarSessionGrouping,
      }),
    });
    try {
      await harness.mount();
      await harness.waitFor((state) => !state.disabled);
      await harness.run((state) => state.changeGrouping("none"));
      await harness.waitFor((state) => state.grouping === "none");
      await harness.run((state) => state.changeGrouping("task"));
      await harness.waitFor((state) => state.grouping === "task");
      expect(workspaceUpdateSidebarSessionGrouping.mock.calls).toEqual([["none"]]);

      writes[0]?.resolve(snapshotOf("none"));
      await harness.waitFor(() => workspaceUpdateSidebarSessionGrouping.mock.calls.length === 2);
      expect(harness.getLatest().grouping).toBe("task");
      expect(workspaceUpdateSidebarSessionGrouping.mock.calls).toEqual([["none"], ["task"]]);

      writes[1]?.resolve(snapshotOf("task"));
      await harness.waitFor((state) => state.grouping === "task");
    } finally {
      await harness.unmount();
    }
  });
});
