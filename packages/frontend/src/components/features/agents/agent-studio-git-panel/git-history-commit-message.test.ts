import { describe, expect, test } from "bun:test";
import { commitBodyBlocks, commitBodyPreview } from "./git-history-commit-message";

const MESSAGE = [
  "feat(auth): add GitHub sign-in",
  "",
  "Add the GitHub provider to the sign-in page and",
  "store the account link.",
  "",
  "- Check the state parameter",
  "  on every callback.",
  "* Reject unknown scopes.",
  "",
  "Refs #42",
].join("\n");

describe("commitBodyBlocks", () => {
  test("joins wrapped lines and keeps list items apart", () => {
    expect(commitBodyBlocks(MESSAGE)).toEqual([
      {
        kind: "paragraph",
        line: 2,
        text: "Add the GitHub provider to the sign-in page and store the account link.",
      },
      {
        kind: "list",
        line: 5,
        items: [
          { line: 5, text: "Check the state parameter on every callback." },
          { line: 7, text: "Reject unknown scopes." },
        ],
      },
      { kind: "paragraph", line: 9, text: "Refs #42" },
    ]);
  });

  test("returns no blocks for a message with only a subject", () => {
    expect(commitBodyBlocks("fix: one line")).toEqual([]);
    expect(commitBodyBlocks("fix: one line\n")).toEqual([]);
  });

  test("reads Windows line endings", () => {
    expect(commitBodyBlocks("fix: subject\r\n\r\nBody text.")).toEqual([
      { kind: "paragraph", line: 2, text: "Body text." },
    ]);
  });
});

describe("commitBodyPreview", () => {
  test("puts the body on one line", () => {
    expect(commitBodyPreview(MESSAGE)).toBe(
      "Add the GitHub provider to the sign-in page and store the account link. Check the state parameter on every callback. · Reject unknown scopes. Refs #42",
    );
  });

  test("is empty for a message with only a subject", () => {
    expect(commitBodyPreview("fix: one line")).toBe("");
  });
});
