import { describe, expect, mock, test } from "bun:test";
import type { AgentSkillCatalog } from "@openducktor/core";
import { createElement, type PropsWithChildren } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import type { ChatComposerPromptInputRuntime } from "./chat-composer-prompt-input-runtime";
import { useChatComposerSkills } from "./use-chat-composer-skills";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(QueryProvider, { useIsolatedClient: true }, children);

const EMPTY_CATALOG: AgentSkillCatalog = { skills: [] };

const sessionRuntime: ChatComposerPromptInputRuntime = {
  state: "available",
  scope: "session",
  runtimeRef: {
    repoPath: "/repo",
    runtimeKind: "codex",
    workingDirectory: "/repo/worktree",
  },
};

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
