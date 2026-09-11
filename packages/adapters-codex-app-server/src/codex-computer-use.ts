import { z } from "zod";
import type {
  AgentComputerUse,
  AgentToolImage,
  CodexAppServerJsonValue,
} from "@openducktor/contracts";
import { codexToolLeafName, extractStringField } from "./codex-app-server-shared";
import { codexToolResultImages, codexToolResultText } from "./codex-mcp-result";

const RESET_TOOL = "js_reset";
const SCRIPT_ERROR_PREFIX = /^Script error:\s*/;
const FAILURE_SUMMARY_MAX_LENGTH = 200;
const FAILED_SUMMARY = "Computer action failed.";
const TRUNCATED_FAILURE_SUMMARY = "Computer action failed. Codex truncated its diagnostics.";
const READABLE_LINE_PATTERN = /[\p{L}\p{N}]/u;
const TRUNCATED_RESULT_PREFIX = '{"content":[';
const TRUNCATION_MARKER = /…\d+ chars truncated…/;
const TRUNCATED_TEXT_PATTERN = /"text":"((?:\\["\\/bfnrt]|\\u[0-9a-fA-F]{4}|[^"\\])*?)(?=\\[nr]|…)/;
const jsonStringSchema = z.string();

export type CodexComputerUseResult = {
  computerUse: AgentComputerUse;
  output: string | null;
  error: string | null;
};

export const codexComputerUseResult = ({
  tool,
  input,
  result,
  itemError,
  failed,
}: {
  tool: string;
  input: Record<string, CodexAppServerJsonValue> | undefined;
  result: CodexAppServerJsonValue | undefined;
  itemError: string | null;
  failed: boolean;
}): CodexComputerUseResult => {
  const output = codexToolResultText(result, { readTextOnMediaBlocks: true });
  const error = failed && !itemError ? output : itemError;
  const computerUse = codexComputerUse({
    tool,
    input,
    images: codexToolResultImages(result),
    failed,
    failureText: error,
  });
  return {
    computerUse,
    output: error ? null : output,
    error,
  };
};

const codexComputerUse = ({
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
  const match = TRUNCATED_TEXT_PATTERN.exec(text);
  const fragment = match?.[1];
  if (fragment === undefined) {
    return null;
  }
  const head = decodeJsonStringFragment(fragment);
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
