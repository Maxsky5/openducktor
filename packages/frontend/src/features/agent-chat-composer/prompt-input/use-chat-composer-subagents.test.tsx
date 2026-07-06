import { describe, expect, mock, test } from "bun:test";
import type { AgentSubagentCatalog } from "@openducktor/core";
import { createElement, type PropsWithChildren } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import type { ChatComposerPromptInputRuntime } from "./chat-composer-prompt-input-runtime";
import { useChatComposerSubagents } from "./use-chat-composer-subagents";

enableReactActEnvironment();

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
  test("does not query when subagent references are unsupported", async () => {
    const loadSubagentsForRepo = mock(async () => ({
      subagents: [
        {
          id: "reviewer",
          name: "reviewer",
        },
      ],
    }));
    const harness = createHookHarness(
      useChatComposerSubagents,
      {
        promptInputRuntime: sessionRuntime,
        supportsSubagentReferences: false,
        loadSubagentsForRepo,
      },
      { wrapper },
    );

    try {
      await harness.mount();

      expect(loadSubagentsForRepo).not.toHaveBeenCalled();
      expect(harness.getLatest()).toMatchObject({
        subagentCatalog: EMPTY_CATALOG,
        subagents: [],
        subagentsError: null,
        isSubagentsLoading: false,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("keeps waiting runtimes silent until a runtime ref is available", async () => {
    const loadSubagentsForRepo = mock(async () => EMPTY_CATALOG);
    const harness = createHookHarness(
      useChatComposerSubagents,
      {
        promptInputRuntime: {
          state: "waiting",
          runtimeKind: "opencode",
          message: "File search is unavailable until the runtime is ready.",
        },
        supportsSubagentReferences: true,
        loadSubagentsForRepo,
      },
      { wrapper },
    );

    try {
      await harness.mount();

      expect(loadSubagentsForRepo).not.toHaveBeenCalled();
      expect(harness.getLatest()).toMatchObject({
        subagentCatalog: EMPTY_CATALOG,
        subagents: [],
        subagentsError: null,
        isSubagentsLoading: false,
      });
    } finally {
      await harness.unmount();
    }
  });

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
