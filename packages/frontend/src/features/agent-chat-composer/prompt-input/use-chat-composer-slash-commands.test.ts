import { describe, expect, test } from "bun:test";
import { MANUAL_SESSION_COMPACTION_SLASH_COMMAND } from "@openducktor/contracts";
import type { AgentSlashCommand } from "@openducktor/core";
import {
  filterSlashCommandsForComposerScope,
  mergeSlashCommands,
} from "./use-chat-composer-slash-commands";

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
    ).toEqual(["runtime-compact", "prompt-review"]);
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

  test("removes system commands from unsupported session runtimes", () => {
    expect(
      filterSlashCommandsForComposerScope(
        [
          MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
          { id: "review", trigger: "review", title: "Review", hints: [] },
        ],
        "session",
        "third-party" as never,
      ).map((command) => command.id),
    ).toEqual(["review"]);
  });
});
