import type { AgentSessionLiveRef } from "@openducktor/contracts";
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import { AgentSessionResumeError } from "../../ports/agent-session-resume-error";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import { createFixedRuntimeSettingsConfig } from "../../test-support/runtime-settings-config";
import {
  CLAUDE_TEST_VERSION_OUTPUT,
  createRecordingClaudeSystemCommands,
} from "./claude-agent-sdk-system-commands.test-support";
import {
  CLAUDE_INTERRUPTED_TURN_RESUME_VERIFIED_VERSION,
  assertClaudeInterruptedTurnResumeCompatible,
  isClaudeInterruptedTurnResumeSupported,
  parseClaudeCliVersion,
  supportsClaudeInterruptedTurnResume,
} from "./claude-continuation-compatibility";

const sessionRef: AgentSessionLiveRef = {
  repoPath: "/repo",
  runtimeKind: "claude",
  workingDirectory: "/repo/worktree",
  externalSessionId: "session-1",
};

const claudeExecutablePath = "/usr/local/bin/claude";

const createClaudeToolDiscovery = (): ToolDiscoveryPort => ({
  discoverTool: () => Effect.die("unused"),
  resolveTool: () => Effect.die("unused"),
  resolveToolPath: () => Effect.succeed(claudeExecutablePath),
  validateToolPath: (toolId, executablePath) =>
    toolId === "claude" && executablePath === claudeExecutablePath
      ? Effect.succeed({
          displayLabel: "Saved path",
          path: executablePath,
          sourceCategory: "provided_path" as const,
        })
      : Effect.die("unused"),
});

const createSupportInput = (
  versionOutput: string | null = CLAUDE_TEST_VERSION_OUTPUT,
  validateToolPath?: ToolDiscoveryPort["validateToolPath"],
) => {
  const toolDiscovery = createClaudeToolDiscovery();
  const resolvedToolDiscovery: ToolDiscoveryPort = validateToolPath
    ? { ...toolDiscovery, validateToolPath }
    : toolDiscovery;
  return {
    settingsConfig: createFixedRuntimeSettingsConfig("claude", claudeExecutablePath),
    toolDiscovery: resolvedToolDiscovery,
    systemCommands: createRecordingClaudeSystemCommands(versionOutput).systemCommands,
  };
};

describe("Claude interrupted-turn resume executable gate", () => {
  test("parses the version that claude --version prints", () => {
    expect(parseClaudeCliVersion("2.1.251 (Claude Code)")).toEqual({
      major: 2,
      minor: 1,
      patch: 251,
    });
    expect(parseClaudeCliVersion(" 2.2.0 ")).toEqual({ major: 2, minor: 2, patch: 0 });
    expect(parseClaudeCliVersion("2.1.251-beta.1 (Claude Code)")).toBeNull();
    expect(parseClaudeCliVersion("2.1.251-custom")).toBeNull();
    expect(parseClaudeCliVersion("not a version")).toBeNull();
    expect(parseClaudeCliVersion(null)).toBeNull();
  });

  test("accepts only the verified releases", () => {
    const verified = parseClaudeCliVersion(CLAUDE_INTERRUPTED_TURN_RESUME_VERIFIED_VERSION);
    expect(supportsClaudeInterruptedTurnResume(verified)).toBe(true);
    expect(supportsClaudeInterruptedTurnResume(parseClaudeCliVersion("2.1.239"))).toBe(true);
    expect(supportsClaudeInterruptedTurnResume(parseClaudeCliVersion("2.1.250"))).toBe(false);
    expect(supportsClaudeInterruptedTurnResume(parseClaudeCliVersion("2.1.252"))).toBe(false);
    expect(supportsClaudeInterruptedTurnResume(parseClaudeCliVersion("2.1.251-beta.1"))).toBe(
      false,
    );
    expect(supportsClaudeInterruptedTurnResume(parseClaudeCliVersion("3.0.0"))).toBe(false);
    expect(supportsClaudeInterruptedTurnResume(null)).toBe(false);
  });

  test("passes when the resolved executable reports the verified version", async () => {
    const { systemCommands, versionCalls } = createRecordingClaudeSystemCommands();

    await expect(
      Effect.runPromise(
        assertClaudeInterruptedTurnResumeCompatible({
          executablePath: claudeExecutablePath,
          sessionRef,
          systemCommands,
        }),
      ),
    ).resolves.toBeUndefined();
    expect(versionCalls).toEqual([[claudeExecutablePath, ["--version"], { timeoutMs: 2_000 }]]);
  });

  test("fails closed with compatibility_rejected for an older executable", async () => {
    const { systemCommands } = createRecordingClaudeSystemCommands("2.1.250 (Claude Code)");

    const failure = await Effect.runPromise(
      Effect.flip(
        assertClaudeInterruptedTurnResumeCompatible({
          executablePath: claudeExecutablePath,
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
        "Claude Code '2.1.250 (Claude Code)' at '/usr/local/bin/claude' is not a verified interrupted-turn resume release. OpenDucktor verified interrupted-turn resume with Claude Code 2.1.273 or 2.1.251 or 2.1.239.",
    });
  });

  test("fails closed with compatibility_rejected for a later unverified release", async () => {
    const { systemCommands } = createRecordingClaudeSystemCommands("2.1.252 (Claude Code)");

    const failure = await Effect.runPromise(
      Effect.flip(
        assertClaudeInterruptedTurnResumeCompatible({
          executablePath: claudeExecutablePath,
          sessionRef,
          systemCommands,
        }),
      ),
    );

    expect(failure).toMatchObject({ reason: "compatibility_rejected" });
  });

  test("fails closed with compatibility_rejected when the version is unreadable", async () => {
    const { systemCommands } = createRecordingClaudeSystemCommands(null);

    const failure = await Effect.runPromise(
      Effect.flip(
        assertClaudeInterruptedTurnResumeCompatible({
          executablePath: claudeExecutablePath,
          sessionRef,
          systemCommands,
        }),
      ),
    );

    expect(failure).toMatchObject({
      reason: "compatibility_rejected",
      message:
        "Cannot read the version of the Claude executable '/usr/local/bin/claude'. OpenDucktor verified interrupted-turn resume with Claude Code 2.1.273 or 2.1.251 or 2.1.239.",
    });
  });

  test("reports support only for the verified resolved executable", async () => {
    await expect(
      Effect.runPromise(isClaudeInterruptedTurnResumeSupported(createSupportInput())),
    ).resolves.toBe(true);
    await expect(
      Effect.runPromise(
        isClaudeInterruptedTurnResumeSupported(createSupportInput("2.1.252 (Claude Code)")),
      ),
    ).resolves.toBe(false);
    await expect(
      Effect.runPromise(isClaudeInterruptedTurnResumeSupported(createSupportInput(null))),
    ).resolves.toBe(false);
  });

  test("reports no support when the executable cannot be resolved", async () => {
    await expect(
      Effect.runPromise(
        isClaudeInterruptedTurnResumeSupported(
          createSupportInput(CLAUDE_TEST_VERSION_OUTPUT, () =>
            Effect.fail(
              new HostValidationError({
                field: "agentRuntimes.claude.executablePath",
                message: "The Claude executable is unavailable.",
              }),
            ),
          ),
        ),
      ),
    ).resolves.toBe(false);
  });
});
