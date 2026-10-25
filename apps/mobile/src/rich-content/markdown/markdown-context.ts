import { createContext, use, useSyncExternalStore } from "react";
import type { TaskImageContext } from "../images/image-source";
import type { MarkdownDefinitions } from "./markdown-document";

/**
 * The desktop Markdown variants. `document` is the chat answer and document text: 15-point text
 * with desktop heading sizes. `compact` is the desktop `prose-sm` text of reasoning, system
 * prompts, and previews: 13-point text with small headings and tight margins.
 */
export type MarkdownVariant = "document" | "compact";

/**
 * The desktop `markdown-renderer-components.tsx` classes. `document` is `prose text-sm
 * leading-relaxed` and `compact` is `prose-sm text-[13px] leading-relaxed`, each one step larger
 * on the phone: 15/24 and 14/22. Headings keep the `prose` em sizes of the document variant, and
 * `prose-headings:text-sm` in the compact variant.
 */
export const MARKDOWN_BODY = {
  document: { fontSize: 15, lineHeight: 24 },
  compact: { fontSize: 14, lineHeight: 22 },
} as const;

/**
 * How a Markdown text looks. `muted` draws all text in the muted foreground, as the desktop
 * reasoning and task previews. `italic` slants prose but not code, as the desktop reasoning.
 * `highlightCode` colors fenced code with the desktop One Light and One Dark themes; the desktop
 * chat shows plain code, and the desktop documents highlight it.
 */
export type MarkdownAppearance = {
  readonly variant: MarkdownVariant;
  readonly muted: boolean;
  readonly italic: boolean;
  readonly highlightCode: boolean;
};

export const DEFAULT_MARKDOWN_APPEARANCE: MarkdownAppearance = {
  variant: "document",
  muted: false,
  italic: false,
  highlightCode: true,
};

/**
 * Whether the list row of a Markdown text is in view. A list that tracks its rows passes it, so
 * only images and isolated pages render again when the row scrolls in or out.
 */
export type MarkdownVisibility = {
  readonly subscribe: (listener: () => void) => () => void;
  readonly isVisible: () => boolean;
};

/** What the parts of one Markdown block need from their view. */
export type MarkdownRenderContext = {
  readonly appearance: MarkdownAppearance;
  readonly definitions: MarkdownDefinitions;
  readonly openLink: (href: string) => void;
  readonly imageContext: TaskImageContext | null;
  /** Task images that an editor staged and the host has not saved yet: asset ID to device file. */
  readonly stagedImages: ReadonlyMap<string, string> | null;
  readonly selectable: boolean;
  /** The visibility of the list row, or null for a text that is always in view. */
  readonly visibility: MarkdownVisibility | null;
};

export const MarkdownContext = createContext<MarkdownRenderContext | null>(null);

export const useMarkdownContext = (): MarkdownRenderContext => {
  const context = use(MarkdownContext);
  if (context === null) throw new Error("Markdown parts render only inside MarkdownBlockView.");
  return context;
};

const subscribeToNothing = (): (() => void) => () => {};
const alwaysVisible = (): boolean => true;

/** False while the list row of the block is out of view, so images and pages wait. */
export const useMarkdownVisible = (): boolean => {
  const { visibility } = useMarkdownContext();
  const read = visibility?.isVisible ?? alwaysVisible;
  return useSyncExternalStore(visibility?.subscribe ?? subscribeToNothing, read, read);
};
