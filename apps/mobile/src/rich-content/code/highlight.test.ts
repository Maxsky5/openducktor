import { describe, expect, test } from "bun:test";
import {
  HIGHLIGHT_CHUNK_LINES,
  highlightLines,
  languageForFilePath,
  normalizeLanguage,
  plainLineText,
} from "./highlight";

describe("plainLineText", () => {
  test("gives the text of a line without highlight and null for a highlighted line", () => {
    const plain = highlightLines("const a = 1;\n\nreturn a;", null);
    expect(plainLineText(plain.line(0))).toBe("const a = 1;");
    expect(plainLineText(plain.line(1))).toBe("");
    const code = highlightLines("const a = 1;", "typescript");
    expect(plainLineText(code.line(0))).toBeNull();
  });
});

describe("normalizeLanguage", () => {
  test("resolves desktop aliases and fence info strings", () => {
    expect(normalizeLanguage("ts")).toBe("typescript");
    expect(normalizeLanguage(" JS ")).toBe("javascript");
    expect(normalizeLanguage("mjs")).toBe("javascript");
    expect(normalizeLanguage("shell")).toBe("bash");
    expect(normalizeLanguage("yml")).toBe("yaml");
    expect(normalizeLanguage('tsx title="app.tsx"')).toBe("tsx");
    expect(normalizeLanguage("rust")).toBe("rust");
  });

  test("returns null for unknown or missing languages", () => {
    expect(normalizeLanguage("cobol")).toBeNull();
    expect(normalizeLanguage("")).toBeNull();
    expect(normalizeLanguage(null)).toBeNull();
    expect(normalizeLanguage(undefined)).toBeNull();
  });

  test("reads a language from a file path", () => {
    expect(languageForFilePath("src/app/main.tsx")).toBe("tsx");
    expect(languageForFilePath("C:\\repo\\lib.rs")).toBe("rust");
    expect(languageForFilePath("types.d.ts")).toBe("typescript");
    expect(languageForFilePath("Makefile")).toBeNull();
    expect(languageForFilePath(".env")).toBeNull();
  });
});

describe("highlightLines", () => {
  test("builds token lines with tones for a known language", () => {
    const code = highlightLines('const a = "x"; // note\nreturn 1;', "ts");
    expect(code.language).toBe("typescript");
    expect(code.lineCount).toBe(2);
    const first = code.line(0);
    expect(first.map((token) => token.text).join("")).toBe('const a = "x"; // note');
    expect(first).toContainEqual({ text: "const", tone: "keyword" });
    expect(first).toContainEqual({ text: '"x"', tone: "string" });
    expect(first).toContainEqual({ text: "// note", tone: "comment" });
    expect(code.line(1)).toContainEqual({ text: "1", tone: "number" });
  });

  test("splits multi-line tokens across lines", () => {
    const code = highlightLines("/* one\ntwo */ x", "javascript");
    expect(code.line(0)).toEqual([{ text: "/* one", tone: "comment" }]);
    expect(code.line(1)[0]).toEqual({ text: "two */", tone: "comment" });
  });

  test("shows an unknown language as plain text", () => {
    const code = highlightLines("PROCEDURE DIVISION.\n\nSTOP RUN.", "cobol");
    expect(code.language).toBeNull();
    expect([code.line(0), code.line(1), code.line(2)]).toEqual([
      [{ text: "PROCEDURE DIVISION.", tone: "plain" }],
      [],
      [{ text: "STOP RUN.", tone: "plain" }],
    ]);
  });

  test("keeps empty lines and drops only the final line break", () => {
    const code = highlightLines("a\n\nb\n", "json");
    expect(code.lineCount).toBe(3);
    expect(code.lineText(2)).toBe("b");
    expect(code.line(1)).toEqual([]);
    expect(code.line(9)).toEqual([]);
  });

  test("highlights a chunk only when a caller reads one of its lines", () => {
    const source = Array.from(
      { length: HIGHLIGHT_CHUNK_LINES * 2 + 5 },
      (_, i) => `let v${i} = ${i};`,
    ).join("\n");
    const code = highlightLines(source, "js");
    expect(code.lineCount).toBe(HIGHLIGHT_CHUNK_LINES * 2 + 5);
    const last = code.line(HIGHLIGHT_CHUNK_LINES * 2 + 4);
    expect(last.map((token) => token.text).join("")).toBe(
      `let v${HIGHLIGHT_CHUNK_LINES * 2 + 4} = ${HIGHLIGHT_CHUNK_LINES * 2 + 4};`,
    );
    expect(code.line(HIGHLIGHT_CHUNK_LINES)).toContainEqual({ text: "let", tone: "keyword" });
  });

  test("returns the cached result for equal code and language", () => {
    const first = highlightLines("fn main() {}", "rust");
    expect(highlightLines("fn main() {}", "rs")).not.toBe(first);
    expect(highlightLines("fn main() {}", "rust")).toBe(first);
    expect(highlightLines("fn main() {}", "rust").line(0)).toBe(first.line(0));
  });
});
