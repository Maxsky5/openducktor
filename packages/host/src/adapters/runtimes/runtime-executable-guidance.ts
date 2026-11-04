import type { RuntimeKind } from "@openducktor/contracts";
import { HostOperationError } from "../../effect/host-errors";
import { TOOL_DISCOVERY_DESCRIPTORS } from "../system/tool-discovery-descriptors";

/** How a runtime adapter tells the user which version OpenDucktor needs and how to get it. */
export type RuntimeExecutableGuidance = {
  readonly kind: RuntimeKind;
  /** One sentence, for example "OpenDucktor needs OpenCode 2 or later." */
  readonly requirement: string;
  /** A lowercase action, for example "run `opencode upgrade`". */
  readonly update: string;
};

const MAX_DETAIL_LENGTH = 600;
// Terminal color and cursor codes that runtimes write to stderr.
const ANSI_ESCAPE_PATTERN = new RegExp(String.raw`\u001b\[[0-9;?]*[A-Za-z]`, "g");

const runtimeLabel = (kind: RuntimeKind): string => TOOL_DISCOVERY_DESCRIPTORS[kind].displayName;

const capitalize = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/** Makes runtime output one short plain line without terminal codes or a final period. */
export const cleanRuntimeOutput = (output: string): string => {
  const text = output.replace(ANSI_ESCAPE_PATTERN, "").replace(/\s+/g, " ").trim();
  // Runtimes write the error that stopped them last, so keep the end of long output.
  const shortText = text.length > MAX_DETAIL_LENGTH ? `…${text.slice(-MAX_DETAIL_LENGTH)}` : text;
  return shortText.replace(/[.:]+$/, "");
};

/** Tells the user that the executable is not a supported runtime version and how to fix it. */
export const incompatibleRuntimeExecutableMessage = (
  { kind, requirement, update }: RuntimeExecutableGuidance,
  executablePath: string,
  problem = "is not compatible with OpenDucktor",
): string => {
  const label = runtimeLabel(kind);
  return `${label} at '${executablePath}' ${problem}. ${requirement} ${capitalize(update)}, or select another ${label} executable. Then try again.`;
};

/** The detail of a runtime that did not become ready before its startup deadline. */
export const notReadyWithin = (timeoutMs: number): string =>
  `It was not ready within ${timeoutMs / 1000} seconds`;

/**
 * A runtime that stopped before it was ready, with what it reported and how to fix it. `detail`
 * is a sentence, such as runtime output or an error message.
 */
export const runtimeExecutableStartError = ({
  guidance: { kind, update },
  operation,
  executablePath,
  detail,
  cause,
}: {
  guidance: RuntimeExecutableGuidance;
  operation: string;
  executablePath: string;
  detail: string;
  cause?: unknown;
}): HostOperationError<{ executablePath: string }> =>
  new HostOperationError({
    operation,
    message: `${runtimeLabel(kind)} at '${executablePath}' did not start. ${capitalize(cleanRuntimeOutput(detail))}. Fix the reported problem, or ${update}. Then try again.`,
    cause,
    details: { executablePath },
  });
