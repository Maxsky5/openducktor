export const CODEX_RESULT_BUDGET_BYTES = 1_048_576;

const escapeJsonString = (value: string): string => JSON.stringify(value).slice(1, -1);

export const codexTruncatedResultPreview = (failureText: string): string => {
  const compact = `{"content":[{"type":"text","text":"${escapeJsonString(failureText)}"},{"type":"image","data":"${"A".repeat(256 * 1024)}","mimeType":"image/png"}],"structured_content":null,"is_error":true}`;
  if (compact.length <= CODEX_RESULT_BUDGET_BYTES) {
    throw new Error("Expected the fixture result to exceed the Codex result budget.");
  }
  const half = Math.floor(CODEX_RESULT_BUDGET_BYTES / 2);
  const removed = compact.length - CODEX_RESULT_BUDGET_BYTES;
  return `${compact.slice(0, half)}…${removed} chars truncated…${compact.slice(-half)}`;
};
