import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const AUDITED_RENDERER_FILES = [
  "agent-chat-markdown-renderer.tsx",
  "agent-chat-message-card-content.tsx",
  "agent-chat-message-card-tool-presenters.tsx",
] as const;

type WrappingViolation = {
  file: string;
  line: number;
  source: string;
};

const lineForIndex = (source: string, index: number): number =>
  source.slice(0, index).split("\n").length;

const readAuditedSource = (file: string): string =>
  readFileSync(new URL(file, import.meta.url), "utf8");

const openingTagPattern = /<(p|span|div)\b[\s\S]*?>/g;
const classLiteralPattern = /(["'`])(?:(?!\1)[\s\S])*?whitespace-pre-wrap(?:(?!\1)[\s\S])*?\1/g;

const isLocalScrollPreLine = (line: string): boolean =>
  line.includes("<pre") && line.includes("overflow-x-auto");

const findNonWrappingPreWrapClasses = (file: string, source: string): WrappingViolation[] => {
  const violations: WrappingViolation[] = [];

  for (const match of source.matchAll(openingTagPattern)) {
    const tagSource = match[0];
    if (!tagSource.includes("whitespace-pre-wrap") || tagSource.includes("break-words")) {
      continue;
    }
    violations.push({
      file,
      line: lineForIndex(source, match.index ?? 0),
      source: tagSource.replace(/\s+/g, " ").trim(),
    });
  }

  for (const match of source.matchAll(classLiteralPattern)) {
    const literalSource = match[0];
    if (literalSource.includes("break-words")) {
      continue;
    }

    const line = lineForIndex(source, match.index ?? 0);
    const lineSource = source.split("\n")[line - 1]?.trim() ?? literalSource;
    if (isLocalScrollPreLine(lineSource)) {
      continue;
    }

    violations.push({
      file,
      line,
      source: lineSource,
    });
  }

  return violations;
};

describe("Agent Chat prose wrapping audit", () => {
  test("keeps non-pre transcript prose from using whitespace preservation without word breaking", () => {
    const violations = AUDITED_RENDERER_FILES.flatMap((file) =>
      findNonWrappingPreWrapClasses(file, readAuditedSource(file)),
    );

    expect(violations).toEqual([]);
  });
});
