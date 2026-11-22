import "../../../test-support/dom-environment";
import { describe, expect, mock, test } from "bun:test";
import {
  GOAL_SLASH_COMMAND,
  MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
  type ReusablePrompt,
} from "@openducktor/contracts";
import type { AgentSlashCommand, LoadAgentRuntimeCatalogInput } from "@openducktor/core";
import { IsolatedRuntimeQueryWrapper } from "../../../test-support/isolated-runtime-query-wrapper";
import { createHookHarness } from "../../../test-support/react-hook-harness";
import { enableReactActEnvironment } from "../../../test-support/react-act-environment";
import { createRuntimeCatalogFixture } from "../../../test-support/shared-test-fixtures";
import type { ChatComposerPromptInputRuntime } from "./chat-composer-prompt-input-runtime";
import {
  filterSlashCommandsForComposerScope,
  mergeSlashCommands,
  useChatComposerSlashCommands,
} from "./use-chat-composer-slash-commands";

enableReactActEnvironment();

const wrapper = IsolatedRuntimeQueryWrapper;

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

  test("lists /goal first and hides every other command named goal", () => {
    const goal = { ...GOAL_SLASH_COMMAND, hints: [...GOAL_SLASH_COMMAND.hints] };
    const runtimeCommands: AgentSlashCommand[] = [
      MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
      { id: "runtime-goal", trigger: "goal", title: "Runtime goal", hints: [] },
      { id: "runtime-review", trigger: "review", title: "Runtime review", hints: [] },
    ];
    const reusableCommands: AgentSlashCommand[] = [
      { id: "prompt-goal", trigger: "GOAL", title: "Prompt goal", hints: [] },
    ];

    expect(
      mergeSlashCommands(runtimeCommands, reusableCommands, [goal]).map((command) => command.id),
    ).toEqual(["system:compact", "system:goal", "runtime-review"]);
    expect(
      mergeSlashCommands(runtimeCommands, reusableCommands).map((command) => command.id),
    ).toEqual(["system:compact", "runtime-review"]);
  });

  test("keeps the native /goal and /compact of a runtime that OpenDucktor runs neither for", () => {
    const runtimeCommands: AgentSlashCommand[] = [
      { id: "antigravity:goal", trigger: "goal", title: "/goal", source: "command", hints: [] },
      { id: "antigravity:compact", trigger: "compact", title: "/compact", hints: [] },
    ];
    const reusableCommands: AgentSlashCommand[] = [
      { id: "prompt-goal", trigger: "goal", title: "Prompt goal", source: "custom", hints: [] },
    ];

    expect(
      mergeSlashCommands(runtimeCommands, reusableCommands, [], new Set()).map(({ id }) => id),
    ).toEqual(["antigravity:goal", "antigravity:compact"]);
  });

  test("keeps the native /goal of a runtime that OpenDucktor runs only /compact for", () => {
    const runtimeCommands: AgentSlashCommand[] = [
      MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
      { id: "runtime:goal", trigger: "goal", title: "/goal", source: "command", hints: [] },
      { id: "runtime:compact", trigger: "compact", title: "/compact", hints: [] },
    ];

    expect(
      mergeSlashCommands(runtimeCommands, [], [], new Set(["compact"])).map(({ id }) => id),
    ).toEqual(["system:compact", "runtime:goal"]);
  });

  test("removes system commands from repository-scoped composers", () => {
    expect(
      filterSlashCommandsForComposerScope(
        [
          MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
          { id: "review", trigger: "review", title: "Review", hints: [] },
        ],
        "repo",
      ).map((command) => command.id),
    ).toEqual(["review"]);
  });

  test("keeps system commands in Codex session composers", () => {
    expect(
      filterSlashCommandsForComposerScope([MANUAL_SESSION_COMPACTION_SLASH_COMMAND], "session"),
    ).toEqual([MANUAL_SESSION_COMPACTION_SLASH_COMMAND]);
  });

  test("keeps system commands in Claude session composers", () => {
    expect(
      filterSlashCommandsForComposerScope([MANUAL_SESSION_COMPACTION_SLASH_COMMAND], "session"),
    ).toEqual([MANUAL_SESSION_COMPACTION_SLASH_COMMAND]);
  });

  test("removes system commands from Codex repository composers", () => {
    expect(
      filterSlashCommandsForComposerScope([MANUAL_SESSION_COMPACTION_SLASH_COMMAND], "repo"),
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

    expect(filterSlashCommandsForComposerScope(mergedCommands, "repo")).toEqual([]);
  });

  test("keeps runtime commands alongside compact in Claude session composers", () => {
    expect(
      filterSlashCommandsForComposerScope(
        [
          MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
          { id: "review", trigger: "review", title: "Review", hints: [] },
        ],
        "session",
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
        goalsAvailable: false,
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

  test.each([
    ["opencode", ["<objective> | pause | resume | clear"]],
    ["antigravity", ["<objective> | clear"]],
  ] as const)(
    "lists /goal with the %s goal actions in a session composer",
    async (runtimeKind, hints) => {
      const harness = createHookHarness(
        useChatComposerSlashCommands,
        {
          promptInputRuntime: {
            ...sessionRuntime,
            runtimeRef: { ...sessionRuntime.runtimeRef, runtimeKind },
          },
          runtimeSupportsSlashCommands: false,
          reusablePrompts: [],
          loadRuntimeCatalog: mock(async () => createRuntimeCatalogFixture()),
          goalsAvailable: true,
        },
        { wrapper },
      );

      try {
        await harness.mount();
        expect(harness.getLatest().supportsSlashCommands).toBe(true);
        expect(harness.getLatest().slashCommands.map((command) => command.id)).toEqual([
          "system:goal",
        ]);
        // A runtime without pause and resume offers only the actions that it can run.
        expect(harness.getLatest().slashCommands[0]?.hints).toEqual([...hints]);
      } finally {
        await harness.unmount();
      }
    },
  );

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
        goalsAvailable: false,
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

  test("retries the combined catalog after a failed read", async () => {
    const runtimeCommand: AgentSlashCommand = {
      id: "runtime-review",
      trigger: "runtime-review",
      title: "Runtime review",
      hints: [],
    };
    let attempts = 0;
    const loadRuntimeCatalog = mock(async (_input: LoadAgentRuntimeCatalogInput) => {
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
        goalsAvailable: false,
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
      expect(loadRuntimeCatalog.mock.calls[1]).toEqual([sessionRuntime.runtimeRef]);
      expect(harness.getLatest().slashCommandsError).toBeNull();
    } finally {
      await harness.unmount();
    }
  });
});
