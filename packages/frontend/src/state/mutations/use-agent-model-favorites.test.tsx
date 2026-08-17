import { describe, expect, mock, test } from "bun:test";
import type { AgentModelFavorite, SettingsSnapshot } from "@openducktor/contracts";
import type { PropsWithChildren, ReactElement } from "react";
import { host } from "@/state/operations/shared/host";
import { IsolatedQueryWrapper } from "@/test-utils/isolated-query-wrapper";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createDeferred, createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { useAgentModelFavorites } from "./use-agent-model-favorites";

const wrapper = ({ children }: PropsWithChildren): ReactElement => (
  <IsolatedQueryWrapper>{children}</IsolatedQueryWrapper>
);

const favorite: AgentModelFavorite = {
  runtimeKind: "opencode",
  providerId: "openai",
  modelId: "gpt-5",
};

const concurrentFavorite: AgentModelFavorite = {
  runtimeKind: "codex",
  providerId: "openai",
  modelId: "gpt-5.6-sol",
};

const useTwoAgentModelFavorites = (args: {
  saveAgentModelFavorites: (favorites: AgentModelFavorite[]) => Promise<SettingsSnapshot>;
}) => ({
  first: useAgentModelFavorites(args),
  second: useAgentModelFavorites(args),
});

describe("useAgentModelFavorites", () => {
  test("composes writes from separate mounted hooks against the latest saved favorites", async () => {
    const initialSnapshot = createSettingsSnapshotFixture();
    const firstSavedSnapshot = createSettingsSnapshotFixture({
      agentModelFavorites: [favorite],
    });
    const firstWrite = createDeferred<SettingsSnapshot>();
    const original = host.workspaceGetSettingsSnapshot;
    host.workspaceGetSettingsSnapshot = mock(async () => initialSnapshot);
    let saveAttempt = 0;
    const saveAgentModelFavorites = mock(
      async (favorites: AgentModelFavorite[]): Promise<SettingsSnapshot> => {
        saveAttempt += 1;
        if (saveAttempt === 1) {
          return firstWrite.promise;
        }
        return createSettingsSnapshotFixture({ agentModelFavorites: favorites });
      },
    );
    const harness = createHookHarness(
      useTwoAgentModelFavorites,
      { saveAgentModelFavorites },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor(
        (state) => state.first.favorites !== null && state.second.favorites !== null,
        2000,
      );
      await harness.run((state) => state.first.toggleFavorite(favorite));
      await harness.waitFor(() => saveAgentModelFavorites.mock.calls.length === 1, 2000);
      await harness.run((state) => state.second.toggleFavorite(concurrentFavorite));

      expect(saveAgentModelFavorites).toHaveBeenCalledTimes(1);

      firstWrite.resolve(firstSavedSnapshot);
      await harness.waitFor(() => saveAgentModelFavorites.mock.calls.length === 2, 2000);
      await harness.waitFor((state) => state.first.favorites?.length === 2, 2000);

      expect(saveAgentModelFavorites.mock.calls[1]?.[0]).toEqual([favorite, concurrentFavorite]);
      expect(harness.getLatest().first.favorites).toEqual([favorite, concurrentFavorite]);
      expect(harness.getLatest().second.favorites).toEqual([favorite, concurrentFavorite]);

      await harness.run((state) => state.first.toggleFavorite(favorite));
      await harness.waitFor(() => saveAgentModelFavorites.mock.calls.length === 3, 2000);
      await harness.waitFor((state) => state.first.favorites?.length === 1, 2000);
      expect(saveAgentModelFavorites.mock.calls[2]?.[0]).toEqual([concurrentFavorite]);
      expect(harness.getLatest().second.favorites).toEqual([concurrentFavorite]);
    } finally {
      await harness.unmount();
      host.workspaceGetSettingsSnapshot = original;
    }
  });

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

  test("blocks a failed mutation retry until settings recover and preserves revalidated favorites", async () => {
    const initialSnapshot = createSettingsSnapshotFixture();
    const revalidatedSnapshot = createSettingsSnapshotFixture({
      agentModelFavorites: [concurrentFavorite],
    });
    const savedSnapshot = createSettingsSnapshotFixture({
      agentModelFavorites: [concurrentFavorite, favorite],
    });
    const original = host.workspaceGetSettingsSnapshot;
    let settingsRead: "initial" | "failed" | "revalidated" = "initial";
    host.workspaceGetSettingsSnapshot = mock(async () => {
      if (settingsRead === "failed") {
        throw new Error("Settings refetch failed");
      }
      return settingsRead === "revalidated" ? revalidatedSnapshot : initialSnapshot;
    });
    let saveAttempts = 0;
    const saveAgentModelFavorites = mock(
      async (favorites: AgentModelFavorite[]): Promise<SettingsSnapshot> => {
        saveAttempts += 1;
        if (saveAttempts === 1) {
          throw new Error("Favorite write failed");
        }
        expect(favorites).toEqual([concurrentFavorite, favorite]);
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

      settingsRead = "failed";
      await harness.run((state) => state.retryRead());
      await harness.waitFor((state) => state.readError !== null, 2000);
      await harness.run((state) => state.retryMutation());
      expect(saveAgentModelFavorites).toHaveBeenCalledTimes(1);

      settingsRead = "revalidated";
      await harness.run((state) => state.retryRead());
      await harness.waitFor((state) => state.readError === null, 2000);
      expect(harness.getLatest().favorites).toEqual([concurrentFavorite]);

      await harness.run((state) => state.retryMutation());
      await harness.waitFor((state) => state.favorites?.length === 2, 2000);
      expect(harness.getLatest().favorites).toEqual([concurrentFavorite, favorite]);
      expect(saveAgentModelFavorites).toHaveBeenCalledTimes(2);
    } finally {
      await harness.unmount();
      host.workspaceGetSettingsSnapshot = original;
    }
  });
});
