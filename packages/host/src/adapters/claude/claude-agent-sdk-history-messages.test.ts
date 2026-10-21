import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRuntimeQueryError } from "@openducktor/core";
import { Effect } from "effect";
import {
  isClaudeSessionMissingError,
  loadClaudeSessionMessages,
} from "./claude-agent-sdk-history-messages";

describe("Claude SDK history reader", () => {
  test("propagates missing Claude transcripts as typed history errors", async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), "openducktor-claude-history-"));
    try {
      await expect(
        Effect.runPromise(
          loadClaudeSessionMessages({
            repoPath: workingDirectory,
            runtimeKind: "claude",
            workingDirectory,
            externalSessionId: "00000000-0000-4000-8000-000000000001",
            runtimePolicy: { kind: "claude" },
          }),
        ),
      ).rejects.toMatchObject({
        code: "request_failed",
      });
    } finally {
      await rm(workingDirectory, { recursive: true, force: true });
    }
  }, 15_000);

  test("matches only the known missing-session history error", () => {
    expect(
      isClaudeSessionMissingError(
        new AgentRuntimeQueryError(
          "request_failed",
          "The selected Claude session is unavailable. Check its history on the host.",
        ),
      ),
    ).toBe(true);
    expect(
      isClaudeSessionMissingError(
        new AgentRuntimeQueryError("request_failed", "Claude history import failed."),
      ),
    ).toBe(false);
    expect(isClaudeSessionMissingError(new Error("request_failed"))).toBe(false);
  });
});
