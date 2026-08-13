import { describe, expect, mock, test } from "bun:test";
import type { AgentModelFavorite, SettingsSnapshot } from "@openducktor/contracts";
import type { PropsWithChildren, ReactElement } from "react";
import { host } from "@/state/operations/shared/host";
import { IsolatedQueryWrapper } from "@/test-utils/isolated-query-wrapper";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { useAgentModelFavorites } from "./use-agent-model-favorites";

const wrapper = ({ children }: PropsWithChildren): ReactElement => (
  <IsolatedQueryWrapper>{children}</IsolatedQueryWrapper>
);

const favorite: AgentModelFavorite = {
  runtimeKind: "opencode",
  providerId: "openai",
  modelId: "gpt-5",
};

describe("useAgentModelFavorites", () => {
  test("does not turn a settings read failure into an empty favorites list", async () => {
    const original = host.workspaceGetSettingsSnapshot;
    host.workspaceGetSettingsSnapshot = mock(async () => {
      throw new Error("Settings unavailable");
    });
    const harness = createHookHarness(
      useAgentModelFavorites,
      { saveAgentModelFavorites: mock(async () => createSettingsSnapshotFixture()) },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.readError !== null, 2000);
      expect(harness.getLatest()).toEqual(
        expect.objectContaining({
          favorites: null,
          readError: "Settings unavailable",
          canMutate: false,
        }),
      );
    } finally {
      await harness.unmount();
      host.workspaceGetSettingsSnapshot = original;
    }
  });

  test("blocks favorite writes while a cached settings refetch has failed", async () => {
    const initialSnapshot = createSettingsSnapshotFixture({ agentModelFavorites: [favorite] });
    const original = host.workspaceGetSettingsSnapshot;
    let readShouldFail = false;
    host.workspaceGetSettingsSnapshot = mock(async () => {
      if (readShouldFail) {
        throw new Error("Settings refetch failed");
      }
      return initialSnapshot;
    });
    const saveAgentModelFavorites = mock(async () => initialSnapshot);
    const harness = createHookHarness(
      useAgentModelFavorites,
      { saveAgentModelFavorites },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.favorites !== null, 2000);
      readShouldFail = true;
      await harness.run((state) => state.retryRead());
      await harness.waitFor((state) => state.readError !== null, 2000);

      expect(harness.getLatest()).toEqual(
        expect.objectContaining({
          favorites: [favorite],
          readError: "Settings refetch failed",
          canMutate: false,
        }),
      );
      await harness.run((state) => state.toggleFavorite(favorite));
      expect(saveAgentModelFavorites).not.toHaveBeenCalled();

      readShouldFail = false;
      await harness.run((state) => state.retryRead());
      await harness.waitFor((state) => state.readError === null, 2000);
      await harness.run((state) => state.toggleFavorite(favorite));
      await harness.waitFor(() => saveAgentModelFavorites.mock.calls.length === 1, 2000);
    } finally {
      await harness.unmount();
      host.workspaceGetSettingsSnapshot = original;
    }
  });

  test("keeps persisted favorites after a failed write and retries the same change", async () => {
    const initialSnapshot = createSettingsSnapshotFixture();
    const savedSnapshot = createSettingsSnapshotFixture({ agentModelFavorites: [favorite] });
    const original = host.workspaceGetSettingsSnapshot;
    host.workspaceGetSettingsSnapshot = mock(async () => initialSnapshot);
    let attempts = 0;
    const saveAgentModelFavorites = mock(
      async (favorites: AgentModelFavorite[]): Promise<SettingsSnapshot> => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("Favorite write failed");
        }
        expect(favorites).toEqual([favorite]);
        return savedSnapshot;
      },
    );
    const harness = createHookHarness(
      useAgentModelFavorites,
      { saveAgentModelFavorites },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.favorites !== null, 2000);
      await harness.run((state) => state.toggleFavorite(favorite));
      await harness.waitFor((state) => state.mutationError !== null, 2000);
      expect(harness.getLatest().favorites).toEqual([]);
      expect(harness.getLatest().mutationError).toBe("Favorite write failed");

      await harness.run((state) => state.retryMutation());
      await harness.waitFor((state) => state.favorites?.length === 1, 2000);
      expect(harness.getLatest().favorites).toEqual([favorite]);
      expect(saveAgentModelFavorites).toHaveBeenCalledTimes(2);
    } finally {
      await harness.unmount();
      host.workspaceGetSettingsSnapshot = original;
    }
  });
});
