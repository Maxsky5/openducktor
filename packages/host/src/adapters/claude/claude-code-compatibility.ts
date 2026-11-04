import type { SDKControlInitializeResponse } from "@anthropic-ai/claude-agent-sdk";
import { RuntimeExecutableIncompatibleError } from "../../ports/runtime-executable-probe-port";
import {
  incompatibleRuntimeExecutableMessage,
  type RuntimeExecutableGuidance,
} from "../runtimes/runtime-executable-guidance";

type Version = readonly [major: number, minor: number, patch: number];

/** OpenDucktor needs this Claude Code release to track background work. */
const CLAUDE_CODE_MINIMUM_VERSION: Version = [2, 1, 306];
export const CLAUDE_CODE_MINIMUM_VERSION_TEXT = CLAUDE_CODE_MINIMUM_VERSION.join(".");

export const CLAUDE_CODE_GUIDANCE: RuntimeExecutableGuidance = {
  kind: "claude",
  requirement: `OpenDucktor needs Claude Code ${CLAUDE_CODE_MINIMUM_VERSION_TEXT} or later.`,
  update: "run `claude update`",
};

/** Returns a negative number, zero, or a positive number when `left` is older, equal, or newer. */
const compareVersions = (left: Version, right: Version): number =>
  left[0] - right[0] || left[1] - right[1] || left[2] - right[2];

export const getClaudeCodeCompatibilityError = (
  initialization: Pick<SDKControlInitializeResponse, "claude_code_version">,
  executablePath: string,
): RuntimeExecutableIncompatibleError | null => {
  const version = initialization.claude_code_version;
  const match = version && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (match) {
    const parsed: Version = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (
      parsed.every(Number.isSafeInteger) &&
      compareVersions(parsed, CLAUDE_CODE_MINIMUM_VERSION) >= 0
    ) {
      return null;
    }
  }
  const reportedVersion =
    version === undefined
      ? "did not report its version"
      : `reported unsupported version '${version}'`;
  return new RuntimeExecutableIncompatibleError({
    message: incompatibleRuntimeExecutableMessage(
      CLAUDE_CODE_GUIDANCE,
      executablePath,
      reportedVersion,
    ),
  });
};
