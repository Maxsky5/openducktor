import { describe, expect, test } from "bun:test";
import { MANUAL_SESSION_COMPACTION_SLASH_COMMAND } from "@openducktor/contracts";
import {
  toAntigravitySkillCatalog,
  toAntigravitySlashCommandCatalog,
} from "./antigravity-session-updates";

const catalog = toAntigravitySlashCommandCatalog({
  sessionUpdate: "available_commands_update",
  availableCommands: [
    { name: "compact", description: "Compact the conversation now." },
    { name: "goal", description: "Run until the goal is finished." },
    { name: "clean-code", description: "Pragmatic coding standards." },
    { name: "clean-code", description: "A second skill with the same name." },
  ],
});

describe("Antigravity command list", () => {
  test("shows /compact as the session compaction and marks the skills", () => {
    expect(catalog.commands).toEqual([
      MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
      {
        id: "antigravity:goal",
        trigger: "goal",
        title: "/goal",
        source: "command",
        hints: [],
        description: "Run until the goal is finished.",
      },
      {
        id: "antigravity:clean-code",
        trigger: "clean-code",
        title: "/clean-code",
        source: "skill",
        hints: [],
        description: "Pragmatic coding standards.",
      },
    ]);
  });

  test("lists the skills of the command list", () => {
    expect(toAntigravitySkillCatalog(catalog)).toEqual({
      skills: [
        {
          id: "clean-code",
          name: "clean-code",
          path: "clean-code",
          title: "clean-code",
          description: "Pragmatic coding standards.",
        },
      ],
    });
  });
});
