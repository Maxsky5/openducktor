import { enableReactActEnvironment } from "@/test-utils/react-act-environment";
import { describe, expect, mock, test } from "bun:test";
import type { AgentRuntimeCatalog, RuntimeWorkingDirectoryRef } from "@openducktor/core";
import { useQueryClient } from "@tanstack/react-query";
import { createElement, type PropsWithChildren } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { runtimeCatalogQueryKeys } from "@/state/queries/runtime-catalog";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createRuntimeCatalogFixture } from "@/test-utils/shared-test-fixtures";
import type { ChatComposerPromptInputRuntime } from "./chat-composer-prompt-input-runtime";
import { useChatComposerCatalogRefresh } from "./use-chat-composer-catalog-refresh";

enableReactActEnvironment();

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(QueryProvider, { useIsolatedClient: true }, children);

const sessionRuntimeRef: RuntimeWorkingDirectoryRef = {
  repoPath: "/repo",
  runtimeKind: "codex",
  workingDirectory: "/repo/worktree",
};

const sessionRuntime: ChatComposerPromptInputRuntime = {
  state: "available",
  scope: "session",
  runtimeRef: sessionRuntimeRef,
};

const catalogFixture = createRuntimeCatalogFixture();

const useRefreshWithClient = (args: Parameters<typeof useChatComposerCatalogRefresh>[0]) => ({
  refresh: useChatComposerCatalogRefresh(args),
  queryClient: useQueryClient(),
});

describe("useChatComposerCatalogRefresh", () => {
  test("reuses a fresh cached catalog without a runtime read", async () => {
    const loadRuntimeCatalog = mock(async () => catalogFixture);
    const harness = createHookHarness(
      useRefreshWithClient,
      { promptInputRuntime: sessionRuntime, loadRuntimeCatalog },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.run(({ queryClient }) => {
        queryClient.setQueryData(
          runtimeCatalogQueryKeys.catalog(sessionRuntimeRef),
          catalogFixture,
        );
      });
      await harness.run(({ refresh }) => {
        refresh();
      });

      expect(loadRuntimeCatalog).not.toHaveBeenCalled();
      expect(
        harness
          .getLatest()
          .queryClient.getQueryData<AgentRuntimeCatalog>(
            runtimeCatalogQueryKeys.catalog(sessionRuntimeRef),
          ),
      ).toEqual(catalogFixture);
    } finally {
      await harness.unmount();
    }
  });

  test("fetches the combined catalog when the cached entry is stale", async () => {
    const loadRuntimeCatalog = mock(async () => catalogFixture);
    const harness = createHookHarness(
      useRefreshWithClient,
      { promptInputRuntime: sessionRuntime, loadRuntimeCatalog },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.run(({ queryClient }) => {
        queryClient.setQueryData(
          runtimeCatalogQueryKeys.catalog(sessionRuntimeRef),
          catalogFixture,
          { updatedAt: 0 },
        );
      });
      await harness.run(({ refresh }) => {
        refresh();
      });
      await harness.waitFor(() => loadRuntimeCatalog.mock.calls.length === 1);

      expect(loadRuntimeCatalog).toHaveBeenCalledWith(sessionRuntimeRef);
    } finally {
      await harness.unmount();
    }
  });

  test("does nothing while the prompt input runtime is unavailable", async () => {
    const loadRuntimeCatalog = mock(async () => catalogFixture);
    const harness = createHookHarness(
      useRefreshWithClient,
      {
        promptInputRuntime: {
          state: "unavailable",
          runtimeKind: "codex",
          error: "Selected session runtime context is missing working directory.",
        },
        loadRuntimeCatalog,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.run(({ refresh }) => {
        refresh();
      });

      expect(loadRuntimeCatalog).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });
});
