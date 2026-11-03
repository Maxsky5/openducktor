import type { RuntimeKind } from "@openducktor/contracts";

/** OpenDucktor needs this Claude Code release to track background work. */
export const CLAUDE_CODE_MINIMUM_VERSION = [2, 1, 306] as const;
export const CLAUDE_CODE_MINIMUM_VERSION_TEXT = CLAUDE_CODE_MINIMUM_VERSION.join(".");

const MAX_DETAIL_LENGTH = 600;
// Terminal color and cursor codes that runtimes write to stderr.
const ANSI_ESCAPE_PATTERN = new RegExp(String.raw`\u001b\[[0-9;?]*[A-Za-z]`, "g");

const RUNTIME_EXECUTABLE_GUIDANCE = {
  claude: {
    label: "Claude Code",
    requirement: `OpenDucktor needs Claude Code ${CLAUDE_CODE_MINIMUM_VERSION_TEXT} or later.`,
    update: "run `claude update`",
  },
  codex: {
    label: "Codex",
    requirement: "OpenDucktor needs a Codex version with the `codex app-server` command.",
    update:
      "update Codex with the tool that installed it, for example `npm install -g @openai/codex@latest` or `brew upgrade --cask codex`",
  },
  opencode: {
    label: "OpenCode",
    requirement: "OpenDucktor needs OpenCode 2 or later.",
    update: "run `opencode upgrade`",
  },
} satisfies Record<RuntimeKind, { label: string; requirement: string; update: string }>;

const capitalize = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

const cleanDetail = (detail: string): string => {
  const text = detail.replace(ANSI_ESCAPE_PATTERN, "").replace(/\s+/g, " ").trim();
  // Runtimes write the error that stopped them last, so keep the end of long output.
  const shortText = text.length > MAX_DETAIL_LENGTH ? `…${text.slice(-MAX_DETAIL_LENGTH)}` : text;
  return shortText.replace(/[.:]+$/, "");
};

/** Names the supported runtime version and how to install it or select another executable. */
export const runtimeUpdateAdvice = (kind: RuntimeKind): string => {
  const { label, requirement, update } = RUNTIME_EXECUTABLE_GUIDANCE[kind];
  return `${requirement} ${capitalize(update)}, or select another ${label} executable. Then try again.`;
};

/** Tells the user that the executable is not a supported runtime and how to fix it. */
export const incompatibleRuntimeExecutableMessage = (
  kind: RuntimeKind,
  executablePath: string,
): string =>
  `${RUNTIME_EXECUTABLE_GUIDANCE[kind].label} at '${executablePath}' is not compatible with OpenDucktor. ${runtimeUpdateAdvice(kind)}`;

/** Tells the user that the runtime stopped before it was ready, what it reported, and how to fix it. */
export const runtimeExecutableStartFailureMessage = (
  kind: RuntimeKind,
  executablePath: string,
  detail: string,
): string => {
  const { label, requirement, update } = RUNTIME_EXECUTABLE_GUIDANCE[kind];
  return `${label} at '${executablePath}' did not start: ${cleanDetail(detail)}. ${requirement} Fix the reported problem, or ${update}. Then try again.`;
};
