import { describe, expect, test } from "bun:test";
import type { AgentSlashCommand } from "@openducktor/core";
import { mergeSlashCommands } from "./use-chat-composer-slash-commands";

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
});
