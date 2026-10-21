import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoadAgentSessionHistoryInput } from "@openducktor/core";
import { Effect } from "effect";
import { loadClaudeHistory } from "./claude-agent-sdk-history-loader";
import { claudeSubagentExternalSessionId } from "./claude-agent-sdk-subagent-transcripts";

test.each(["memory", "disk"] as const)(
  "checks child scope after a parent relocation followed by large new rows with %s storage",
  async (storage) => {
    const temporary = await mkdtemp(join(tmpdir(), "claude-transcript-child-scope-"));
    try {
      const originalCwd = await realpath(temporary);
      const movedCwd = join(originalCwd, "moved");
      await mkdir(movedCwd);
      const sessionId = "00000000-0000-4000-8000-000000000001";
      const timestamp = "2026-10-21T10:00:00.000Z";
      const config = join(originalCwd, "config");
      const project = join(config, "projects", "fixture");
      const children = join(project, sessionId, "subagents");
      await mkdir(children, { recursive: true });
      const user = {
        sessionId,
        cwd: originalCwd,
        timestamp,
        type: "user",
        uuid: "root-user",
        parentUuid: null,
        message: { role: "user", content: "Inspect the source" },
      };
      await writeFile(
        join(project, `${sessionId}.jsonl`),
        [
          user,
          { type: "relocated", sessionId, relocatedCwd: movedCwd },
          {
            ...user,
            cwd: movedCwd,
            type: "assistant",
            uuid: "root-answer",
            parentUuid: "root-user",
            message: {
              id: "root-answer",
              role: "assistant",
              content: [{ type: "text", text: "x".repeat(128 * 1024) }],
              stop_reason: "end_turn",
            },
          },
        ]
          .map((record) => JSON.stringify(record))
          .join("\n") + "\n",
      );
      await writeFile(
        join(children, "agent-child.jsonl"),
        JSON.stringify({ ...user, cwd: movedCwd, uuid: "child-user", isSidechain: true }) + "\n",
      );
      const input: LoadAgentSessionHistoryInput = {
        repoPath: movedCwd,
        workingDirectory: movedCwd,
        externalSessionId: claudeSubagentExternalSessionId(sessionId, "child"),
        runtimeKind: "claude",
        runtimePolicy: { kind: "claude" },
      };
      const options = { processEnv: { CLAUDE_CONFIG_DIR: config }, storage };

      const history = await Effect.runPromise(
        loadClaudeHistory(input, () => timestamp, undefined, options),
      );
      expect(history.map((message) => [message.messageId, message.text])).toEqual([
        ["child-user", "Inspect the source"],
      ]);
      await expect(
        Effect.runPromise(
          loadClaudeHistory(
            { ...input, repoPath: originalCwd, workingDirectory: originalCwd },
            () => timestamp,
            undefined,
            options,
          ),
        ),
      ).rejects.toMatchObject({ code: "scope_mismatch" });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  },
);
