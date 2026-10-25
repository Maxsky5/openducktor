/**
 * The shared code of the block pages. It renders one Markdown block with micromark, GFM, and
 * KaTeX math, then reports its height. micromark escapes raw HTML and removes unsafe link
 * protocols. A link press goes to the app, which applies its link policy. Each block page has a
 * CSS entry beside it that imports the KaTeX styles and `block-page.css`.
 */
import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";
import { math, mathHtml } from "micromark-extension-math";
import {
  BLOCK_PAGE_CHANNEL,
  type BlockPageOutboundMessage,
  type BlockRenderMessage,
} from "../../block-page-messages";
import {
  observePageSize,
  pageDocument,
  pageRoot,
  type PageElement,
  startPageChannel,
} from "./page-runtime";

/**
 * Replaces the diagram code blocks in `root` with diagrams in the colors of `message`. It returns
 * false when `isCurrent` turns false during the work, because a newer message replaces the render.
 */
export type DiagramRenderer = (
  root: PageElement,
  message: BlockRenderMessage,
  isCurrent: () => boolean,
) => Promise<boolean>;

/** A picture of the rendered block, or null when the block is not a single picture. */
export type BlockSnapshotter = (
  root: PageElement,
) => Promise<Omit<Extract<BlockPageOutboundMessage, { type: "block_snapshot" }>, "type"> | null>;

const MAX_ERROR_LENGTH = 4_000;

/** The faces of `block-page.css`. The page lays out text in them, so they load first. */
const PAGE_FONTS = [
  '400 16px "Space Grotesk"',
  '500 16px "Space Grotesk"',
  '600 16px "Space Grotesk"',
  '500 16px "IBM Plex Mono"',
];

export const startBlockPage = (
  renderDiagrams: DiagramRenderer | null,
  snapshot: BlockSnapshotter | null = null,
): void => {
  const root = pageRoot();
  const fontsLoaded = Promise.all(PAGE_FONTS.map((font) => pageDocument.fonts.load(font)));
  let lastHeight = -1;
  let latest: BlockRenderMessage | null = null;
  let rendering = false;

  const fail = (message: string, id?: number): void => {
    post({
      type: "block_error",
      id,
      message: message.slice(0, MAX_ERROR_LENGTH) || "The block did not render.",
    });
  };

  const post = startPageChannel(BLOCK_PAGE_CHANNEL, {
    onMessage: (message) => {
      latest = message;
      if (!rendering) void renderLatest();
    },
    onFailure: fail,
  });

  const reportSize = (): void => {
    const height = Math.ceil(root.getBoundingClientRect().height);
    if (height === lastHeight) return;
    lastHeight = height;
    post({ type: "block_size", height });
  };

  const render = async (message: BlockRenderMessage): Promise<void> => {
    await fontsLoaded;
    applyTheme(message);
    // micromark escapes raw HTML and empties unsafe link destinations, and the page policy runs
    // only the page script.
    // react-doctor-disable-next-line react-doctor/dangerous-html-sink
    root.innerHTML = micromark(message.markdown, {
      extensions: [gfm(), math()],
      // As on desktop, a formula that KaTeX cannot read shows its source in the error color, with
      // the error as its title. The rest of the block still renders.
      htmlExtensions: [
        gfmHtml(),
        mathHtml({ throwOnError: false, errorColor: message.colors.error }),
      ],
    });
    replaceImages(root);
    const current =
      renderDiagrams === null || (await renderDiagrams(root, message, () => latest === null));
    if (!current) return;
    // The app keys each height by its render message, so each message gets a size reply, also
    // when the height stays the same.
    lastHeight = -1;
    reportSize();
    if (snapshot === null) return;
    const picture = await snapshot(root);
    // A newer message replaces this render, so its picture would be out of date.
    if (picture !== null && latest === null) post({ type: "block_snapshot", ...picture });
  };

  /** Renders one message at a time. Messages that arrive during a render keep only the newest. */
  const renderLatest = async (): Promise<void> => {
    rendering = true;
    while (latest !== null) {
      const message = latest;
      latest = null;
      try {
        await render(message);
      } catch (cause) {
        fail(cause instanceof Error ? cause.message : String(cause), message.id);
      }
    }
    rendering = false;
  };

  root.addEventListener("click", (event) => {
    const anchor = event.target?.closest("a") ?? null;
    if (anchor === null) return;
    event.preventDefault();
    // micromark empties an unsafe destination, so the app shows why it stays closed.
    const href = anchor.getAttribute("href");
    if (href !== null) post({ type: "link", url: href });
  });
  observePageSize(root, reportSize);
};

const applyTheme = ({
  colors,
  theme,
  variant,
  fontSize,
  lineHeight,
  italic,
  fontScale,
}: BlockRenderMessage): void => {
  const element = pageDocument.documentElement;
  element.setAttribute("data-variant", variant);
  const style = element.style;
  style.setProperty("color-scheme", theme);
  style.setProperty("--font-size", `${fontSize}px`);
  style.setProperty("--line-height", String(lineHeight / fontSize));
  style.setProperty("--font-scale", String(fontScale));
  style.setProperty("--font-style", italic ? "italic" : "normal");
  style.setProperty("--label", colors.label);
  style.setProperty("--secondary-label", colors.secondaryLabel);
  style.setProperty("--foreground", colors.foreground);
  style.setProperty("--code", colors.code);
  style.setProperty("--separator", colors.separator);
  style.setProperty("--list-number", colors.listNumber);
  style.setProperty("--list-bullet", colors.listBullet);
  style.setProperty("--table-rule", colors.tableRule);
  style.setProperty("--table-header-rule", colors.tableHeaderRule);
  style.setProperty("--code-background", colors.codeBackground);
};

/** Images cannot load in the page, so each one shows its alt text. */
const replaceImages = (root: PageElement): void => {
  for (const image of Array.from(root.querySelectorAll("img"))) {
    const alt = pageDocument.createElement("span");
    alt.textContent = `[${image.getAttribute("alt") || "Image"}]`;
    image.replaceWith(alt);
  }
};
