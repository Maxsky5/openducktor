import { expect, test } from "bun:test";
import { repoConfigSchema, type SettingsSnapshot } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { host } from "@/state/operations/host";
import { useRepoSettingsOperations } from "@/state/operations/workspace/use-repo-settings-operations";
import { workspaceQueryKeys } from "@/state/queries/workspace";
import { IsolatedQueryWrapper } from "@/test-utils/isolated-query-wrapper";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createDeferred, createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { useAgentModelFavorites } from "./use-agent-model-favorites";
import { usePreferredOpenInTool } from "./use-preferred-open-in-tool";

function useHarness() {
  return {
    preference: usePreferredOpenInTool(),
    secondPreference: usePreferredOpenInTool(),
    settings: useRepoSettingsOperations({
      activeWorkspace: null,
      applyWorkspaceRecord: () => {},
      applyWorkspaceRecords: () => {},
    }),
    queryClient: useQueryClient(),
  };
}

for (const preferenceFirst of [true, false]) {
  test(`keeps overlapping full and narrow saves in order when ${preferenceFirst ? "preference" : "full save"} responds late`, async () => {
    const initial = createSettingsSnapshotFixture({ system: { preferredOpenInToolId: "zed" } });
    let persisted = initial;
    const firstResponse = createDeferred<void>();
    const started = createDeferred<void>();
    const calls: string[] = [];
    const originals = {
      save: host.workspaceSaveSettingsSnapshot,
      preference: host.systemUpdatePreferredOpenInTool,
      read: host.workspaceGetSettingsSnapshot,
    };
    host.workspaceGetSettingsSnapshot = async () => persisted;
    host.systemUpdatePreferredOpenInTool = async (system) => {
      calls.push("preference");
      persisted = { ...persisted, system };
      const response = persisted;
      if (preferenceFirst) {
        started.resolve();
        await firstResponse.promise;
      }
      return response;
    };
    host.workspaceSaveSettingsSnapshot = async (snapshot) => {
      calls.push("full");
      persisted = { ...persisted, general: snapshot.general };
      if (!preferenceFirst) {
        started.resolve();
        await firstResponse.promise;
      }
      return [];
    };
    const harness = createHookHarness(useHarness, undefined, { wrapper: IsolatedQueryWrapper });
    try {
      await harness.mount();
      const { queryClient, preference, settings } = harness.getLatest();
      queryClient.setQueryData(workspaceQueryKeys.settingsSnapshot(), initial);
      const writePreference = () => preference.savePreference({ preferredOpenInToolId: "cursor" });
      const writeFull = () =>
        settings.saveSettingsSnapshot({
          ...initial,
          expectedSystem: initial.system,
          general: { openAgentStudioTabOnBackgroundSessionStart: false },
        });
      const first = preferenceFirst ? writePreference() : writeFull();
      await started.promise;
      const second = preferenceFirst ? writeFull() : writePreference();
      expect(calls).toEqual([preferenceFirst ? "preference" : "full"]);
      firstResponse.resolve();
      await harness.run(async () => {
        await Promise.all([first, second]);
      });
      expect(calls).toEqual(preferenceFirst ? ["preference", "full"] : ["full", "preference"]);
      expect(
        queryClient.getQueryData<SettingsSnapshot>(workspaceQueryKeys.settingsSnapshot()),
      ).toEqual(persisted);
      expect(persisted.system).toEqual({ preferredOpenInToolId: "cursor" });
      expect(persisted.general.openAgentStudioTabOnBackgroundSessionStart).toBe(false);
    } finally {
      firstResponse.resolve();
      await harness.unmount();
      host.workspaceSaveSettingsSnapshot = originals.save;
      host.systemUpdatePreferredOpenInTool = originals.preference;
      host.workspaceGetSettingsSnapshot = originals.read;
    }
  });
}

test("shares pending state, rejects failed writes, and permits a later preference change", async () => {
  const original = host.systemUpdatePreferredOpenInTool;
  const response = createDeferred<SettingsSnapshot>();
  const started = createDeferred<void>();
  host.systemUpdatePreferredOpenInTool = () => {
    started.resolve();
    return response.promise;
  };
  const harness = createHookHarness(useHarness, undefined, { wrapper: IsolatedQueryWrapper });
  try {
    await harness.mount();
    const initial = createSettingsSnapshotFixture();
    const { queryClient } = harness.getLatest();
    queryClient.setQueryData(workspaceQueryKeys.settingsSnapshot(), initial);
    const failed = harness
      .getLatest()
      .preference.savePreference({ preferredOpenInToolId: "zed" })
      .catch((error: Error) => error);
    await started.promise;
    await harness.waitFor((state) => state.secondPreference.isSavingPreference, 700);
    response.reject(new Error("disk full"));
    expect(await failed).toEqual(new Error("disk full"));
    expect(
      queryClient.getQueryData<SettingsSnapshot>(workspaceQueryKeys.settingsSnapshot()),
    ).toEqual(initial);
    host.systemUpdatePreferredOpenInTool = async (system) => ({ ...initial, system });
    await harness.run(async (state) => {
      await state.secondPreference.savePreference({ preferredOpenInToolId: "cursor" });
    });
    expect(
      queryClient.getQueryData<SettingsSnapshot>(workspaceQueryKeys.settingsSnapshot())?.system,
    ).toEqual({ preferredOpenInToolId: "cursor" });
  } finally {
    await harness.unmount();
    host.systemUpdatePreferredOpenInTool = original;
  }
});

test("a read started before a preference write cannot restore the old snapshot", async () => {
  const original = host.systemUpdatePreferredOpenInTool;
  const initial = createSettingsSnapshotFixture();
  const staleRead = createDeferred<SettingsSnapshot>();
  const started = createDeferred<void>();
  host.systemUpdatePreferredOpenInTool = async (system) => ({ ...initial, system });
  const harness = createHookHarness(useHarness, undefined, { wrapper: IsolatedQueryWrapper });
  try {
    await harness.mount();
    const { queryClient } = harness.getLatest();
    const key = workspaceQueryKeys.settingsSnapshot();
    queryClient.setQueryData(key, initial);
    const read = queryClient
      .fetchQuery({
        queryKey: key,
        staleTime: 0,
        queryFn: () => {
          started.resolve();
          return staleRead.promise;
        },
      })
      .catch(() => undefined);
    await started.promise;
    await harness.run(async (state) => {
      await state.preference.savePreference({ preferredOpenInToolId: "zed" });
    });
    staleRead.resolve(initial);
    await read;
    expect(queryClient.getQueryData<SettingsSnapshot>(key)?.system).toEqual({
      preferredOpenInToolId: "zed",
    });
  } finally {
    staleRead.resolve(initial);
    await harness.unmount();
    host.systemUpdatePreferredOpenInTool = original;
  }
});

test("a late favorites callback preserves a newer preference", async () => {
  const original = host.workspaceGetSettingsSnapshot;
  const initial = createSettingsSnapshotFixture();
  const response = createDeferred<SettingsSnapshot>();
  host.workspaceGetSettingsSnapshot = async () => initial;
  const harness = createHookHarness(
    () => ({
      favorites: useAgentModelFavorites({ saveAgentModelFavorites: () => response.promise }),
      queryClient: useQueryClient(),
    }),
    undefined,
    { wrapper: IsolatedQueryWrapper },
  );
  const favorite = { runtimeKind: "opencode" as const, providerId: "openai", modelId: "gpt-5" };
  try {
    await harness.mount();
    await harness.waitFor((state) => state.favorites.canMutate, 700);
    await harness.run((state) => state.favorites.toggleFavorite(favorite));
    const { queryClient } = harness.getLatest();
    queryClient.setQueryData(workspaceQueryKeys.settingsSnapshot(), {
      ...initial,
      system: { preferredOpenInToolId: "zed" },
    });
    response.resolve({ ...initial, agentModelFavorites: [favorite] });
    await harness.waitFor((state) => state.favorites.favorites?.length === 1, 700);
    expect(
      queryClient.getQueryData<SettingsSnapshot>(workspaceQueryKeys.settingsSnapshot())?.system,
    ).toEqual({ preferredOpenInToolId: "zed" });
  } finally {
    response.resolve(initial);
    await harness.unmount();
    host.workspaceGetSettingsSnapshot = original;
  }
});

test("a late preference response keeps a workspace added to the settings cache", async () => {
  const original = host.systemUpdatePreferredOpenInTool;
  const initial = createSettingsSnapshotFixture();
  const response = createDeferred<SettingsSnapshot>();
  const started = createDeferred<void>();
  host.systemUpdatePreferredOpenInTool = () => {
    started.resolve();
    return response.promise;
  };
  const harness = createHookHarness(useHarness, undefined, { wrapper: IsolatedQueryWrapper });
  try {
    await harness.mount();
    const { queryClient, preference } = harness.getLatest();
    const key = workspaceQueryKeys.settingsSnapshot();
    queryClient.setQueryData(key, initial);
    const write = preference.savePreference({ preferredOpenInToolId: "zed" });
    await started.promise;
    const added = createSettingsSnapshotFixture({
      workspaces: {
        added: repoConfigSchema.parse({
          workspaceId: "added",
          workspaceName: "Added",
          repoPath: "/repos/added",
          defaultRuntimeKind: "opencode",
        }),
      },
    });
    queryClient.setQueryData(key, added);
    response.resolve({ ...initial, system: { preferredOpenInToolId: "zed" } });
    await harness.run(async () => {
      await write;
    });
    expect(queryClient.getQueryData<SettingsSnapshot>(key)).toEqual({
      ...added,
      system: { preferredOpenInToolId: "zed" },
    });
  } finally {
    response.resolve(initial);
    await harness.unmount();
    host.systemUpdatePreferredOpenInTool = original;
  }
});

for (const readFails of [false, true]) {
  test(`an empty preference cache ${readFails ? "reports a failed settings read" : "loads current host settings"}`, async () => {
    const originalWrite = host.systemUpdatePreferredOpenInTool;
    const originalRead = host.workspaceGetSettingsSnapshot;
    const old = createSettingsSnapshotFixture();
    const current = createSettingsSnapshotFixture({
      system: { preferredOpenInToolId: "cursor" },
      workspaces: {
        added: repoConfigSchema.parse({
          workspaceId: "added",
          workspaceName: "Added",
          repoPath: "/repos/added",
          defaultRuntimeKind: "opencode",
        }),
      },
    });
    host.systemUpdatePreferredOpenInTool = async (system) => ({ ...old, system });
    host.workspaceGetSettingsSnapshot = async () => {
      if (readFails) throw new Error("Settings read failed");
      return current;
    };
    const harness = createHookHarness(useHarness, undefined, { wrapper: IsolatedQueryWrapper });
    try {
      await harness.mount();
      await harness.run(async ({ preference }) => {
        const write = preference.savePreference({ preferredOpenInToolId: "zed" });
        if (readFails) {
          await expect(write).rejects.toThrow("Settings read failed");
        } else {
          await write;
        }
      });
      const cached = harness
        .getLatest()
        .queryClient.getQueryData<SettingsSnapshot>(workspaceQueryKeys.settingsSnapshot());
      if (readFails) {
        expect(cached).toBeUndefined();
      } else {
        expect(cached).toEqual(current);
      }
    } finally {
      await harness.unmount();
      host.systemUpdatePreferredOpenInTool = originalWrite;
      host.workspaceGetSettingsSnapshot = originalRead;
    }
  });
}

test("a preference response refreshes settings invalidated by a workspace write", async () => {
  const originalWrite = host.systemUpdatePreferredOpenInTool;
  const originalRead = host.workspaceGetSettingsSnapshot;
  const initial = createSettingsSnapshotFixture();
  const current = createSettingsSnapshotFixture({
    system: { preferredOpenInToolId: "zed" },
    workspaces: {
      added: repoConfigSchema.parse({
        workspaceId: "added",
        workspaceName: "Added",
        repoPath: "/repos/added",
        defaultRuntimeKind: "opencode",
      }),
    },
  });
  const response = createDeferred<SettingsSnapshot>();
  const started = createDeferred<void>();
  host.systemUpdatePreferredOpenInTool = () => {
    started.resolve();
    return response.promise;
  };
  host.workspaceGetSettingsSnapshot = async () => current;
  const harness = createHookHarness(useHarness, undefined, { wrapper: IsolatedQueryWrapper });
  try {
    await harness.mount();
    const { queryClient, preference } = harness.getLatest();
    const key = workspaceQueryKeys.settingsSnapshot();
    queryClient.setQueryData(key, initial);
    const write = preference.savePreference({ preferredOpenInToolId: "zed" });
    await started.promise;
    await queryClient.invalidateQueries({ queryKey: key, exact: true, refetchType: "none" });
    response.resolve({ ...initial, system: { preferredOpenInToolId: "zed" } });
    await harness.run(async () => {
      await write;
    });
    expect(queryClient.getQueryData<SettingsSnapshot>(key)).toEqual(current);
  } finally {
    response.resolve(initial);
    await harness.unmount();
    host.systemUpdatePreferredOpenInTool = originalWrite;
    host.workspaceGetSettingsSnapshot = originalRead;
  }
});
