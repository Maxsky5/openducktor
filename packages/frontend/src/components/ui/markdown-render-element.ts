import type { ReactElement } from "react";
import Markdown, { type Components, defaultUrlTransform, type UrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdownLinkUrlTransform, type MarkdownLinkPolicy } from "./markdown-link-policy";

const REMARK_PLUGINS = [remarkGfm];
const MARKDOWN_URL_TRANSFORM: UrlTransform = (url) => defaultUrlTransform(url);
const MAX_CACHED_ELEMENTS_PER_COMPONENT_SET = 200;
const MAX_CACHED_MARKDOWN_LENGTH = 50_000;

const elementCacheByComponents = new WeakMap<Components, Map<string, ReactElement>>();

const readElementCache = (components: Components): Map<string, ReactElement> => {
  const existing = elementCacheByComponents.get(components);
  if (existing) return existing;
  const created = new Map<string, ReactElement>();
  elementCacheByComponents.set(components, created);
  return created;
};

export const renderMarkdownElement = ({
  markdown,
  components,
  linkPolicy,
}: {
  markdown: string;
  components: Components;
  linkPolicy?: MarkdownLinkPolicy | undefined;
}): ReactElement => {
  const cache = readElementCache(components);
  const cached = cache.get(markdown);
  if (cached) {
    cache.delete(markdown);
    cache.set(markdown, cached);
    return cached;
  }

  const element = Markdown({
    children: markdown,
    components,
    remarkPlugins: REMARK_PLUGINS,
    skipHtml: true,
    urlTransform: markdownLinkUrlTransform(MARKDOWN_URL_TRANSFORM, linkPolicy),
  });

  if (markdown.length <= MAX_CACHED_MARKDOWN_LENGTH) {
    cache.set(markdown, element);
    if (cache.size > MAX_CACHED_ELEMENTS_PER_COMPONENT_SET) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) {
        cache.delete(oldestKey);
      }
    }
  }

  return element;
};
