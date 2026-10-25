/**
 * Syntax highlighting with `refractor` for the languages that desktop registers through
 * `react-syntax-highlighter`. Tokens build outside render, line by line, and stay in a bounded
 * cache keyed by a content hash. An unknown language shows plain text.
 *
 * `highlightLines` highlights in chunks of `HIGHLIGHT_CHUNK_LINES` lines, only when a caller asks
 * for a line of that chunk. A virtualized file view then highlights only the rows it shows. A token
 * that crosses a chunk edge, such as a long block comment, can lose its color at that edge.
 */
import { refractor } from "refractor/core";
import bash from "refractor/bash";
import diff from "refractor/diff";
import javascript from "refractor/javascript";
import json from "refractor/json";
import jsx from "refractor/jsx";
import markdown from "refractor/markdown";
import rust from "refractor/rust";
import tsx from "refractor/tsx";
import typescript from "refractor/typescript";
import yaml from "refractor/yaml";
import { contentHash, createHostContentCache, LruCache } from "../lru-cache";
import { ONE_TOKEN_TONES, type OneTone } from "./one-theme";

for (const syntax of [bash, diff, javascript, json, jsx, markdown, rust, tsx, typescript, yaml]) {
  refractor.register(syntax);
}

export type CodeLanguage =
  | "bash"
  | "diff"
  | "javascript"
  | "json"
  | "jsx"
  | "markdown"
  | "rust"
  | "tsx"
  | "typescript"
  | "yaml";

const CODE_LANGUAGES: ReadonlySet<string> = new Set<CodeLanguage>([
  "bash",
  "diff",
  "javascript",
  "json",
  "jsx",
  "markdown",
  "rust",
  "tsx",
  "typescript",
  "yaml",
]);

// The desktop aliases.
const LANGUAGE_ALIASES = new Map<string, CodeLanguage>([
  ["cjs", "javascript"],
  ["js", "javascript"],
  ["mjs", "javascript"],
  ["sh", "bash"],
  ["shell", "bash"],
  ["ts", "typescript"],
  ["yml", "yaml"],
]);

const FILE_EXTENSION_LANGUAGES = new Map<string, CodeLanguage>([
  ["bash", "bash"],
  ["cjs", "javascript"],
  ["cts", "typescript"],
  ["diff", "diff"],
  ["js", "javascript"],
  ["json", "json"],
  ["jsonc", "json"],
  ["jsx", "jsx"],
  ["markdown", "markdown"],
  ["md", "markdown"],
  ["mdx", "markdown"],
  ["mjs", "javascript"],
  ["mts", "typescript"],
  ["patch", "diff"],
  ["rs", "rust"],
  ["sh", "bash"],
  ["ts", "typescript"],
  ["tsx", "tsx"],
  ["yaml", "yaml"],
  ["yml", "yaml"],
  ["zsh", "bash"],
]);

const isCodeLanguage = (value: string): value is CodeLanguage => CODE_LANGUAGES.has(value);

/**
 * The supported language of a fence info string or language name, such as `ts title="a.ts"`.
 * Returns `null` for an unknown language, which shows as plain text.
 */
export const normalizeLanguage = (language?: string | null): CodeLanguage | null => {
  const name = language?.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? "";
  const resolved = LANGUAGE_ALIASES.get(name) ?? name;
  return isCodeLanguage(resolved) ? resolved : null;
};

/** The supported language of a file path from its extension, or `null` for plain text. */
export const languageForFilePath = (path: string): CodeLanguage | null => {
  const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  return FILE_EXTENSION_LANGUAGES.get(name.slice(dot + 1).toLowerCase()) ?? null;
};

/** A theme color role for a token. The code views map each tone to a theme color. */
export type HighlightTone =
  | "plain"
  | "comment"
  | "keyword"
  | "string"
  | "number"
  | "function"
  | "type"
  | "tag"
  | "attribute"
  | "punctuation"
  | "variable"
  | "inserted"
  | "deleted";

type HighlightToken = { readonly text: string; readonly tone: HighlightTone };
export type HighlightedLine = readonly HighlightToken[];

/**
 * The text of a line with no token or one plain token, as each line of code without highlight,
 * or null for a highlighted line. A row can show such a line without one text node per token.
 */
export const plainLineText = (line: HighlightedLine): string | null => {
  const first = line[0];
  if (first === undefined) return "";
  return line.length === 1 && first.tone === "plain" ? first.text : null;
};

/** A token of the desktop One Light and One Dark themes, for Markdown code blocks. */
type OneToken = { readonly text: string; readonly tone: OneTone };
export type OneHighlightedLine = readonly OneToken[];

/** Highlighted code whose tokens have tones of type `Tone`. */
type HighlightedLines<Tone extends string> = {
  readonly language: CodeLanguage | null;
  readonly lineCount: number;
  lineText(index: number): string;
  /** The tokens of one line. The first call for a line highlights its chunk. */
  line(index: number): readonly { readonly text: string; readonly tone: Tone }[];
};

export type HighlightedCode = HighlightedLines<HighlightTone>;
export type OneHighlightedCode = HighlightedLines<OneTone>;

export const HIGHLIGHT_CHUNK_LINES = 200;
const MAX_CACHED_CODE = 64;
const MAX_CACHED_CHUNKS = 48;
const EMPTY_LINE: readonly never[] = [];

const PRISM_TONES = new Map<string, HighlightTone>([
  ["comment", "comment"],
  ["prolog", "comment"],
  ["doctype", "comment"],
  ["cdata", "comment"],
  ["shebang", "comment"],
  ["keyword", "keyword"],
  ["atrule", "keyword"],
  ["important", "keyword"],
  ["coord", "keyword"],
  ["title", "keyword"],
  ["selector", "keyword"],
  ["string", "string"],
  ["char", "string"],
  ["attr-value", "string"],
  ["template-string", "string"],
  ["url", "string"],
  ["regex", "string"],
  ["code", "string"],
  ["number", "number"],
  ["boolean", "number"],
  ["constant", "number"],
  ["symbol", "number"],
  ["function", "function"],
  ["function-variable", "function"],
  ["method", "function"],
  ["macro", "function"],
  ["class-name", "type"],
  ["builtin", "type"],
  ["namespace", "type"],
  ["lifetime-annotation", "type"],
  ["tag", "tag"],
  ["attr-name", "attribute"],
  ["property", "attribute"],
  ["key", "attribute"],
  ["operator", "punctuation"],
  ["punctuation", "punctuation"],
  ["entity", "punctuation"],
  ["variable", "variable"],
  ["parameter", "variable"],
  ["inserted", "inserted"],
  ["deleted", "deleted"],
]);

type HastRoot = ReturnType<typeof refractor.highlight>;
type HastNode = HastRoot["children"][number];
type MutableToken<Tone extends string> = { text: string; tone: Tone };

/** How a highlight names the tone of a Prism token class, and the tone of text outside tokens. */
type ToneScheme<Tone extends string> = {
  readonly classes: ReadonlyMap<string, Tone>;
  readonly plain: Tone;
};

const APP_SCHEME: ToneScheme<HighlightTone> = { classes: PRISM_TONES, plain: "plain" };
const ONE_SCHEME: ToneScheme<OneTone> = { classes: ONE_TOKEN_TONES, plain: "base" };

const toneOf = <Tone extends string>(
  node: Extract<HastNode, { type: "element" }>,
  inherited: Tone,
  scheme: ToneScheme<Tone>,
): Tone => {
  const classes = node.properties["className"];
  if (!Array.isArray(classes)) return inherited;
  for (const name of classes) {
    const tone = scheme.classes.get(String(name));
    if (tone !== undefined) return tone;
  }
  return inherited;
};

/** Splits highlighted code into exactly `lineCount` token lines. */
const tokenizeLines = <Tone extends string>(
  code: string,
  language: CodeLanguage,
  lineCount: number,
  scheme: ToneScheme<Tone>,
): (readonly MutableToken<Tone>[])[] => {
  const lines: MutableToken<Tone>[][] = [[]];
  const push = (text: string, tone: Tone): void => {
    for (const [index, part] of text.split("\n").entries()) {
      if (index > 0) lines.push([]);
      const line = lines.at(-1);
      if (part.length === 0 || line === undefined) continue;
      const last = line.at(-1);
      if (last?.tone === tone) last.text += part;
      else line.push({ text: part, tone });
    }
  };
  const visit = (node: HastNode, tone: Tone): void => {
    if (node.type === "text") push(node.value, tone);
    if (node.type !== "element") return;
    const own = toneOf(node, tone, scheme);
    for (const child of node.children) visit(child, own);
  };
  for (const node of refractor.highlight(code, language).children) visit(node, scheme.plain);
  return Array.from({ length: lineCount }, (_, index) => lines[index] ?? EMPTY_LINE);
};

const createHighlightedCode = <Tone extends string>(
  code: string,
  language: CodeLanguage | null,
  scheme: ToneScheme<Tone>,
): HighlightedLines<Tone> => {
  type Line = readonly MutableToken<Tone>[];
  const plainLine = (text: string): Line =>
    text.length === 0 ? EMPTY_LINE : [{ text, tone: scheme.plain }];
  const texts = code.replace(/\r\n?/g, "\n").split("\n");
  // A final line break ends the last line; it does not start an empty one.
  if (texts.length > 1 && texts.at(-1) === "") texts.pop();
  const chunks = new LruCache<number, Line[]>(MAX_CACHED_CHUNKS);
  const readChunk = (chunkIndex: number): Line[] => {
    const cached = chunks.get(chunkIndex);
    if (cached !== undefined) return cached;
    const start = chunkIndex * HIGHLIGHT_CHUNK_LINES;
    const chunkTexts = texts.slice(start, start + HIGHLIGHT_CHUNK_LINES);
    const lines =
      language === null
        ? chunkTexts.map(plainLine)
        : tokenizeLines(chunkTexts.join("\n"), language, chunkTexts.length, scheme);
    chunks.set(chunkIndex, lines);
    return lines;
  };
  return {
    language,
    lineCount: texts.length,
    lineText: (index) => texts[index] ?? "",
    line: (index) => {
      if (index < 0 || index >= texts.length) return EMPTY_LINE;
      const chunkIndex = Math.floor(index / HIGHLIGHT_CHUNK_LINES);
      return readChunk(chunkIndex)[index - chunkIndex * HIGHLIGHT_CHUNK_LINES] ?? EMPTY_LINE;
    },
  };
};

type CachedCode<Tone extends string> = {
  readonly code: string;
  readonly highlighted: HighlightedLines<Tone>;
};
const highlightedCode = createHostContentCache<string, CachedCode<HighlightTone>>(MAX_CACHED_CODE);
const oneHighlightedCode = createHostContentCache<string, CachedCode<OneTone>>(MAX_CACHED_CODE);

/** The line-oriented highlight of `code`. Equal code and language share one cached result. */
export const highlightLines = (code: string, language?: string | null): HighlightedCode => {
  const normalized = normalizeLanguage(language);
  const key = `${normalized ?? "text"}:${contentHash(code)}`;
  const cached = highlightedCode.get(key);
  if (cached?.code === code) return cached.highlighted;
  const highlighted = createHighlightedCode(code, normalized, APP_SCHEME);
  highlightedCode.set(key, { code, highlighted });
  return highlighted;
};

/** The highlight of `code` in the desktop One themes, for a Markdown code block. */
export const highlightOneLines = (code: string, language?: string | null): OneHighlightedCode => {
  const normalized = normalizeLanguage(language);
  const key = `${normalized ?? "text"}:${contentHash(code)}`;
  const cached = oneHighlightedCode.get(key);
  if (cached?.code === code) return cached.highlighted;
  const highlighted = createHighlightedCode(code, normalized, ONE_SCHEME);
  oneHighlightedCode.set(key, { code, highlighted });
  return highlighted;
};
