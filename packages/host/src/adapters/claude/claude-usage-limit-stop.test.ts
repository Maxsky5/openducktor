import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRuntimeQueryError } from "@openducktor/core";
import { Effect } from "effect";
import type { SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";
import { toClaudeHistoryMessages } from "./claude-agent-sdk-history";
import { claudeHistoryMessagesFixture } from "./claude-agent-sdk-test-messages";
import { retainParsedClaudeTranscriptRecord } from "./claude-transcript-retention";
import type { ClaudeTranscriptReader } from "./claude-transcript-reader";
import { readClaudeUsageLimitResetEpochMs } from "./claude-agent-sdk-history-assistant";
import {
  latestClaudeUsageLimitStop,
  readClaudeLatestUsageLimitStop,
  USAGE_LIMIT_SCAN_TAIL_BYTES,
} from "./claude-usage-limit-stop";

const RESET_SECONDS = 1_792_935_600;
const user = (uuid: string, timestamp: string): SessionStoreEntry => ({
  type: "user",
  uuid,
  timestamp,
  session_id: "session-1",
  message: { role: "user", content: "Fix the build" },
});
type LimitFields = {
  apiError?: string;
  apiErrorParams?: {
    rate_limit_info: { resetsAt: number; status?: string; rateLimitType?: string };
  };
  quotaLimits?: { resetsAt: number | string; status?: string; upgradePaths?: string[] };
};
const limitError = (fields: LimitFields): SessionStoreEntry => ({
  type: "assistant",
  uuid: "00000000-0000-4000-8000-000000000002",
  timestamp: "2026-10-25T12:17:26.688Z",
  session_id: "session-1",
  error: "rate_limit",
  message: {
    id: "limit-response",
    model: "<synthetic>",
    role: "assistant",
    content: [{ type: "text", text: "You've hit your session limit" }],
    stop_reason: "stop_sequence",
  },
  ...fields,
});
// The fields of a saved Claude Code 2.1.309 usage-limit error.
const savedLimitFields: LimitFields = {
  apiError: "usage_limit_reached",
  apiErrorParams: {
    rate_limit_info: { status: "rejected", resetsAt: RESET_SECONDS, rateLimitType: "five_hour" },
  },
  quotaLimits: { status: "rejected", resetsAt: RESET_SECONDS, upgradePaths: ["overage"] },
};

describe("Claude usage-limit stops", () => {
  test("history keeps only the reset times of a usage-limit error", () => {
    const retained = retainParsedClaudeTranscriptRecord(
      JSON.parse(JSON.stringify(limitError(savedLimitFields))),
    );

    expect(retained?.quotaLimits).toEqual({ resetsAt: RESET_SECONDS });
    expect(retained?.apiErrorParams).toEqual({ rate_limit_info: { resetsAt: RESET_SECONDS } });
    expect(retained?.apiError).toBeUndefined();
  });

  test("reads the reset from quotaLimits, else from the API error parameters", () => {
    const resetOf = (fields: LimitFields) =>
      readClaudeUsageLimitResetEpochMs(claudeHistoryMessagesFixture([limitError(fields)])[0]!);

    expect(resetOf(savedLimitFields)).toBe(RESET_SECONDS * 1000);
    expect(resetOf({ apiErrorParams: { rate_limit_info: { resetsAt: RESET_SECONDS + 60 } } })).toBe(
      (RESET_SECONDS + 60) * 1000,
    );
    expect(resetOf({ quotaLimits: { resetsAt: "soon" } })).toBe(undefined);
    expect(resetOf({})).toBe(undefined);
  });

  test("a restored history notice keeps the reset time of the live error", () => {
    const history = toClaudeHistoryMessages(
      claudeHistoryMessagesFixture([
        user("00000000-0000-4000-8000-000000000001", "2026-10-25T12:00:00.000Z"),
        limitError(savedLimitFields),
      ]),
      () => "2026-10-25T12:17:26.688Z",
    );

    expect(history.at(-1)).toMatchObject({
      messageId: "limit-response",
      notice: { reason: "session_error", usageLimit: { resetsAtEpochMs: RESET_SECONDS * 1000 } },
    });
  });

  test("finds the stop of the latest turn with the ID of the live turn error", () => {
    const messages = claudeHistoryMessagesFixture([
      user("00000000-0000-4000-8000-000000000001", "2026-10-25T12:00:00.000Z"),
      limitError(savedLimitFields),
      { type: "result", subtype: "error_during_execution", uuid: "result-1" },
    ]);

    expect(latestClaudeUsageLimitStop(messages)).toEqual({
      stopId: "limit-response",
      occurredAtEpochMs: Date.parse("2026-10-25T12:17:26.688Z"),
      resetsAtEpochMs: RESET_SECONDS * 1000,
    });
    expect(latestClaudeUsageLimitStop(claudeHistoryMessagesFixture([limitError({})]))).toEqual({
      stopId: "limit-response",
      occurredAtEpochMs: Date.parse("2026-10-25T12:17:26.688Z"),
    });
  });

  test("a later prompt or reply ends the stop", () => {
    expect(
      latestClaudeUsageLimitStop(
        claudeHistoryMessagesFixture([
          limitError(savedLimitFields),
          user("00000000-0000-4000-8000-000000000003", "2026-10-25T18:00:00.000Z"),
        ]),
      ),
    ).toBeNull();
    expect(
      latestClaudeUsageLimitStop(
        claudeHistoryMessagesFixture([
          limitError(savedLimitFields),
          {
            type: "assistant",
            uuid: "00000000-0000-4000-8000-000000000004",
            session_id: "session-1",
            message: { id: "reply", role: "assistant", content: [{ type: "text", text: "Done" }] },
          },
        ]),
      ),
    ).toBeNull();
  });
});

describe("Claude latest usage-limit stop read", () => {
  test("reads only a transcript that ends near a usage-limit error", async () => {
    const root = await mkdtemp(join(tmpdir(), "claude-usage-limit-"));
    try {
      const project = join(root, "projects", "project");
      await mkdir(project, { recursive: true });
      const write = (sessionId: string, lines: unknown[]) =>
        writeFile(
          join(project, `${sessionId}.jsonl`),
          `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
        );
      const longReply = {
        type: "assistant",
        message: { content: "x".repeat(USAGE_LIMIT_SCAN_TAIL_BYTES) },
      };
      await write("old-limit", [{ type: "assistant", error: "rate_limit" }, longReply]);
      await write("recent-limit", [longReply, { type: "assistant", error: "rate_limit" }]);
      const reads: string[] = [];
      const reader: ClaudeTranscriptReader = {
        read: (input) => {
          reads.push(input.externalSessionId);
          return Effect.fail(
            new AgentRuntimeQueryError("request_failed", "Read stopped by the test."),
          );
        },
      };
      const read = (externalSessionId: string) =>
        Effect.runPromise(
          Effect.result(
            readClaudeLatestUsageLimitStop(
              { repoPath: root, runtimeKind: "claude", workingDirectory: root, externalSessionId },
              reader,
              { CLAUDE_CONFIG_DIR: root },
            ),
          ),
        );

      expect(await read("old-limit")).toMatchObject({ _tag: "Success", success: null });
      expect((await read("recent-limit"))._tag).toBe("Failure");
      expect(reads).toEqual(["recent-limit"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
