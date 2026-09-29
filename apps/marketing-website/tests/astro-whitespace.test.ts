import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const INLINE = "(?:a|abbr|b|cite|code|em|i|kbd|mark|q|s|samp|small|span|strong|sub|sup|time|u|var)";
const openInline = new RegExp(`^<${INLINE}[\\s>]`);
const closeInline = new RegExp(`</${INLINE}>$`);
const textEnd = /[\w.,;:!?)\]'"%*+/-]$/;
const textStart = /^[\w(["'.,;:!?%*+/-]/;

function astroFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return astroFiles(path);
    return entry.name.endsWith(".astro") ? [path] : [];
  });
}

/** The markup lines of a component. Frontmatter, script, and style lines are undefined. */
function markupLines(source: string): (string | undefined)[] {
  const lines: (string | undefined)[] = source.split("\n");
  const fence = lines.indexOf("---", 1);
  if (lines[0] === "---" && fence > 0) lines.fill(undefined, 0, fence + 1);
  let block = false;
  return lines.map((line) => {
    if (line === undefined) return undefined;
    if (/^\s*<(script|style)\b/.test(line)) block = true;
    const markup = block ? undefined : line.trim();
    if (/<\/(script|style)>/.test(line)) block = false;
    return markup;
  });
}

/**
 * Astro 7 renders with compressHTML "jsx". A line break between text and an inline element then
 * renders no space. Prettier breaks long lines at these places, so the text must end with {" "}.
 */
function gluedBreaks(path: string): string[] {
  const lines = markupLines(readFileSync(path, "utf8"));
  const found: string[] = [];
  lines.forEach((line, index) => {
    const next = lines[index + 1];
    if (!line || !next || line.startsWith("{") || line.endsWith("}") || next.startsWith("{"))
      return;
    const textThenElement = textEnd.test(line) && !line.endsWith(">") && openInline.test(next);
    const elementThenText = closeInline.test(line) && textStart.test(next);
    if (textThenElement || elementThenText) found.push(`${path}:${index + 1}: ${line} / ${next}`);
  });
  return found;
}

test("a line break between text and an inline element keeps its space", () => {
  const sources = fileURLToPath(new URL("../src", import.meta.url));
  expect(astroFiles(sources).flatMap(gluedBreaks)).toEqual([]);
});
