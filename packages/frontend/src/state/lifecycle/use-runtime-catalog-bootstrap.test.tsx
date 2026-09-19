import { expect, mock, test } from "bun:test";
import { CLAUDE_RUNTIME_DESCRIPTOR, OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type {
  AgentModelCatalog,
  AgentRuntimeCatalog,
  RuntimeWorkingDirectoryRef,
} from "@openducktor/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { waitFor } from "@testing-library/react";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import {
  createRepoRuntimeHealthFixture,
  createRuntimeCatalogFixture,
} from "@/test-utils/shared-test-fixtures";
import { useRuntimeCatalogBootstrap } from "./use-runtime-catalog-bootstrap";

const MODEL_CATALOG: AgentModelCatalog = {
  models: [],
  defaultModelsByProvider: {},
};

const runtimeCatalog = createRuntimeCatalogFixture({ models: MODEL_CATALOG });

const repoCatalogKey = (repoPath: string) =>
  ["runtime-catalog", "catalog", repoPath, "opencode", repoPath] as const;

const createHarness = (
  client: QueryClient,
  args: Parameters<typeof useRuntimeCatalogBootstrap>[0],
) =>
  createHookHarness(
    (input: Parameters<typeof useRuntimeCatalogBootstrap>[0]) => useRuntimeCatalogBootstrap(input),
    args,
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );

test("prefetches one catalog for each enabled and ready runtime", async () => {
  const client = new QueryClient();
  const loadRepoRuntimeCatalog = mock(
    async (_runtimeRef: RuntimeWorkingDirectoryRef) => runtimeCatalog,
  );
  const harness = createHarness(client, {
    activeWorkspace: { workspaceId: "workspace", workspaceName: "Repo", repoPath: "/repo" },
    enabledRuntimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, CLAUDE_RUNTIME_DESCRIPTOR],
    runtimeHealthByRuntime: {
      opencode: createRepoRuntimeHealthFixture({ status: "ready" }),
      claude: createRepoRuntimeHealthFixture({ status: "not_started" }),
    },
    loadRepoRuntimeCatalog,
  });

  try {
    await harness.mount();
    await waitFor(() => expect(loadRepoRuntimeCatalog).toHaveBeenCalledTimes(1));

    expect(loadRepoRuntimeCatalog).toHaveBeenCalledWith({
      repoPath: "/repo",
      runtimeKind: "opencode",
      workingDirectory: "/repo",
    });
    expect(client.getQueryData<AgentRuntimeCatalog>(repoCatalogKey("/repo"))).toEqual(
      runtimeCatalog,
    );
  } finally {
    await harness.unmount();
    client.clear();
  }
});

test("reuses a fresh catalog without another host read", async () => {
  const client = new QueryClient();
  client.setQueryData(repoCatalogKey("/repo"), runtimeCatalog);
  const loadRepoRuntimeCatalog = mock(
    async (_runtimeRef: RuntimeWorkingDirectoryRef) => runtimeCatalog,
  );
  const harness = createHarness(client, {
    activeWorkspace: { workspaceId: "workspace", workspaceName: "Repo", repoPath: "/repo" },
    enabledRuntimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    runtimeHealthByRuntime: {
      opencode: createRepoRuntimeHealthFixture({ status: "ready" }),
    },
    loadRepoRuntimeCatalog,
  });

  try {
    await harness.mount();
    await waitFor(() => expect(client.getQueryState(repoCatalogKey("/repo"))).toBeDefined());

    expect(loadRepoRuntimeCatalog).toHaveBeenCalledTimes(0);
  } finally {
    await harness.unmount();
    client.clear();
  }
});

test("reloads an invalidated catalog when the runtime is ready", async () => {
  const client = new QueryClient();
  client.setQueryData(repoCatalogKey("/repo"), runtimeCatalog);
  await client.invalidateQueries({ queryKey: repoCatalogKey("/repo") });
  const loadRepoRuntimeCatalog = mock(
    async (_runtimeRef: RuntimeWorkingDirectoryRef) => runtimeCatalog,
  );
  const harness = createHarness(client, {
    activeWorkspace: { workspaceId: "workspace", workspaceName: "Repo", repoPath: "/repo" },
    enabledRuntimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    runtimeHealthByRuntime: {
      opencode: createRepoRuntimeHealthFixture({ status: "ready" }),
    },
    loadRepoRuntimeCatalog,
  });

  try {
    await harness.mount();
    await waitFor(() => expect(loadRepoRuntimeCatalog).toHaveBeenCalledTimes(1));

    expect(client.getQueryState(repoCatalogKey("/repo"))?.isInvalidated).toBe(false);
  } finally {
    await harness.unmount();
    client.clear();
  }
});

test("loads a catalog when a runtime becomes ready after startup", async () => {
  const client = new QueryClient();
  const loadRepoRuntimeCatalog = mock(
    async (_runtimeRef: RuntimeWorkingDirectoryRef) => runtimeCatalog,
  );
  const args = {
    activeWorkspace: { workspaceId: "workspace", workspaceName: "Repo", repoPath: "/repo" },
    enabledRuntimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    runtimeHealthByRuntime: {
      opencode: createRepoRuntimeHealthFixture({ status: "not_started" }),
    },
    loadRepoRuntimeCatalog,
  };
  const harness = createHarness(client, args);

  try {
    await harness.mount();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(loadRepoRuntimeCatalog).toHaveBeenCalledTimes(0);

    await harness.update({
      ...args,
      runtimeHealthByRuntime: {
        opencode: createRepoRuntimeHealthFixture({ status: "ready" }),
      },
    });
    await waitFor(() => expect(loadRepoRuntimeCatalog).toHaveBeenCalledTimes(1));
  } finally {
    await harness.unmount();
    client.clear();
  }
});

test("loads the new repository catalogs after a workspace switch", async () => {
  const client = new QueryClient();
  const loadRepoRuntimeCatalog = mock(
    async (_runtimeRef: RuntimeWorkingDirectoryRef) => runtimeCatalog,
  );
  const args = {
    activeWorkspace: { workspaceId: "workspace", workspaceName: "Repo", repoPath: "/repo" },
    enabledRuntimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    runtimeHealthByRuntime: {
      opencode: createRepoRuntimeHealthFixture({ status: "ready" }),
    },
    loadRepoRuntimeCatalog,
  };
  const harness = createHarness(client, args);

  try {
    await harness.mount();
    await waitFor(() =>
      expect(loadRepoRuntimeCatalog).toHaveBeenCalledWith({
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo",
      }),
    );

    await harness.update({
      ...args,
      activeWorkspace: { workspaceId: "other", workspaceName: "Other", repoPath: "/other" },
    });
    await waitFor(() =>
      expect(loadRepoRuntimeCatalog).toHaveBeenCalledWith({
        repoPath: "/other",
        runtimeKind: "opencode",
        workingDirectory: "/other",
      }),
    );
    expect(client.getQueryData<AgentRuntimeCatalog>(repoCatalogKey("/other"))).toEqual(
      runtimeCatalog,
    );
  } finally {
    await harness.unmount();
    client.clear();
  }
});

test("does not read catalogs without an active workspace", async () => {
  const client = new QueryClient();
  const loadRepoRuntimeCatalog = mock(
    async (_runtimeRef: RuntimeWorkingDirectoryRef) => runtimeCatalog,
  );
  const harness = createHarness(client, {
    activeWorkspace: null,
    enabledRuntimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    runtimeHealthByRuntime: {
      opencode: createRepoRuntimeHealthFixture({ status: "ready" }),
    },
    loadRepoRuntimeCatalog,
  });

  try {
    await harness.mount();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(loadRepoRuntimeCatalog).toHaveBeenCalledTimes(0);
  } finally {
    await harness.unmount();
    client.clear();
  }
});
