import { describe, expect, mock, test } from "bun:test";
import type { AgentSkillCatalog } from "@openducktor/core";
import { createElement, type PropsWithChildren } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { useChatComposerSkills } from "./use-chat-composer-skills";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(QueryProvider, { useIsolatedClient: true }, children);

const EMPTY_CATALOG: AgentSkillCatalog = { skills: [] };

describe("useChatComposerSkills", () => {
  test("surfaces active-session runtime context errors without querying skills", async () => {
    const loadSkillsForRepo = mock(async () => EMPTY_CATALOG);
    const readSessionSkills = mock(async () => EMPTY_CATALOG);
    const harness = createHookHarness(
      useChatComposerSkills,
      {
        hasActiveSession: true,
        activeSessionStatus: "idle",
        activeSessionRuntimeRef: null,
        activeSessionRuntimeRefError:
          "Active session runtime context is missing working directory.",
        supportsSkillReferences: true,
        workspaceRepoPath: "/repo",
        selectedRuntimeKind: "codex",
        loadSkillsForRepo,
        readSessionSkills,
      },
      { wrapper },
    );

    try {
      await harness.mount();

      expect(readSessionSkills).not.toHaveBeenCalled();
      expect(loadSkillsForRepo).not.toHaveBeenCalled();
      expect(harness.getLatest().skills).toEqual([]);
      expect(harness.getLatest().skillsError).toBe(
        "Active session runtime context is missing working directory.",
      );
    } finally {
      await harness.unmount();
    }
  });

  test("reads active-session skills using the active working directory", async () => {
    const catalog: AgentSkillCatalog = {
      skills: [
        {
          id: "review",
          name: "review",
          path: "/repo/.codex/skills/review/SKILL.md",
        },
      ],
    };
    const loadSkillsForRepo = mock(async () => EMPTY_CATALOG);
    const readSessionSkills = mock(async () => catalog);
    const harness = createHookHarness(
      useChatComposerSkills,
      {
        hasActiveSession: true,
        activeSessionStatus: "idle",
        activeSessionRuntimeRef: {
          repoPath: "/repo",
          runtimeKind: "codex",
          workingDirectory: "/repo/worktree",
        },
        activeSessionRuntimeRefError: null,
        supportsSkillReferences: true,
        workspaceRepoPath: "/repo",
        selectedRuntimeKind: "codex",
        loadSkillsForRepo,
        readSessionSkills,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.skills.length === 1);

      expect(loadSkillsForRepo).not.toHaveBeenCalled();
      expect(readSessionSkills).toHaveBeenCalledWith("/repo", "codex", "/repo/worktree");
      expect(harness.getLatest().skills).toEqual(catalog.skills);
    } finally {
      await harness.unmount();
    }
  });
});
