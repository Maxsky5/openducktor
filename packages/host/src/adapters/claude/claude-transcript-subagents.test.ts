import { expect, test } from "bun:test";
import { appendFile, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { loadClaudeHistory } from "./claude-agent-sdk-history-loader";
import type { ClaudeProtocolObject } from "./claude-agent-sdk-ingress-schemas";

const cases: Array<{
  name: string;
  result: boolean;
  sidecar: boolean;
  background: boolean;
  parentRetracted?: boolean;
  child: "final" | "text" | "user" | "missing" | "trailing" | "retracted" | "malformed" | "foreign";
  expected: "completed" | "cancelled" | "running" | "read-error";
}> = [
  {
    name: "raw child correlation without a parent result",
    result: false,
    sidecar: false,
    background: false,
    child: "final",
    expected: "completed",
  },
  {
    name: "sidecar correlation without a parent result",
    result: false,
    sidecar: true,
    background: false,
    child: "final",
    expected: "completed",
  },
  {
    name: "completed background child after a running result",
    result: true,
    sidecar: false,
    background: true,
    child: "final",
    expected: "completed",
  },
  {
    name: "foreground final text without a stop reason",
    result: true,
    sidecar: false,
    background: false,
    child: "text",
    expected: "completed",
  },
  {
    name: "interrupted foreground child",
    result: true,
    sidecar: false,
    background: false,
    child: "user",
    expected: "cancelled",
  },
  {
    name: "unfinished background child",
    result: true,
    sidecar: false,
    background: true,
    child: "user",
    expected: "running",
  },
  {
    name: "missing foreground child",
    result: true,
    sidecar: false,
    background: false,
    child: "missing",
    expected: "cancelled",
  },
  {
    name: "partial trailing child record",
    result: true,
    sidecar: false,
    background: false,
    child: "trailing",
    expected: "completed",
  },
  {
    name: "retracted child final answer",
    result: true,
    sidecar: false,
    background: false,
    child: "retracted",
    expected: "cancelled",
  },
  {
    name: "malformed related child",
    result: true,
    sidecar: false,
    background: false,
    child: "malformed",
    expected: "read-error",
  },
  {
    name: "child with another session ID",
    result: true,
    sidecar: false,
    background: false,
    child: "foreign",
    expected: "read-error",
  },
  {
    name: "retracted parent final answer",
    result: true,
    sidecar: false,
    background: false,
    child: "user",
    parentRetracted: true,
    expected: "running",
  },
];

test.each(cases)("restores saved subagent state for $name", async (scenario) => {
  const temporary = await mkdtemp(join(tmpdir(), "claude-saved-subagent-"));
  try {
    const cwd = await realpath(temporary);
    const sessionId = "00000000-0000-4000-8000-000000000001";
    const config = join(cwd, "config");
    const project = join(config, "projects", "fixture");
    const directory = join(project, sessionId, "subagents");
    await mkdir(directory, { recursive: true });
    const timestamp = "2026-10-21T10:00:00.000Z";
    const base = { sessionId, cwd, timestamp };
    const user: ClaudeProtocolObject = {
      ...base,
      type: "user",
      uuid: "user",
      parentUuid: null,
      message: { role: "user", content: "Inspect the source" },
    };
    const call: ClaudeProtocolObject = {
      ...base,
      type: "assistant",
      uuid: "call-message",
      parentUuid: "user",
      message: {
        id: "call-message",
        role: "assistant",
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "agent-call",
            name: "Agent",
            input: {
              description: "Inspect source",
              subagent_type: "Explore",
              prompt: "Inspect source",
              run_in_background: scenario.background,
            },
          },
        ],
      },
    };
    const result: ClaudeProtocolObject = {
      ...base,
      type: "user",
      uuid: "result",
      parentUuid: "call-message",
      toolUseResult: { agentId: "child", status: "running" },
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "agent-call", content: "Started child" }],
      },
    };
    const final: ClaudeProtocolObject = {
      ...base,
      type: "assistant",
      uuid: "final",
      parentUuid: scenario.result ? "result" : "call-message",
      message: {
        id: "final",
        role: "assistant",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Parent done" }],
      },
    };
    const writeRows = (path: string, rows: ClaudeProtocolObject[]) =>
      writeFile(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
    await writeRows(join(project, `${sessionId}.jsonl`), [
      user,
      call,
      ...(scenario.result ? [result] : []),
      final,
      ...(scenario.parentRetracted
        ? [
            {
              ...base,
              type: "system",
              uuid: "parent-retraction",
              parentUuid: "final",
              subtype: "model_refusal_fallback",
              retracted_message_uuids: ["final"],
            },
          ]
        : []),
    ]);
    if (scenario.child !== "missing") {
      const correlation = scenario.sidecar ? {} : { parent_tool_use_id: "agent-call" };
      const childUser: ClaudeProtocolObject = {
        ...user,
        ...correlation,
        uuid: "child-user",
        isSidechain: true,
      };
      const childFinal: ClaudeProtocolObject = {
        ...final,
        ...correlation,
        uuid: "child-final",
        parentUuid: "child-user",
        isSidechain: true,
        message: {
          id: "child-final",
          role: "assistant",
          stop_reason: scenario.child === "text" ? null : "end_turn",
          content: [{ type: "text", text: "Child done" }],
        },
      };
      const childPath = join(directory, "agent-child.jsonl");
      await writeRows(childPath, [
        childUser,
        ...(scenario.child === "user" ? [] : [childFinal]),
        ...(scenario.child === "retracted"
          ? [
              {
                ...base,
                type: "system",
                uuid: "retraction",
                parentUuid: "child-final",
                isSidechain: true,
                subtype: "model_refusal_fallback",
                retracted_message_uuids: ["child-final"],
              },
            ]
          : []),
        ...(scenario.child === "foreign"
          ? [{ ...childFinal, sessionId: "00000000-0000-4000-8000-000000000099" }]
          : []),
      ]);
      if (scenario.child === "trailing")
        await appendFile(childPath, '{"type":"assistant","message":');
      if (scenario.child === "malformed") await appendFile(childPath, "not-json\n");
      if (scenario.sidecar)
        await writeFile(
          join(directory, "agent-child.meta.json"),
          JSON.stringify({ toolUseId: "agent-call" }),
        );
    }
    const load = Effect.runPromise(
      loadClaudeHistory(
        {
          repoPath: cwd,
          workingDirectory: cwd,
          externalSessionId: sessionId,
          runtimeKind: "claude",
          runtimePolicy: { kind: "claude" },
        },
        () => timestamp,
        undefined,
        { processEnv: { CLAUDE_CONFIG_DIR: config } },
      ),
    );
    if (scenario.expected === "read-error") {
      await expect(load).rejects.toMatchObject(
        scenario.child === "foreign"
          ? { code: "scope_mismatch" }
          : { operation: "claude.transcript.parse" },
      );
      return;
    }
    const history = await load;
    expect(
      history.flatMap((message) => message.parts).filter((part) => part.kind === "subagent"),
    ).toEqual([
      expect.objectContaining({
        externalSessionId: `${sessionId}::claude-subagent::child`,
        status: scenario.expected,
      }),
    ]);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test.each(["Agent", "Task"])(
  "keeps Monitor task results separate from a readable %s child",
  async (agentTool) => {
    const temporary = await mkdtemp(join(tmpdir(), "claude-monitor-correlation-"));
    try {
      const cwd = await realpath(temporary);
      const sessionId = "00000000-0000-4000-8000-000000000001";
      const config = join(cwd, "config");
      const project = join(config, "projects", "fixture");
      const directory = join(project, sessionId, "subagents");
      await mkdir(directory, { recursive: true });
      const timestamp = "2026-10-21T10:00:00.000Z";
      const row = (
        uuid: string,
        parentUuid: string | null,
        type: "assistant" | "user",
        content: string | ClaudeProtocolObject[],
        extra: ClaudeProtocolObject = {},
      ): ClaudeProtocolObject => ({
        sessionId,
        cwd,
        timestamp,
        type,
        uuid,
        parentUuid,
        message: { id: uuid, role: type, content },
        ...extra,
      });
      const writeRows = (path: string, rows: ClaudeProtocolObject[]) =>
        writeFile(path, `${rows.map((record) => JSON.stringify(record)).join("\n")}\n`);
      await writeRows(join(project, `${sessionId}.jsonl`), [
        row("user", null, "user", "Inspect source"),
        row("monitor-call", "user", "assistant", [
          { type: "tool_use", id: "monitor-call", name: "Monitor", input: { command: "watch" } },
        ]),
        row(
          "monitor-result",
          "monitor-call",
          "user",
          [{ type: "tool_result", tool_use_id: "monitor-call", content: "Monitor started" }],
          { toolUseResult: { taskId: "monitor-task", status: "running" } },
        ),
        row(
          "monitor-notification",
          "monitor-result",
          "user",
          `<task-notification>
<task-id>monitor-task</task-id>
<tool-use-id>monitor-call</tool-use-id>
<status>completed</status>
<summary>Monitor completed</summary>
</task-notification>`,
        ),
        row("agent-call", "monitor-notification", "assistant", [
          {
            type: "tool_use",
            id: "agent-call",
            name: agentTool,
            input: { description: "Inspect source", run_in_background: true },
          },
        ]),
        row(
          "agent-result",
          "agent-call",
          "user",
          [{ type: "tool_result", tool_use_id: "agent-call", content: "Agent started" }],
          { toolUseResult: { agentId: "child", status: "running" } },
        ),
        row(
          "agent-notification",
          "agent-result",
          "user",
          `<task-notification>
<task-id>child</task-id>
<status>completed</status>
<summary>Child completed</summary>
</task-notification>`,
        ),
      ]);
      await writeRows(join(directory, "agent-child.jsonl"), [
        row("child-user", null, "user", "Inspect source", {
          isSidechain: true,
          parent_tool_use_id: "agent-call",
        }),
        row("child-final", "child-user", "assistant", [{ type: "text", text: "Child done" }], {
          isSidechain: true,
          parent_tool_use_id: "agent-call",
        }),
      ]);
      const input = {
        repoPath: cwd,
        workingDirectory: cwd,
        externalSessionId: sessionId,
        runtimeKind: "claude" as const,
        runtimePolicy: { kind: "claude" as const },
      };
      const options = { processEnv: { CLAUDE_CONFIG_DIR: config } };
      const history = await Effect.runPromise(
        loadClaudeHistory(input, () => timestamp, undefined, options),
      );
      const parts = history.flatMap((message) => message.parts);
      const children = parts.filter((part) => part.kind === "subagent");
      expect(children).toEqual([
        expect.objectContaining({
          correlationKey: "agent-call",
          externalSessionId: `${sessionId}::claude-subagent::child`,
          status: "completed",
        }),
      ]);
      expect(
        parts.find((part) => part.kind === "tool" && part.callId === "monitor-call"),
      ).toMatchObject({
        tool: "Monitor",
        status: "completed",
        output: expect.stringContaining("Monitor completed"),
      });
      for (const child of children) {
        expect(child.externalSessionId).toBeDefined();
        const childHistory = await Effect.runPromise(
          loadClaudeHistory(
            { ...input, externalSessionId: child.externalSessionId! },
            () => timestamp,
            undefined,
            options,
          ),
        );
        expect(childHistory.some((message) => message.text === "Child done")).toBe(true);
      }
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  },
);
