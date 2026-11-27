import { createHtmlSession } from "@pierre/words";
import { createHtmlRenderer, type HtmlOptions } from "@pierre/words/html";
import { type MarkdownLocalLinks, renderMarkdownLocalLink } from "./markdown-html";

const MAX_PATH_LENGTH = 255;
const RELATIVE_FILE = /^(?:[\w.-]+\/)+[\w.-]*\.[a-z\d]{1,12}(?::[1-9]\d*(?::[1-9]\d*)?)?$/i;
const DOT_SEGMENT = /(?:^|\/)\.{1,2}\//;
const WEB_ADDRESS = /^www\./i;

// Skip links and fences. Words marks its own elements in formatted output.
const HTML_TOKENS =
  /<(a|pre)(?=[ >])[^>]*>[\s\S]*?<\/\1>|<(p|li|h[1-6]|th|td)(?=[ >])[^>]*>|<code(?: data-markdown="code")?>([^<]*)<\/code>/g;
const BLOCK_TAGS = /<(p|li|h[1-6]|th|td)(?=[ >])[^>]*>/g;
const MARKED_BLOCK_TAGS = /<(p|li|h[1-6]|th|td) data-markdown="\1"(?=[ >])/g;
const POSSIBLE_FILE_CODE = /<code data-markdown="code">[\w.-]+\//;

type Cursor = { offset: number; block: number; tag: string; code: number };
type FileSpan = Cursor & { markup: string; path: string };

function* fileSpans(html: string, from: Cursor, formatted: boolean): Generator<FileSpan> {
  let { block, tag, code } = from;
  for (const match of html.slice(from.offset).matchAll(HTML_TOKENS)) {
    const [markup, , blockTag, path] = match;
    if (blockTag) {
      if (formatted && !markup.startsWith(`<${blockTag} data-markdown="${blockTag}"`)) continue;
      block++;
      tag = blockTag;
      code = 0;
    }
    if (path === undefined) continue;
    code++;
    if (
      path.length <= MAX_PATH_LENGTH &&
      !WEB_ADDRESS.test(path) &&
      RELATIVE_FILE.test(path) &&
      !DOT_SEGMENT.test(path.startsWith("./") ? path.slice(2) : path)
    ) {
      yield { markup, path, block, tag, code, offset: from.offset + match.index + markup.length };
    }
  }
}

const startOfHtml = (block: number): Cursor => ({ offset: 0, block, tag: "", code: 0 });
const positionDifference = (left: Cursor, right: Cursor): number =>
  left.block - right.block || left.code - right.code;

/** Count preceding blocks even when the two renderers choose different pending boundaries. */
function stableBlockCount(tags: RegExp) {
  let previous = "";
  let blocks = 0;
  return (stable: string): number => {
    if (stable === previous) return blocks;
    const append = stable.startsWith(previous);
    if (!append) blocks = 0;
    for (const _tag of stable.slice(append ? previous.length : 0).matchAll(tags)) blocks++;
    previous = stable;
    return blocks;
  };
}

function linkCompleteHtml(html: string, chip: MarkdownLocalLinks["chip"]): string {
  if (!POSSIBLE_FILE_CODE.test(html)) return html;
  let offset = 0;
  let linked = "";
  for (const span of fileSpans(html, startOfHtml(0), true)) {
    linked +=
      html.slice(offset, span.offset - span.markup.length) +
      renderMarkdownLocalLink(span.path, span.markup, chip, "inline-code");
    offset = span.offset;
  }
  return offset === 0 ? html : linked + html.slice(offset);
}

type HtmlRenderer = ReturnType<typeof createHtmlRenderer>;
type HtmlUpdate = ReturnType<HtmlRenderer["render"]>;
type CheckedPrefix = {
  displayBlocks: number;
  strictBlocks: number;
  display: Cursor;
  strict: Cursor;
  displayHtml: string;
  strictHtml: string;
  linked: string;
};

/** Decorate Words' updates without replacing its completed DOM or its text and fence deltas. */
export function createInlineFileLinkRenderer(
  initial: HtmlOptions,
  initialChip: MarkdownLocalLinks["chip"],
): HtmlRenderer & { setLinkChip(chip: MarkdownLocalLinks["chip"]): void } {
  const renderer = createHtmlRenderer(initial);
  let options = initial;
  let chip = initialChip;
  let verification:
    | {
        strict: ReturnType<typeof createHtmlSession>;
        countDisplayBlocks: ReturnType<typeof stableBlockCount>;
        countStrictBlocks: ReturnType<typeof stableBlockCount>;
      }
    | undefined;
  let previousSource = "";
  let hasBackticks = false;
  let previous: HtmlUpdate | undefined;
  let result: HtmlUpdate | undefined;
  let checked: CheckedPrefix | undefined;

  function linkPending(update: HtmlUpdate, source: string, incomplete: boolean): string {
    const html = update.pending;
    if (!incomplete) return linkCompleteHtml(html, chip);
    if (!POSSIBLE_FILE_CODE.test(html)) {
      checked = undefined;
      return html;
    }
    verification ??= {
      strict: createHtmlSession(),
      countDisplayBlocks: stableBlockCount(MARKED_BLOCK_TAGS),
      countStrictBlocks: stableBlockCount(BLOCK_TAGS),
    };
    const verified = verification.strict.render(source, {
      incomplete: false,
      math: options.math ?? false,
      cjk: options.cjk ?? false,
    });
    const strictHtml = verified.pending;
    const displayBlocks = verification.countDisplayBlocks(update.stable);
    const strictBlocks = verification.countStrictBlocks(verified.stable);
    const prefix =
      checked &&
      checked.displayBlocks === displayBlocks &&
      checked.strictBlocks === strictBlocks &&
      html.startsWith(checked.displayHtml) &&
      strictHtml.startsWith(checked.strictHtml)
        ? checked
        : undefined;
    checked = prefix;
    let offset = prefix?.display.offset ?? 0;
    let linked = prefix?.linked ?? "";
    const confirmed = fileSpans(strictHtml, prefix?.strict ?? startOfHtml(strictBlocks), false);
    let match = confirmed.next().value;
    let lastMatch: { display: Cursor; strict: Cursor } | undefined;

    // Block and code ordinals identify occurrences. Equal paths can appear in different blocks,
    // including a tentative span in the reply body before a completed span in the footnotes.
    for (const span of fileSpans(html, prefix?.display ?? startOfHtml(displayBlocks), true)) {
      while (match && positionDifference(match, span) < 0) match = confirmed.next().value;
      if (
        !match ||
        positionDifference(match, span) !== 0 ||
        match.tag !== span.tag ||
        match.path !== span.path
      ) {
        continue;
      }
      linked +=
        html.slice(offset, span.offset - span.markup.length) +
        renderMarkdownLocalLink(span.path, span.markup, chip, "inline-code");
      offset = span.offset;
      lastMatch = { display: span, strict: match };
    }
    if (lastMatch) {
      checked = {
        ...lastMatch,
        displayBlocks,
        strictBlocks,
        displayHtml: html.slice(0, lastMatch.display.offset),
        strictHtml: strictHtml.slice(0, lastMatch.strict.offset),
        linked,
      };
    }
    return offset === 0 ? html : linked + html.slice(offset);
  }

  return {
    setLinkChip(next) {
      if (chip !== next) checked = undefined;
      chip = next;
    },
    configure(next, reset) {
      options = next;
      renderer.configure(next, reset);
    },
    render(source, incomplete, active) {
      const update = renderer.render(source, incomplete, active);
      if (update === previous && result) return result;
      const append = source.startsWith(previousSource);
      if (!append || !hasBackticks) {
        hasBackticks = source.includes("`", append ? previousSource.length : 0);
      }
      if (!append || update.reset || !incomplete) checked = undefined;
      if (!incomplete) verification = undefined;
      previousSource = source;
      previous = update;
      if (!hasBackticks) {
        result = update;
        return update;
      }

      const addition = update.reset ? "" : linkCompleteHtml(update.addition, chip);
      const stable = update.reset
        ? linkCompleteHtml(update.stable, chip)
        : (result?.stable ?? "") + addition;
      let pending: string | undefined;
      // Keep pending lazy so a Words delta can append text or update an open fence in place.
      result = {
        stable,
        addition,
        reset: update.reset,
        revision: update.revision,
        get pending() {
          return (pending ??= linkPending(update, source, incomplete));
        },
        get html() {
          return stable + this.pending;
        },
      };
      Object.setPrototypeOf(result, update);
      return result;
    },
    dispose: renderer.dispose,
  };
}
