import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { loadClaudeHistory } from "./claude-agent-sdk-history-loader";
import { claudeSubagentExternalSessionId } from "./claude-agent-sdk-subagent-transcripts";

test.each(["memory", "disk"] as const)(
  "keeps the first child prompt and tool results from mixed user blocks with %s storage",
  async (storage) => {
    const root = await mkdtemp(join(tmpdir(), "claude-history-mixed-user-"));
    try {
      const workingDirectory = await realpath(root);
      const sessionId = "00000000-0000-4000-8000-000000000001";
      const config = join(workingDirectory, "config");
      const project = join(config, "projects", "test-project");
      const children = join(project, sessionId, "subagents");
      await mkdir(children, { recursive: true });
      const base = { sessionId, cwd: workingDirectory, timestamp: "2026-10-21T10:00:00.000Z" };
      await writeFile(
        join(project, `${sessionId}.jsonl`),
        JSON.stringify({
          ...base,
          type: "user",
          uuid: "root-user",
          parentUuid: null,
          message: { role: "user", content: "Inspect callback routing." },
        }) + "\n",
      );
      const childBase = { ...base, isSidechain: true, parent_tool_use_id: "parent-agent-call" };
      const records = [
        {
          ...childBase,
          type: "assistant",
          uuid: "setup-tool",
          parentUuid: null,
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "setup-call",
                name: "Read",
                input: { file_path: "setup.ts" },
              },
            ],
            stop_reason: "tool_use",
          },
        },
        {
          ...childBase,
          type: "user",
          uuid: "first-prompt",
          parentUuid: "setup-tool",
          message: {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: "setup-call", content: "Setup source" },
              { type: "text", text: "Inspect callback routing." },
            ],
          },
        },
        {
          ...childBase,
          type: "assistant",
          uuid: "inspection-tool",
          parentUuid: "first-prompt",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "read-call",
                name: "Read",
                input: { file_path: "callback.ts" },
              },
            ],
            stop_reason: "tool_use",
          },
        },
        {
          ...childBase,
          type: "user",
          uuid: "inspection-result",
          parentUuid: "inspection-tool",
          message: {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: "read-call", content: "Callback source" },
            ],
          },
        },
        {
          ...childBase,
          type: "assistant",
          uuid: "child-final",
          parentUuid: "inspection-result",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Callback routing checked." }],
            stop_reason: "end_turn",
          },
        },
      ];
      await writeFile(
        join(children, "agent-child.jsonl"),
        records.map((record) => JSON.stringify(record)).join("\n") + "\n",
      );

      const history = await Effect.runPromise(
        loadClaudeHistory(
          {
            repoPath: workingDirectory,
            workingDirectory,
            externalSessionId: claudeSubagentExternalSessionId(sessionId, "child"),
            runtimeKind: "claude",
            runtimePolicy: { kind: "claude" },
          },
          () => base.timestamp,
          undefined,
          { processEnv: { CLAUDE_CONFIG_DIR: config }, storage },
        ),
      );

      expect(history.filter((message) => message.role === "user")).toEqual([
        expect.objectContaining({
          messageId: "first-prompt",
          text: "Inspect callback routing.",
          displayParts: [{ kind: "text", text: "Inspect callback routing." }],
        }),
      ]);
      expect(
        history.flatMap((message) =>
          message.parts.flatMap((part) =>
            part.kind === "tool" ? [[part.callId, part.status, part.output]] : [],
          ),
        ),
      ).toEqual([
        ["setup-call", "completed", "Setup source"],
        ["read-call", "completed", "Callback source"],
      ]);
      expect(history.map((message) => message.messageId)).toEqual([
        "setup-tool",
        "first-prompt",
        "inspection-tool",
        "child-final",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
