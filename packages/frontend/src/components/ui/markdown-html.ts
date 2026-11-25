/**
 * The HTML hooks and URL rules that the Markdown views give to `@pierre/words`. Words writes each
 * element as an HTML string, and a hook returns the HTML that replaces it.
 */
import type { Components, IslandData } from "@pierre/words/react";
import { escapeHtml } from "@pierre/words/html";
import { z } from "zod";
import { CHECKBOX_CLASS_NAME } from "./checkbox";

/** A link that the app opens itself, such as a file of the worktree in a chat reply. */
export type MarkdownLocalLinks = {
  handles(href: string): boolean;
  open(href: string, anchor: HTMLAnchorElement): void;
};

/** How the links of a view open. `text` shows each link as plain text. */
export type MarkdownLinks = "text" | { open?: (href: string) => void; local?: MarkdownLocalLinks };

/**
 * How the images of a view show. `host` mounts the images that the host loads as islands, and
 * `label` shows each image as a chip with its text.
 */
export type MarkdownImageMode = "host" | "label";

const hostImageDataSchema = z.object({
  id: z.string(),
  src: z.string(),
  alt: z.string(),
  title: z.string(),
});

export type MarkdownHostImageData = z.infer<typeof hostImageDataSchema>;

/** Reads the data of a host image island, which Words reads back from the page. */
export const parseHostImageData = (data: IslandData): MarkdownHostImageData | null => {
  const parsed = hostImageDataSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
};

/** The island that shows a host image. Its component loads the image through the host. */
export const HOST_IMAGE_ISLAND = "odt-image";

// Words keeps a URL that starts with `#`. The hooks below read the original URL back.
const HOST_IMAGE_PREFIX = "#odt-image:";
const LOCAL_LINK_PREFIX = "#odt-link:";

/** The attribute that holds the destination of a local link. The link itself points nowhere. */
export const LOCAL_LINK_ATTRIBUTE = "data-local-link";

/**
 * Marks the URLs that the view handles itself. Words then checks each URL with its default rule,
 * which drops unsafe schemes.
 */
export const createMarkdownUrlTransform =
  (isHostImage: (src: string) => boolean, local: MarkdownLocalLinks | null) =>
  (url: string, key: "href" | "src"): string => {
    if (key === "src") {
      return isHostImage(url) ? HOST_IMAGE_PREFIX + encodeURIComponent(url) : url;
    }
    return local?.handles(url) ? LOCAL_LINK_PREFIX + encodeURIComponent(url) : url;
  };

const ATTRIBUTE = /\s([a-z-]+)="([^"]*)"/g;
const ENTITIES = new Map([
  ["&amp;", "&"],
  ["&lt;", "<"],
  ["&gt;", ">"],
  ["&quot;", '"'],
  ["&#39;", "'"],
]);

/** The attributes of the first tag of `html`, decoded from the entities that Words writes. */
const readTagAttributes = (html: string): ReadonlyMap<string, string> => {
  const attributes = new Map<string, string>();
  for (const [, name, value] of html.slice(0, html.indexOf(">")).matchAll(ATTRIBUTE)) {
    if (name !== undefined && value !== undefined) {
      attributes.set(
        name,
        value.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ENTITIES.get(entity) ?? entity),
      );
    }
  }
  return attributes;
};

const innerHtml = (html: string): string =>
  html.slice(html.indexOf(">") + 1, html.lastIndexOf("</"));

/**
 * Words mounts a registered React island in this markup. It is the inline island markup of
 * `@pierre/words` 0.3.0, so a test checks it on each upgrade. A key that starts with `[` gives
 * each copy of the same image its own island.
 */
const islandHtml = (name: string, data: MarkdownHostImageData): string =>
  `<span data-words-island="${escapeHtml(name)}" data-words-island-id="${escapeHtml(data.id)}"` +
  ` data-words-island-data="${escapeHtml(JSON.stringify(data))}">` +
  "<span data-words-island-content></span><span data-words-island-fallback></span></span>";

const hostImageHtml = (html: string): string => {
  const attributes = readTagAttributes(html);
  const marked = attributes.get("src") ?? "";
  if (!marked.startsWith(HOST_IMAGE_PREFIX)) return html;
  const src = decodeURIComponent(marked.slice(HOST_IMAGE_PREFIX.length));
  const alt = attributes.get("alt") ?? "";
  const title = attributes.get("title") ?? "";
  return islandHtml(HOST_IMAGE_ISLAND, { id: JSON.stringify([src, alt, title]), src, alt, title });
};

const IMAGE_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-image size-3 shrink-0" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>';

const imageLabelHtml = (html: string): string => {
  const attributes = readTagAttributes(html);
  const label = attributes.get("alt")?.trim() || attributes.get("title")?.trim() || "Image";
  return (
    '<span class="mx-0.5 inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">' +
    `${IMAGE_ICON}<span class="min-w-0 truncate">${escapeHtml(label)}</span></span>`
  );
};

const CHECK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check size-3.5" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

/**
 * A GFM task item shows the look of the app checkbox. The Markdown source owns its state, so it
 * is a static, read-only box: a document can hold many items.
 */
const taskCheckboxHtml = (html: string): string => {
  const attributes = readTagAttributes(html);
  if (attributes.get("type") !== "checkbox") return html;
  const checked = attributes.has("checked");
  return (
    `<span role="checkbox" aria-checked="${checked}" aria-disabled="true" aria-label="${checked ? "Done" : "Not done"}"` +
    ` data-state="${checked ? "checked" : "unchecked"}" data-markdown-task=""` +
    ` class="${CHECKBOX_CLASS_NAME} mr-2 inline-flex align-middle border-muted-foreground/60">` +
    (checked
      ? `<span class="flex items-center justify-center text-current">${CHECK_ICON}</span>`
      : "") +
    "</span>"
  );
};

/** Keeps the destination of a local link off its navigation URL. */
const localLinkHtml = (html: string): string => {
  const href = readTagAttributes(html).get("href") ?? "";
  if (!href.startsWith(LOCAL_LINK_PREFIX)) return html;
  const destination = escapeHtml(decodeURIComponent(href.slice(LOCAL_LINK_PREFIX.length)));
  return html.replace(
    /^<a data-markdown="a" href="[^"]*"/,
    `<a data-markdown="a" href="#" ${LOCAL_LINK_ATTRIBUTE}="${destination}" title="${destination}"`,
  );
};

/** The element hooks of a view. A view passes only the hooks that its text can use. */
export const createMarkdownHooks = ({
  links,
  images,
  taskItems,
}: {
  /** `text` shows links as text. Local links open in the app. */
  links: "text" | MarkdownLocalLinks | null;
  images: MarkdownImageMode | null;
  taskItems: boolean;
}): Components => {
  const hooks: Components = {};
  if (taskItems) hooks.input = taskCheckboxHtml;
  if (links === "text") hooks.a = (html) => `<span>${innerHtml(html)}</span>`;
  else if (links) hooks.a = localLinkHtml;
  if (images === "label") hooks.img = imageLabelHtml;
  else if (images === "host") hooks.img = hostImageHtml;
  return hooks;
};
