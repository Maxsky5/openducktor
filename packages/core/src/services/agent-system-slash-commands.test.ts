import { describe, expect, test } from "bun:test";
import {
  AGENT_SESSION_GOAL_OBJECTIVE_MAX_LENGTH,
  GOAL_SLASH_COMMAND,
  MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
} from "@openducktor/contracts";
import type { AgentUserMessagePart } from "../types/agent-orchestrator";
import {
  classifySystemSlashCommandInvocation,
  GOAL_COMMAND_MISSING_OBJECTIVE_MESSAGE,
} from "./agent-system-slash-commands";

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
  ])("rejects reserved system identity lookalike %#", (command) => {
    expect(() =>
      classifySystemSlashCommandInvocation([{ kind: "slash_command", command }]),
    ).toThrow("reserved system slash command");
  });

  test("leaves unrelated system commands for their own handlers", () => {
    expect(
      classifySystemSlashCommandInvocation([
        {
          kind: "slash_command",
          command: {
            id: "system:other",
            trigger: "other",
            title: "Other",
            source: "system",
            hints: [],
          },
        },
      ]),
    ).toEqual({ kind: "not_system" });
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
  ] satisfies AgentUserMessagePart[])(
    "rejects unsupported additional part %#",
    (additionalPart) => {
      expect(() => classifySystemSlashCommandInvocation([compactPart(), additionalPart])).toThrow(
        "must be sent without arguments or references",
      );
    },
  );
});

describe("classifySystemSlashCommandInvocation for /goal", () => {
  const goalPart = (): AgentUserMessagePart => ({
    kind: "slash_command",
    command: { ...GOAL_SLASH_COMMAND, hints: [...GOAL_SLASH_COMMAND.hints] },
  });
  const goal = (text: string) =>
    classifySystemSlashCommandInvocation([goalPart(), { kind: "text", text }]);

  test("reads the objective after the command", () => {
    expect(goal("  Fix the flaky tests\nand keep CI green ")).toEqual({
      kind: "goal",
      command: { kind: "set", objective: "Fix the flaky tests\nand keep CI green" },
    });
  });

  test.each(["pause", "resume", "clear", " Clear "])("reads the %p keyword", (keyword) => {
    expect(goal(keyword)).toEqual({
      kind: "goal",
      command: { kind: keyword.trim().toLowerCase() },
    });
  });

  test("rejects a bare command", () => {
    expect(() => classifySystemSlashCommandInvocation([goalPart()])).toThrow(
      GOAL_COMMAND_MISSING_OBJECTIVE_MESSAGE,
    );
  });

  test("rejects an objective over the limit", () => {
    expect(() => goal("x".repeat(AGENT_SESSION_GOAL_OBJECTIVE_MAX_LENGTH + 1))).toThrow(
      "at most 4000 characters",
    );
    expect(goal("x".repeat(AGENT_SESSION_GOAL_OBJECTIVE_MAX_LENGTH))).toMatchObject({
      command: { kind: "set" },
    });
  });

  test.each([
    { kind: "file_reference", file: { id: "f", path: "a.ts", name: "a.ts", kind: "code" } },
    { kind: "skill_mention", skill: { id: "s", name: "s", description: "skill" } },
    {
      kind: "attachment",
      attachment: { id: "a", path: "a.png", name: "a.png", kind: "image" },
    },
  ] satisfies AgentUserMessagePart[])("rejects a non-text part %#", (part) => {
    expect(() =>
      classifySystemSlashCommandInvocation([goalPart(), { kind: "text", text: "Ship " }, part]),
    ).toThrow("accepts text only");
  });

  test("rejects text before the command", () => {
    expect(() =>
      classifySystemSlashCommandInvocation([{ kind: "text", text: "please" }, goalPart()]),
    ).toThrow("Start the message with /goal");
  });

  test("rejects a runtime command named goal", () => {
    expect(() =>
      classifySystemSlashCommandInvocation([
        {
          kind: "slash_command",
          command: { id: "goal", trigger: "goal", title: "Goal", source: "command", hints: [] },
        },
        { kind: "text", text: "ship it" },
      ]),
    ).toThrow("/goal is a reserved system slash command.");
  });
});
