import { describe, expect, mock, test } from "bun:test";
import {
  MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
  type ReusablePrompt,
} from "@openducktor/contracts";
import type { AgentSlashCommand, ListAgentRuntimeCatalogInput } from "@openducktor/core";
import { createElement, type PropsWithChildren } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { enableReactActEnvironment } from "@/test-utils/react-act-environment";
import { createRuntimeCatalogFixture } from "@/test-utils/shared-test-fixtures";
import type { ChatComposerPromptInputRuntime } from "./chat-composer-prompt-input-runtime";
import {
  filterSlashCommandsForComposerScope,
  mergeSlashCommands,
  useChatComposerSlashCommands,
} from "./use-chat-composer-slash-commands";

enableReactActEnvironment();

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(QueryProvider, { useIsolatedClient: true }, children);

const sessionRuntime: ChatComposerPromptInputRuntime = {
  state: "available",
  scope: "session",
  runtimeRef: {
    repoPath: "/repo",
    runtimeKind: "opencode",
    workingDirectory: "/repo/worktree",
  },
};

const reusablePromptFixture: ReusablePrompt = {
  id: "prompt-1",
  name: "review",
  description: "Review files",
  content: "Review this: $ARGUMENTS",
};

describe("use-chat-composer-slash-commands", () => {
  test("gives reusable prompt slash commands precedence case-insensitively", () => {
    const runtimeCommands: AgentSlashCommand[] = [
      { id: "runtime-review", trigger: "Review", title: "Runtime review", hints: [] },
      { id: "runtime-compact", trigger: "compact", title: "Runtime compact", hints: [] },
    ];
    const reusableCommands: AgentSlashCommand[] = [
      { id: "prompt-review", trigger: "review", title: "Prompt review", hints: [] },
    ];

    expect(
      mergeSlashCommands(runtimeCommands, reusableCommands).map((command) => command.id),
    ).toEqual(["prompt-review"]);
  });

  test("reserves compact for the system command while preserving other prompt precedence", () => {
    const runtimeCommands: AgentSlashCommand[] = [
      MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
      { id: "runtime-review", trigger: "review", title: "Runtime review", hints: [] },
    ];
    const reusableCommands: AgentSlashCommand[] = [
      { id: "prompt-compact", trigger: "COMPACT", title: "Prompt compact", hints: [] },
      { id: "prompt-review", trigger: "review", title: "Prompt review", hints: [] },
    ];

    expect(
      mergeSlashCommands(runtimeCommands, reusableCommands).map((command) => command.id),
    ).toEqual(["system:compact", "prompt-review"]);
  });

  test("removes system commands from repository-scoped composers", () => {
    expect(
      filterSlashCommandsForComposerScope(
        [
          MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
          { id: "review", trigger: "review", title: "Review", hints: [] },
        ],
        "repo",
        "opencode",
      ).map((command) => command.id),
    ).toEqual(["review"]);
  });

  test("keeps system commands in Codex session composers", () => {
    expect(
      filterSlashCommandsForComposerScope(
        [MANUAL_SESSION_COMPACTION_SLASH_COMMAND],
        "session",
        "codex",
      ),
    ).toEqual([MANUAL_SESSION_COMPACTION_SLASH_COMMAND]);
  });

  test("keeps system commands in Claude session composers", () => {
    expect(
      filterSlashCommandsForComposerScope(
        [MANUAL_SESSION_COMPACTION_SLASH_COMMAND],
        "session",
        "claude",
      ),
    ).toEqual([MANUAL_SESSION_COMPACTION_SLASH_COMMAND]);
  });

  test("removes system commands from Codex repository composers", () => {
    expect(
      filterSlashCommandsForComposerScope(
        [MANUAL_SESSION_COMPACTION_SLASH_COMMAND],
        "repo",
        "codex",
      ),
    ).toEqual([]);
  });

  test("keeps compact reserved when repository scope hides the system command", () => {
    const mergedCommands = mergeSlashCommands(
      [MANUAL_SESSION_COMPACTION_SLASH_COMMAND],
      [
        {
          id: "reusable-prompt:compact",
          trigger: "COMPACT",
          title: "Custom compact",
          source: "custom",
          hints: [],
        },
      ],
    );

    expect(filterSlashCommandsForComposerScope(mergedCommands, "repo", "opencode")).toEqual([]);
  });

  test("keeps runtime commands alongside compact in Claude session composers", () => {
    expect(
      filterSlashCommandsForComposerScope(
        [
          MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
          { id: "review", trigger: "review", title: "Review", hints: [] },
        ],
        "session",
        "claude",
      ).map((command) => command.id),
    ).toEqual(["system:compact", "review"]);
  });
});

describe("useChatComposerSlashCommands", () => {
  test("keeps reusable prompt commands without querying an unsupported runtime", async () => {
    const loadRuntimeCatalog = mock(async () => createRuntimeCatalogFixture());
    const harness = createHookHarness(
      useChatComposerSlashCommands,
      {
        promptInputRuntime: sessionRuntime,
        runtimeSupportsSlashCommands: false,
        reusablePrompts: [reusablePromptFixture],
        loadRuntimeCatalog,
      },
      { wrapper },
    );

    try {
      await harness.mount();

      expect(loadRuntimeCatalog).not.toHaveBeenCalled();
      expect(harness.getLatest()).toEqual(
        expect.objectContaining({
          supportsSlashCommands: true,
          slashCommandsError: null,
          isSlashCommandsLoading: false,
        }),
      );
      expect(harness.getLatest().slashCommands.map((command) => command.trigger)).toEqual([
        "review",
      ]);
    } finally {
      await harness.unmount();
    }
  });

  test("reads repo slash commands from a supported runtime", async () => {
    const runtimeCommand: AgentSlashCommand = {
      id: "runtime-review",
      trigger: "runtime-review",
      title: "Runtime review",
      hints: [],
    };
    const loadRuntimeCatalog = mock(async () =>
      createRuntimeCatalogFixture({ slashCommands: { commands: [runtimeCommand] } }),
    );
    const harness = createHookHarness(
      useChatComposerSlashCommands,
      {
        promptInputRuntime: sessionRuntime,
        runtimeSupportsSlashCommands: true,
        reusablePrompts: [],
        loadRuntimeCatalog,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.slashCommands.length === 1);

      expect(loadRuntimeCatalog).toHaveBeenCalledWith(sessionRuntime.runtimeRef);
      expect(harness.getLatest().slashCommands).toEqual([runtimeCommand]);
      expect(harness.getLatest().slashCommandsError).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("retries only the slash command surface after a failed read", async () => {
    const runtimeCommand: AgentSlashCommand = {
      id: "runtime-review",
      trigger: "runtime-review",
      title: "Runtime review",
      hints: [],
    };
    let attempts = 0;
    const loadRuntimeCatalog = mock(async (_input: ListAgentRuntimeCatalogInput) => {
      attempts += 1;
      return attempts === 1
        ? { slashCommands: { status: "failed" as const, message: "Slash command list offline." } }
        : createRuntimeCatalogFixture({ slashCommands: { commands: [runtimeCommand] } });
    });
    const harness = createHookHarness(
      useChatComposerSlashCommands,
      {
        promptInputRuntime: sessionRuntime,
        runtimeSupportsSlashCommands: true,
        reusablePrompts: [],
        loadRuntimeCatalog,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.slashCommandsError === "Slash command list offline.");
      expect(harness.getLatest().retrySlashCommands).not.toBeNull();

      await harness.run((state) => state.retrySlashCommands?.());
      await harness.waitFor((state) => state.slashCommands.length === 1);

      expect(loadRuntimeCatalog).toHaveBeenCalledTimes(2);
      expect(loadRuntimeCatalog.mock.calls[1]).toEqual([
        { ...sessionRuntime.runtimeRef, surfaces: ["slashCommands"] },
      ]);
      expect(harness.getLatest().slashCommandsError).toBeNull();
    } finally {
      await harness.unmount();
    }
  });
});
