import { enableReactActEnvironment } from "@/test-utils/react-act-environment";
import { describe, expect, mock, test } from "bun:test";
import type { AgentSkillCatalog, RuntimeWorkingDirectoryRef } from "@openducktor/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createElement, type PropsWithChildren } from "react";
import { QueryProvider } from "@/lib/query-provider";
import {
  repoRuntimeSkillsQueryOptions,
  runtimeCatalogQueryKeys,
} from "@/state/queries/runtime-catalog";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import type { ChatComposerPromptInputRuntime } from "./chat-composer-prompt-input-runtime";
import { useChatComposerSkills } from "./use-chat-composer-skills";

enableReactActEnvironment();

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(QueryProvider, { useIsolatedClient: true }, children);

const EMPTY_CATALOG: AgentSkillCatalog = { skills: [] };

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
  liveQuery: useQuery(repoRuntimeSkillsQueryOptions(sessionRuntimeRef, args.loadSkillsForRepo)),
  composer: useChatComposerSkills(args),
  queryClient: useQueryClient(),
});

describe("useChatComposerSkills", () => {
  test("surfaces session-scoped runtime context errors without querying skills", async () => {
    const loadSkillsForRepo = mock(async () => EMPTY_CATALOG);
    const harness = createHookHarness(
      useChatComposerSkills,
      {
        promptInputRuntime: {
          state: "unavailable",
          runtimeKind: "codex",
          error: "Selected session runtime context is missing working directory.",
        },
        supportsSkillReferences: true,
        loadSkillsForRepo,
      },
      { wrapper },
    );

    try {
      await harness.mount();

      expect(loadSkillsForRepo).not.toHaveBeenCalled();
      expect(harness.getLatest().skills).toEqual([]);
      expect(harness.getLatest().skillsError).toBe(
        "Selected session runtime context is missing working directory.",
      );
    } finally {
      await harness.unmount();
    }
  });

  test("does not query skills when skill references are unsupported", async () => {
    const loadSkillsForRepo = mock(async () => EMPTY_CATALOG);
    const harness = createHookHarness(
      useChatComposerSkills,
      {
        promptInputRuntime: sessionRuntime,
        supportsSkillReferences: false,
        loadSkillsForRepo,
      },
      { wrapper },
    );

    try {
      await harness.mount();

      expect(loadSkillsForRepo).not.toHaveBeenCalled();
      expect(harness.getLatest()).toEqual({
        skillCatalog: EMPTY_CATALOG,
        skills: [],
        skillsError: null,
        isSkillsLoading: false,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("keeps the live skills key fetchable while the composer skips it", async () => {
    const loadSkillsForRepo = mock(async () => EMPTY_CATALOG);
    const harness = createHookHarness(
      useSkillsWithLiveReader,
      {
        promptInputRuntime: sessionRuntime,
        supportsSkillReferences: false,
        loadSkillsForRepo,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.liveQuery.data !== undefined);

      await harness.run(({ queryClient }) =>
        queryClient.invalidateQueries({
          queryKey: runtimeCatalogQueryKeys.repoSkills(sessionRuntimeRef),
          exact: true,
        }),
      );

      expect(loadSkillsForRepo).toHaveBeenCalledTimes(2);
      expect(harness.getLatest().liveQuery.data).toEqual(EMPTY_CATALOG);
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
    const loadSkillsForRepo = mock(async () => catalog);
    const harness = createHookHarness(
      useChatComposerSkills,
      {
        promptInputRuntime: sessionRuntime,
        supportsSkillReferences: true,
        loadSkillsForRepo,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.skills.length === 1);

      expect(loadSkillsForRepo).toHaveBeenCalledWith({
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
