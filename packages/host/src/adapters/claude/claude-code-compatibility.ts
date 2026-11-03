import type { SDKControlInitializeResponse } from "@anthropic-ai/claude-agent-sdk";
import { RuntimeExecutableIncompatibleError } from "../../ports/runtime-executable-probe-port";

export const CLAUDE_CODE_MINIMUM_VERSION = "2.1.306";

export const getClaudeCodeCompatibilityError = (
  initialization: Pick<SDKControlInitializeResponse, "claude_code_version">,
  executablePath: string,
): RuntimeExecutableIncompatibleError | null => {
  const version = initialization.claude_code_version;
  const match = version && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (match) {
    const major = Number(match[1]);
    const minor = Number(match[2]);
    const patch = Number(match[3]);
    if (
      [major, minor, patch].every(Number.isSafeInteger) &&
      (major > 2 || (major === 2 && (minor > 1 || (minor === 1 && patch >= 306))))
    ) {
      return null;
    }
  }
  const reportedVersion =
    version === undefined
      ? "did not report its version"
      : `reported unsupported version '${version}'`;
  return new RuntimeExecutableIncompatibleError({
    message: `Claude Code at '${executablePath}' ${reportedVersion}. OpenDucktor needs Claude Code ${CLAUDE_CODE_MINIMUM_VERSION} or later to track background work. Run \`claude update\`, or select a compatible executable. Then try again.`,
  });
};
