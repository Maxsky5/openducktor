import { describe, expect, test } from "bun:test";
import { MANUAL_SESSION_COMPACTION_SLASH_COMMAND } from "@openducktor/contracts";
import type { AgentUserMessagePart } from "../types/agent-orchestrator";
import { classifySystemSlashCommandInvocation } from "./agent-system-slash-commands";

const compactPart = (): AgentUserMessagePart => ({
  kind: "slash_command",
  command: { ...MANUAL_SESSION_COMPACTION_SLASH_COMMAND },
});

describe("classifySystemSlashCommandInvocation", () => {
  test("accepts only the canonical command surrounded by whitespace", () => {
    expect(
      classifySystemSlashCommandInvocation([
        { kind: "text", text: "  " },
        compactPart(),
        { kind: "text", text: "\n" },
      ]),
    ).toEqual({ kind: "manual_session_compaction" });
  });

  test("returns unrelated for ordinary messages and slash commands", () => {
    expect(classifySystemSlashCommandInvocation([{ kind: "text", text: "hello" }])).toEqual({
      kind: "not_system",
    });
    expect(
      classifySystemSlashCommandInvocation([
        {
          kind: "slash_command",
          command: { id: "review", trigger: "review", title: "Review", hints: [] },
        },
      ]),
    ).toEqual({ kind: "not_system" });
  });

  test.each([
    {
      ...MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
      id: "custom:compact",
      source: "custom" as const,
    },
    {
      ...MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
      trigger: "other",
    },
    {
      id: "custom:other",
      trigger: "other",
      title: "Other",
      description: "Other command",
      source: "system" as const,
      hints: [],
    },
  ])("rejects reserved system identity lookalike %#", (command) => {
    expect(() =>
      classifySystemSlashCommandInvocation([{ kind: "slash_command", command }]),
    ).toThrow("reserved system slash command");
  });

  test.each([
    { kind: "text", text: "explain" },
    { kind: "file_reference", file: { id: "f", path: "a.ts", name: "a.ts", kind: "code" } },
    { kind: "skill_mention", skill: { id: "s", name: "s", description: "skill" } },
    {
      kind: "subagent_reference",
      subagent: { id: "a", name: "a", label: "Agent" },
    },
    {
      kind: "attachment",
      attachment: { id: "a", path: "a.png", name: "a.png", kind: "image" },
    },
    compactPart(),
  ] as AgentUserMessagePart[])("rejects unsupported additional part %#", (additionalPart) => {
    expect(() => classifySystemSlashCommandInvocation([compactPart(), additionalPart])).toThrow(
      "must be sent without arguments or references",
    );
  });
});
