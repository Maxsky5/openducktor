import type { AgentSessionLiveRef } from "@openducktor/contracts";
import { Effect } from "effect";
import type { HostOperationErrorAggregate } from "../../effect/host-errors";
import { AgentSessionResumeError } from "../../ports/agent-session-resume-error";
import type { SystemCommandPort } from "../../ports/system-command-port";

/**
 * Claude Code release that ships the classifier for `CLAUDE_CODE_RESUME_INTERRUPTED_TURN`.
 * Keep this value in step with `claude-continuation-compatibility.test.ts`.
 */
export const CLAUDE_INTERRUPTED_TURN_RESUME_MINIMUM_VERSION = "2.1.251";

export const CLAUDE_VERSION_COMMAND_TIMEOUT_MS = 2_000;

type ClaudeCliVersion = {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
};

const parseVersionPrefix = (value: string): ClaudeCliVersion | null => {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
  if (!match) {
    return null;
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
};

/**
 * Reads the version that `claude --version` prints, for example `2.1.251 (Claude Code)`.
 */
export const parseClaudeCliVersion = (output: string | null): ClaudeCliVersion | null =>
  output === null ? null : parseVersionPrefix(output);

const compareClaudeCliVersions = (left: ClaudeCliVersion, right: ClaudeCliVersion): number =>
  left.major - right.major || left.minor - right.minor || left.patch - right.patch;

export const supportsClaudeInterruptedTurnResume = (version: ClaudeCliVersion | null): boolean => {
  const minimum = parseVersionPrefix(CLAUDE_INTERRUPTED_TURN_RESUME_MINIMUM_VERSION);
  if (version === null || minimum === null) {
    return false;
  }
  return compareClaudeCliVersions(version, minimum) >= 0;
};

const compatibilityRejected = (input: {
  readonly sessionRef: AgentSessionLiveRef;
  readonly message: string;
  readonly cause?: unknown;
}): HostOperationErrorAggregate =>
  new AgentSessionResumeError({
    reason: "compatibility_rejected",
    sessionRef: input.sessionRef,
    operation: "claudeRuntime.continueInterruptedTurn",
    message: input.message,
    cause: input.cause,
  });

/**
 * Fails closed unless the executable OpenDucktor will run reports the version
 * that owns the private interrupted-turn continuation contract.
 */
export const assertClaudeInterruptedTurnResumeCompatible = (input: {
  readonly executablePath: string;
  readonly sessionRef: AgentSessionLiveRef;
  readonly systemCommands: SystemCommandPort;
}): Effect.Effect<void, HostOperationErrorAggregate> =>
  input.systemCommands
    .versionCommand(input.executablePath, ["--version"], {
      timeoutMs: CLAUDE_VERSION_COMMAND_TIMEOUT_MS,
    })
    .pipe(
      Effect.catchAll((cause) =>
        Effect.fail(
          compatibilityRejected({
            sessionRef: input.sessionRef,
            message: `Cannot run the Claude executable '${input.executablePath}' to check interrupted-turn resume support.`,
            cause,
          }),
        ),
      ),
      Effect.flatMap((output) => {
        const version = parseClaudeCliVersion(output);
        if (supportsClaudeInterruptedTurnResume(version)) {
          return Effect.void;
        }
        return Effect.fail(
          compatibilityRejected({
            sessionRef: input.sessionRef,
            message:
              output === null
                ? `Cannot read the version of the Claude executable '${input.executablePath}'. Interrupted-turn resume needs Claude Code ${CLAUDE_INTERRUPTED_TURN_RESUME_MINIMUM_VERSION} or later.`
                : `Claude Code '${output.trim()}' at '${input.executablePath}' does not support interrupted-turn resume. Interrupted-turn resume needs Claude Code ${CLAUDE_INTERRUPTED_TURN_RESUME_MINIMUM_VERSION} or later.`,
          }),
        );
      }),
    );
