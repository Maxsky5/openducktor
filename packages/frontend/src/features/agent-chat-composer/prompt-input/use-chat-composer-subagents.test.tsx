import { describe, expect, mock, test } from "bun:test";
import type { AgentSubagentCatalog } from "@openducktor/core";
import { createElement, type PropsWithChildren } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import type { ChatComposerPromptInputRuntime } from "./chat-composer-prompt-input-runtime";
import { useChatComposerSubagents } from "./use-chat-composer-subagents";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(QueryProvider, { useIsolatedClient: true }, children);

const EMPTY_CATALOG: AgentSubagentCatalog = { subagents: [] };

const sessionRuntime: ChatComposerPromptInputRuntime = {
  state: "available",
  scope: "session",
  runtimeRef: {
    repoPath: "/repo",
    runtimeKind: "opencode",
    workingDirectory: "/repo/worktree",
  },
};

describe("useChatComposerSubagents", () => {
  test("surfaces session-scoped runtime context errors without querying subagents", async () => {
    const loadSubagentsForRepo = mock(async () => EMPTY_CATALOG);
    const harness = createHookHarness(
      useChatComposerSubagents,
      {
        promptInputRuntime: {
          state: "unavailable",
          runtimeKind: "opencode",
          error: "Selected session runtime context is missing working directory.",
        },
        supportsSubagentReferences: true,
        loadSubagentsForRepo,
      },
      { wrapper },
    );

    try {
      await harness.mount();

      expect(loadSubagentsForRepo).not.toHaveBeenCalled();
      expect(harness.getLatest().subagents).toEqual([]);
      expect(harness.getLatest().subagentsError).toBe(
        "Selected session runtime context is missing working directory.",
      );
    } finally {
      await harness.unmount();
    }
  });

  test("reads session-scoped subagents using the session working directory", async () => {
    const catalog: AgentSubagentCatalog = {
      subagents: [
        {
          id: "reviewer",
          name: "reviewer",
          label: "Reviewer",
        },
      ],
    };
    const loadSubagentsForRepo = mock(async () => catalog);
    const harness = createHookHarness(
      useChatComposerSubagents,
      {
        promptInputRuntime: sessionRuntime,
        supportsSubagentReferences: true,
        loadSubagentsForRepo,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.subagents.length === 1);

      expect(loadSubagentsForRepo).toHaveBeenCalledWith({
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
      });
      expect(harness.getLatest().subagents).toEqual(catalog.subagents);
    } finally {
      await harness.unmount();
    }
  });
});
