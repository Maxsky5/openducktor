import { enableReactActEnvironment } from "@/test-utils/react-act-environment";
import { describe, expect, mock, test } from "bun:test";
import type {
  AgentRuntimeCatalog,
  AgentSkillCatalog,
  RuntimeWorkingDirectoryRef,
} from "@openducktor/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createElement, type PropsWithChildren } from "react";
import { QueryProvider } from "@/lib/query-provider";
import {
  runtimeCatalogQueryKeys,
  runtimeCatalogQueryOptions,
} from "@/state/queries/runtime-catalog";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createRuntimeCatalogFixture } from "@/test-utils/shared-test-fixtures";
import type { ChatComposerPromptInputRuntime } from "./chat-composer-prompt-input-runtime";
import { useChatComposerSkills } from "./use-chat-composer-skills";

enableReactActEnvironment();

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(QueryProvider, { useIsolatedClient: true }, children);

const EMPTY_CATALOG: AgentSkillCatalog = { skills: [] };
const emptyCatalogFixture: AgentRuntimeCatalog = createRuntimeCatalogFixture({
  skills: EMPTY_CATALOG,
});

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

const useSkillsWithLiveReader = (args: Parameters<typeof useChatComposerSkills>[0]) => ({
  liveQuery: useQuery(runtimeCatalogQueryOptions(sessionRuntimeRef, args.loadRuntimeCatalog)),
  composer: useChatComposerSkills(args),
  queryClient: useQueryClient(),
});

describe("useChatComposerSkills", () => {
  test("surfaces session-scoped runtime context errors without querying skills", async () => {
    const loadRuntimeCatalog = mock(async () => emptyCatalogFixture);
    const harness = createHookHarness(
      useChatComposerSkills,
      {
        promptInputRuntime: {
          state: "unavailable",
          runtimeKind: "codex",
          error: "Selected session runtime context is missing working directory.",
        },
        supportsSkillReferences: true,
        loadRuntimeCatalog,
      },
      { wrapper },
    );

    try {
      await harness.mount();

      expect(loadRuntimeCatalog).not.toHaveBeenCalled();
      expect(harness.getLatest().skills).toEqual([]);
      expect(harness.getLatest().skillsError).toBe(
        "Selected session runtime context is missing working directory.",
      );
    } finally {
      await harness.unmount();
    }
  });

  test("does not query skills when skill references are unsupported", async () => {
    const loadRuntimeCatalog = mock(async () => emptyCatalogFixture);
    const harness = createHookHarness(
      useChatComposerSkills,
      {
        promptInputRuntime: sessionRuntime,
        supportsSkillReferences: false,
        loadRuntimeCatalog,
      },
      { wrapper },
    );

    try {
      await harness.mount();

      expect(loadRuntimeCatalog).not.toHaveBeenCalled();
      expect(harness.getLatest()).toEqual({
        skillCatalog: EMPTY_CATALOG,
        skills: [],
        skillsError: null,
        isSkillsLoading: false,
        retrySkills: null,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("keeps the live catalog key fetchable while the composer skips it", async () => {
    const loadRuntimeCatalog = mock(async () => emptyCatalogFixture);
    const harness = createHookHarness(
      useSkillsWithLiveReader,
      {
        promptInputRuntime: sessionRuntime,
        supportsSkillReferences: false,
        loadRuntimeCatalog,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.liveQuery.data !== undefined);

      await harness.run(({ queryClient }) =>
        queryClient.invalidateQueries({
          queryKey: runtimeCatalogQueryKeys.catalog(sessionRuntimeRef),
          exact: true,
        }),
      );

      expect(loadRuntimeCatalog).toHaveBeenCalledTimes(2);
      expect(harness.getLatest().liveQuery.data).toEqual(emptyCatalogFixture);
    } finally {
      await harness.unmount();
    }
  });

  test("retries a failed skill read through the composer retry", async () => {
    const catalogFixture = createRuntimeCatalogFixture({ skills: EMPTY_CATALOG });
    let attempt = 0;
    const loadRuntimeCatalog = mock(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error("catalog offline");
      }
      return catalogFixture;
    });
    const harness = createHookHarness(
      useChatComposerSkills,
      {
        promptInputRuntime: sessionRuntime,
        supportsSkillReferences: true,
        loadRuntimeCatalog,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.skillsError !== null);

      expect(harness.getLatest().skillsError).toBe("catalog offline");
      expect(harness.getLatest().retrySkills).not.toBeNull();

      await harness.run((state) => {
        state.retrySkills?.();
      });
      await harness.waitFor((state) => state.skillsError === null);

      expect(loadRuntimeCatalog).toHaveBeenCalledTimes(2);
      expect(harness.getLatest().skills).toEqual([]);
    } finally {
      await harness.unmount();
    }
  });

  test("drops retained skills after a settled background refresh failure", async () => {
    const catalog: AgentSkillCatalog = {
      skills: [
        {
          id: "review",
          name: "review",
          path: "/repo/.codex/skills/review/SKILL.md",
        },
      ],
    };
    let rejectRefresh: ((reason: Error) => void) | undefined;
    const refresh = new Promise<AgentRuntimeCatalog>((_resolve, reject) => {
      rejectRefresh = reject;
    });
    const catalogRequests = [
      Promise.resolve(createRuntimeCatalogFixture({ skills: catalog })),
      refresh,
    ];
    const loadRuntimeCatalog = mock(() => {
      const request = catalogRequests.shift();
      if (!request) {
        throw new Error("unexpected catalog request");
      }
      return request;
    });
    const harness = createHookHarness(
      useSkillsWithLiveReader,
      {
        promptInputRuntime: sessionRuntime,
        supportsSkillReferences: true,
        loadRuntimeCatalog,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.composer.skills.length === 1);

      await harness.run(({ queryClient }) => {
        void queryClient.invalidateQueries({
          queryKey: runtimeCatalogQueryKeys.catalog(sessionRuntimeRef),
          exact: true,
        });
      });
      await harness.waitFor((state) => state.liveQuery.isFetching);
      expect(harness.getLatest().composer.skills).toEqual(catalog.skills);

      rejectRefresh?.(new Error("catalog offline"));
      await harness.waitFor((state) => state.composer.skillsError === "catalog offline");

      expect(harness.getLatest().composer.skills).toEqual([]);
      expect(harness.getLatest().composer.skillCatalog).toEqual(EMPTY_CATALOG);

      let rejectRetry: ((reason: Error) => void) | undefined;
      const retry = new Promise<AgentRuntimeCatalog>((_resolve, reject) => {
        rejectRetry = reject;
      });
      catalogRequests.push(retry);
      await harness.run((state) => {
        state.composer.retrySkills?.();
      });
      await harness.waitFor((state) => state.liveQuery.isFetching);

      expect(harness.getLatest().composer.skills).toEqual([]);
      expect(harness.getLatest().composer.skillsError).toBe("catalog offline");

      rejectRetry?.(new Error("catalog offline"));
      await harness.waitFor((state) => !state.liveQuery.isFetching);
      expect(harness.getLatest().composer.skills).toEqual([]);
    } finally {
      await harness.unmount();
    }
  });

  test("reads session-scoped skills using the session working directory", async () => {
    const catalog: AgentSkillCatalog = {
      skills: [
        {
          id: "review",
          name: "review",
          path: "/repo/.codex/skills/review/SKILL.md",
        },
      ],
    };
    const catalogFixture = createRuntimeCatalogFixture({ skills: catalog });
    const loadRuntimeCatalog = mock(async () => catalogFixture);
    const harness = createHookHarness(
      useChatComposerSkills,
      {
        promptInputRuntime: sessionRuntime,
        supportsSkillReferences: true,
        loadRuntimeCatalog,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.skills.length === 1);

      expect(loadRuntimeCatalog).toHaveBeenCalledWith({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo/worktree",
      });
      expect(harness.getLatest().skills).toEqual(catalog.skills);
    } finally {
      await harness.unmount();
    }
  });
});
