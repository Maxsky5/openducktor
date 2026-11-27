import { createHtmlSession } from "@pierre/words";
import { createHtmlRenderer, type HtmlOptions } from "@pierre/words/html";
import { type MarkdownLocalLinks, renderMarkdownLocalLink } from "./markdown-html";

const MAX_PATH_LENGTH = 255;
// Limit the source check to code spans that could contain a relative path. It can overmatch.
const POSSIBLE_PATH_SPAN = /`(?:\r\n|[ \r\n])?[\w.-]+\/[\w./:-]{1,254}(?:\r\n|[ \r\n])?`/;
const RELATIVE_FILE = /^(?:[\w.-]+\/)+[\w.-]*\.[a-z\d]{1,12}(?::[1-9]\d*(?::[1-9]\d*)?)?$/i;
const DOT_SEGMENT = /(?:^|\/)\.{1,2}\//;

// Both Words' plain session and its HTML formatter emit these tags. Skip whole links and fences.
const CODE_SPAN =
  /<(a|pre)(?=[ >])[^>]*>[\s\S]*?<\/\1>|<code(?: data-markdown="code")?>([^<]*)<\/code>/g;

function* fileSpans(html: string) {
  if (!html.includes("<code")) return;
  for (const match of html.matchAll(CODE_SPAN)) {
    const path = match[2];
    if (
      path &&
      path.length <= MAX_PATH_LENGTH &&
      RELATIVE_FILE.test(path) &&
      !DOT_SEGMENT.test(path.startsWith("./") ? path.slice(2) : path)
    ) {
      yield { markup: match[0], index: match.index, path };
    }
  }
}

function linkFileSpans(
  html: string,
  chip: MarkdownLocalLinks["chip"],
  verify?: () => string,
): string {
  let confirmed: ReturnType<typeof fileSpans> | undefined;
  let start = 0;
  let linked = "";
  for (const { markup, index, path } of fileSpans(html)) {
    if (verify) {
      confirmed ??= fileSpans(verify());
      // Incomplete Markdown can add a code span at the end that has no closing backtick.
      if (confirmed.next().value?.path !== path) break;
    }
    linked += html.slice(start, index) + renderMarkdownLocalLink(path, markup, chip, "inline-code");
    start = index + markup.length;
  }
  return start === 0 ? html : linked + html.slice(start);
}

type HtmlRenderer = ReturnType<typeof createHtmlRenderer>;
type HtmlUpdate = ReturnType<HtmlRenderer["render"]>;

/** Decorate Words' own updates so it can keep the completed DOM and apply only its normal delta. */
export function createInlineFileLinkRenderer(
  initial: HtmlOptions,
  initialChip: MarkdownLocalLinks["chip"],
): HtmlRenderer & { setLinkChip(chip: MarkdownLocalLinks["chip"]): void } {
  const renderer = createHtmlRenderer(initial);
  let chip = initialChip;
  let options = initial;
  let strict: ReturnType<typeof createHtmlSession> | undefined;
  let previousSource = "";
  let mayHaveFileSpans = false;
  let previous: HtmlUpdate | undefined;
  let result: HtmlUpdate | undefined;

  return {
    setLinkChip(next) {
      chip = next;
    },
    configure(next, reset) {
      options = next;
      renderer.configure(next, reset);
    },
    render(source, incomplete, active) {
      if (!incomplete) strict = undefined;
      const update = renderer.render(source, incomplete, active);
      if (update === previous && result) return result;
      const append = source.startsWith(previousSource);
      if (!append || !mayHaveFileSpans) {
        // A newly closed span can cross the update boundary by at most its own length.
        const start = append ? Math.max(0, previousSource.length - MAX_PATH_LENGTH - 6) : 0;
        mayHaveFileSpans = POSSIBLE_PATH_SPAN.test(source.slice(start));
      }
      previousSource = source;
      previous = update;
      if (!mayHaveFileSpans) {
        result = update;
        return update;
      }

      const addition = update.reset ? "" : linkFileSpans(update.addition, chip);
      const stable = update.reset
        ? linkFileSpans(update.stable, chip)
        : (result?.stable ?? "") + addition;
      let pending: string | undefined;
      const verify = incomplete
        ? () => {
            strict ??= createHtmlSession();
            return strict.render(source, { incomplete: false, math: options.math ?? false })
              .pending;
          }
        : undefined;
      // Inherit Words' update fields, including its text and fenced-code deltas. Keep pending
      // lazy so Words can append a line to a large open fence without building all of its HTML.
      result = {
        stable,
        addition,
        reset: update.reset,
        revision: update.revision,
        get pending() {
          return (pending ??= linkFileSpans(update.pending, chip, verify));
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
