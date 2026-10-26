import { describe, expect, test } from "bun:test";
import { splitTaskDescriptionFrontMatter } from "./task-description-front-matter";

describe("splitTaskDescriptionFrontMatter", () => {
  test("keeps YAML front matter exactly and returns the body", () => {
    expect(splitTaskDescriptionFrontMatter("---\r\ntitle: 'Exact'\r\n---\r\n# Body")).toEqual({
      kind: "valid",
      raw: "---\r\ntitle: 'Exact'\r\n---\r\n",
      body: "# Body",
    });
  });

  test("preserves TOML front matter exactly", () => {
    const markdown = '+++\nname = "task"\n+++\nBody';
    expect(splitTaskDescriptionFrontMatter(markdown)).toEqual({
      kind: "valid",
      raw: '+++\nname = "task"\n+++\n',
      body: "Body",
    });
  });

  test("does not treat a byte-order mark or leading content as front matter", () => {
    expect(splitTaskDescriptionFrontMatter("﻿---\ntitle: no\n---\nBody")).toEqual({
      kind: "none",
      raw: "",
      body: "﻿---\ntitle: no\n---\nBody",
    });
  });

  test("reports an unterminated block as malformed", () => {
    expect(splitTaskDescriptionFrontMatter("---\ntitle: broken\nBody")).toEqual({
      kind: "malformed",
      syntax: "YAML",
      closingDelimiter: "---",
    });
  });
});
