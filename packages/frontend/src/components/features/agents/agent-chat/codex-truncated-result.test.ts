import { describe, expect, test } from "bun:test";
import { readCodexTruncatedResult } from "./codex-truncated-result";

const truncatedResult = (escapedHead: string): string =>
  `{"content":[{"type":"text","text":"${escapedHead}…510000 chars truncated…tail"}],"structured_content":null,"is_error":true}`;

describe("readCodexTruncatedResult", () => {
  test("ignores ordinary error text", () => {
    expect(readCodexTruncatedResult("Script error: boom\n\nComputer Use API manual")).toEqual({
      kind: "not_truncated",
    });
  });

  test("ignores text without the compact result prefix", () => {
    expect(readCodexTruncatedResult("Script error: boom…510000 chars truncated…tail")).toEqual({
      kind: "not_truncated",
    });
  });

  test("returns the decoded head of a Codex-truncated result", () => {
    expect(
      readCodexTruncatedResult(truncatedResult("Script error: boom\\n\\nComputer Use API manual")),
    ).toEqual({
      kind: "truncated",
      head: "Script error: boom",
    });
  });

  test("keeps a natural ellipsis inside the first line", () => {
    expect(
      readCodexTruncatedResult(truncatedResult("Script error: waiting…for more\\nrest")),
    ).toEqual({
      kind: "truncated",
      head: "Script error: waiting…for more",
    });
  });

  test("returns a null head when the truncation cuts a string escape", () => {
    expect(readCodexTruncatedResult(truncatedResult("Script error: boom\\"))).toEqual({
      kind: "truncated",
      head: null,
    });
  });
});
