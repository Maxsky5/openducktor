import type { AgentSessionLiveRef } from "@openducktor/contracts";
import { Effect } from "effect";
import { resolveSavedRuntimeExecutable } from "../../application/runtimes/saved-runtime-executable";
import type { HostOperationErrorAggregate } from "../../effect/host-errors";
import { AgentSessionResumeError } from "../../ports/agent-session-resume-error";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";

/**
 * Claude Code release that owns the classifier for `CLAUDE_CODE_RESUME_INTERRUPTED_TURN` and
 * the release the pinned SDK bundle ships. A different version is unverified and fails closed.
 *
 * Bump checklist:
 * 1. Change this value.
 * 2. Run `bun test ./src/adapters/claude/claude-continuation-compatibility.test.ts` in
 *    `packages/host`. The test pins the SDK manifest version, the bundled CLI checksum, the
 *    resume switch, and the hidden continuation turn.
 * 3. Change the adapter code when the CLI contract changed.
 */
export const CLAUDE_INTERRUPTED_TURN_RESUME_VERIFIED_VERSION = "2.1.273";

/**
 * Claude Code releases whose binary carries the verified continuation contract: the
 * `CLAUDE_CODE_RESUME_INTERRUPTED_TURN` switch, the hidden continuation text, and the `isMeta`
 * marker. OpenDucktor verified 2.1.251 and 2.1.239 by inspecting the released binary. A release
 * that is not listed fails closed until someone verifies it.
 */
const CLAUDE_INTERRUPTED_TURN_RESUME_SUPPORTED_VERSIONS = [
  CLAUDE_INTERRUPTED_TURN_RESUME_VERIFIED_VERSION,
  "2.1.251",
  "2.1.239",
] as const;

const CLAUDE_VERSION_COMMAND_TIMEOUT_MS = 2_000;

type ClaudeCliVersion = {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
};

const parseVersionPrefix = (value: string): ClaudeCliVersion | null => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?=$|\s)/.exec(value.trim());
  if (!match) {
    return null;
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
};

const toVersionKey = (version: ClaudeCliVersion): string =>
  `${version.major}.${version.minor}.${version.patch}`;

const formatSupportedClaudeInterruptedTurnResumeVersions = (): string =>
  CLAUDE_INTERRUPTED_TURN_RESUME_SUPPORTED_VERSIONS.join(" or ");

/**
 * Reads the version that `claude --version` prints, for example `2.1.251 (Claude Code)`.
 */
export const parseClaudeCliVersion = (output: string | null): ClaudeCliVersion | null =>
  output === null ? null : parseVersionPrefix(output);

export const supportsClaudeInterruptedTurnResume = (version: ClaudeCliVersion | null): boolean => {
  if (version === null) {
    return false;
  }
  const key = toVersionKey(version);
  return CLAUDE_INTERRUPTED_TURN_RESUME_SUPPORTED_VERSIONS.some((supported) => {
    const parsed = parseVersionPrefix(supported);
    return parsed !== null && toVersionKey(parsed) === key;
  });
};

/**
 * Reads the executable OpenDucktor will run and reports whether it is the verified release.
 * The probe fails closed: every resolution, command, or parse failure reports no support,
 * so a descriptor can never advertise a path the continuation action would reject.
 */
export const isClaudeInterruptedTurnResumeSupported = (input: {
  readonly settingsConfig: SettingsConfigPort;
  readonly toolDiscovery: ToolDiscoveryPort;
  readonly systemCommands: SystemCommandPort;
}): Effect.Effect<boolean> =>
  resolveSavedRuntimeExecutable({
    kind: "claude",
    settingsConfig: input.settingsConfig,
    toolDiscovery: input.toolDiscovery,
  }).pipe(
    Effect.flatMap((executablePath) =>
      input.systemCommands.versionCommand(executablePath, ["--version"], {
        timeoutMs: CLAUDE_VERSION_COMMAND_TIMEOUT_MS,
      }),
    ),
    Effect.map((output) => supportsClaudeInterruptedTurnResume(parseClaudeCliVersion(output))),
    Effect.catchAll(() => Effect.succeed(false)),
  );

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
                ? `Cannot read the version of the Claude executable '${input.executablePath}'. OpenDucktor verified interrupted-turn resume with Claude Code ${formatSupportedClaudeInterruptedTurnResumeVersions()}.`
                : `Claude Code '${output.trim()}' at '${input.executablePath}' is not a verified interrupted-turn resume release. OpenDucktor verified interrupted-turn resume with Claude Code ${formatSupportedClaudeInterruptedTurnResumeVersions()}.`,
          }),
        );
      }),
    );
