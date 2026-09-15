import type { AgentSessionLiveRef } from "@openducktor/contracts";
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { AgentSessionResumeError } from "../../ports/agent-session-resume-error";
import { createRecordingClaudeSystemCommands } from "./claude-agent-sdk-system-commands.test-support";
import {
  CLAUDE_INTERRUPTED_TURN_RESUME_MINIMUM_VERSION,
  assertClaudeInterruptedTurnResumeCompatible,
  parseClaudeCliVersion,
  supportsClaudeInterruptedTurnResume,
} from "./claude-continuation-compatibility";

const sessionRef: AgentSessionLiveRef = {
  repoPath: "/repo",
  runtimeKind: "claude",
  workingDirectory: "/repo/worktree",
  externalSessionId: "session-1",
};

describe("Claude interrupted-turn resume executable gate", () => {
  test("parses the version that claude --version prints", () => {
    expect(parseClaudeCliVersion("2.1.251 (Claude Code)")).toEqual({
      major: 2,
      minor: 1,
      patch: 251,
    });
    expect(parseClaudeCliVersion(" 2.2.0 ")).toEqual({ major: 2, minor: 2, patch: 0 });
    expect(parseClaudeCliVersion("not a version")).toBeNull();
    expect(parseClaudeCliVersion(null)).toBeNull();
  });

  test("accepts the minimum version and later releases only", () => {
    const minimum = parseClaudeCliVersion(CLAUDE_INTERRUPTED_TURN_RESUME_MINIMUM_VERSION);
    expect(supportsClaudeInterruptedTurnResume(minimum)).toBe(true);
    expect(supportsClaudeInterruptedTurnResume(parseClaudeCliVersion("2.1.250"))).toBe(false);
    expect(supportsClaudeInterruptedTurnResume(parseClaudeCliVersion("2.0.999"))).toBe(false);
    expect(supportsClaudeInterruptedTurnResume(parseClaudeCliVersion("3.0.0"))).toBe(true);
    expect(supportsClaudeInterruptedTurnResume(null)).toBe(false);
  });

  test("passes when the resolved executable reports the minimum version", async () => {
    const { systemCommands, versionCalls } = createRecordingClaudeSystemCommands();

    await expect(
      Effect.runPromise(
        assertClaudeInterruptedTurnResumeCompatible({
          executablePath: "/usr/local/bin/claude",
          sessionRef,
          systemCommands,
        }),
      ),
    ).resolves.toBeUndefined();
    expect(versionCalls).toEqual([["/usr/local/bin/claude", ["--version"], { timeoutMs: 2_000 }]]);
  });

  test("fails closed with compatibility_rejected for an older executable", async () => {
    const { systemCommands } = createRecordingClaudeSystemCommands("2.1.250 (Claude Code)");

    const failure = await Effect.runPromise(
      Effect.flip(
        assertClaudeInterruptedTurnResumeCompatible({
          executablePath: "/usr/local/bin/claude",
          sessionRef,
          systemCommands,
        }),
      ),
    );

    expect(failure).toBeInstanceOf(AgentSessionResumeError);
    expect(failure).toMatchObject({
      reason: "compatibility_rejected",
      sessionRef,
      message:
        "Claude Code '2.1.250 (Claude Code)' at '/usr/local/bin/claude' does not support interrupted-turn resume. Interrupted-turn resume needs Claude Code 2.1.251 or later.",
    });
  });

  test("fails closed with compatibility_rejected when the version is unreadable", async () => {
    const { systemCommands } = createRecordingClaudeSystemCommands(null);

    const failure = await Effect.runPromise(
      Effect.flip(
        assertClaudeInterruptedTurnResumeCompatible({
          executablePath: "/usr/local/bin/claude",
          sessionRef,
          systemCommands,
        }),
      ),
    );

    expect(failure).toMatchObject({
      reason: "compatibility_rejected",
      message:
        "Cannot read the version of the Claude executable '/usr/local/bin/claude'. Interrupted-turn resume needs Claude Code 2.1.251 or later.",
    });
  });
});
