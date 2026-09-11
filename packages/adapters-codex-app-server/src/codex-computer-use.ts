import { z } from "zod";
import type {
  AgentComputerUse,
  AgentToolImage,
  CodexAppServerJsonValue,
} from "@openducktor/contracts";
import { codexToolLeafName, extractStringField } from "./codex-app-server-shared";

const RESET_TOOL = "js_reset";
const SCRIPT_ERROR_PREFIX = /^Script error:\s*/;
const FAILURE_SUMMARY_MAX_LENGTH = 200;
const FAILED_SUMMARY = "Computer action failed.";
const TRUNCATED_FAILURE_SUMMARY = "Computer action failed. Codex truncated its diagnostics.";
const READABLE_LINE_PATTERN = /[\p{L}\p{N}]/u;
const TRUNCATED_RESULT_PREFIX = '{"content":[';
const TEXT_VALUE_PREFIX = '"text":"';
const TRUNCATION_MARKER = /…\d+ chars truncated…/;
const ESCAPED_LINE_BREAK_PATTERN = /\\[nr]/;
const jsonStringSchema = z.string();

export const codexComputerUse = ({
  tool,
  input,
  images,
  failed,
  failureText,
}: {
  tool: string;
  input: Record<string, CodexAppServerJsonValue> | undefined;
  images: AgentToolImage[];
  failed: boolean;
  failureText: string | null;
}): AgentComputerUse => {
  const computerUse: AgentComputerUse = {
    action: codexActionTitle(tool, input),
  };
  const code = codexActionCode(tool, input);
  if (code !== null) {
    computerUse.code = code;
  }
  if (images.length > 0) {
    computerUse.images = images;
  }
  if (failed) {
    computerUse.failureSummary = codexFailureSummary(failureText);
  }
  return computerUse;
};

const codexActionTitle = (
  tool: string,
  input: Record<string, CodexAppServerJsonValue> | undefined,
): string => {
  const title = extractStringField(input, ["title"]);
  if (title !== null) {
    return title.replace(/\s+/g, " ");
  }
  return codexToolLeafName(tool) === RESET_TOOL ? "Reset computer session" : "Computer action";
};

const codexActionCode = (
  tool: string,
  input: Record<string, CodexAppServerJsonValue> | undefined,
): string | null => {
  if (codexToolLeafName(tool) === RESET_TOOL) {
    return null;
  }
  return extractStringField(input, ["code"]);
};

const codexFailureSummary = (failureText: string | null): string => {
  if (failureText === null || failureText.trim().length === 0) {
    return FAILED_SUMMARY;
  }
  const text = failureText.trim();
  if (isTruncatedResult(text)) {
    const recovered = recoveredTruncatedLine(text);
    return recovered === null ? TRUNCATED_FAILURE_SUMMARY : boundSummaryLine(recovered);
  }
  const firstLine = firstFailureLine(text);
  return firstLine.length > 0 ? boundSummaryLine(firstLine) : FAILED_SUMMARY;
};

const isTruncatedResult = (text: string): boolean =>
  text.startsWith(TRUNCATED_RESULT_PREFIX) && TRUNCATION_MARKER.test(text);

const recoveredTruncatedLine = (text: string): string | null => {
  const valueStart = text.indexOf(TEXT_VALUE_PREFIX);
  if (valueStart === -1) {
    return null;
  }
  const fragment = text.slice(valueStart + TEXT_VALUE_PREFIX.length);
  const indexes = [
    fragment.search(ESCAPED_LINE_BREAK_PATTERN),
    fragment.search(TRUNCATION_MARKER),
  ].filter((index) => index >= 0);
  const head = decodeJsonStringFragment(fragment.slice(0, Math.min(...indexes, fragment.length)));
  if (head === null) {
    return null;
  }
  const line = firstFailureLine(head);
  return line.length > 0 && READABLE_LINE_PATTERN.test(line) ? line : null;
};

const decodeJsonStringFragment = (fragment: string): string | null => {
  try {
    return jsonStringSchema.parse(JSON.parse(`"${fragment}"`));
  } catch {
    return null;
  }
};

const firstFailureLine = (text: string): string => {
  const firstLine = text
    .replace(SCRIPT_ERROR_PREFIX, "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstLine ?? "";
};

const boundSummaryLine = (line: string): string =>
  line.length > FAILURE_SUMMARY_MAX_LENGTH
    ? `${line.slice(0, FAILURE_SUMMARY_MAX_LENGTH - 1)}…`
    : line;
