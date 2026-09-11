import type { AgentComputerUse, CodexAppServerJsonValue } from "@openducktor/contracts";
import { codexToolLeafName, extractStringField } from "./codex-app-server-shared";
import { codexToolResultImages, codexToolResultText } from "./codex-mcp-result";

const RESET_TOOL = "js_reset";

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
  const computerUse: AgentComputerUse = {
    action: codexActionTitle(tool, input),
  };
  const code = codexActionCode(tool, input);
  if (code !== null) {
    computerUse.code = code;
  }
  const images = codexToolResultImages(result);
  if (images.length > 0) {
    computerUse.images = images;
  }
  return {
    computerUse,
    output: error ? null : output,
    error,
  };
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
