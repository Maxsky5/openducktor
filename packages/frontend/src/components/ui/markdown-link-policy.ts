import type { Components, UrlTransform } from "react-markdown";

const destinations = new WeakMap<Parameters<UrlTransform>[2], string>();

export const markdownLinkDestination = (
  node: Parameters<UrlTransform>[2] | undefined,
): string | undefined => (node ? destinations.get(node) : undefined);

/** Optional anchor policy. Images and default URL handling retain their own transform. */
export type MarkdownLinkPolicy = {
  anchor: NonNullable<Components["a"]>;
  handlesDestination(href: string): boolean;
};

export const markdownLinkUrlTransform = (
  transform: UrlTransform,
  policy: MarkdownLinkPolicy | undefined,
): UrlTransform => {
  if (!policy) return transform;
  return (url, key, node) => {
    if (node.tagName !== "a" || key !== "href" || !policy.handlesDestination(url))
      return transform(url, key, node);
    // Keep the destination off the anchor's navigation URL.
    destinations.set(node, url);
    return "#";
  };
};

type LinkComponentsCacheEntry = {
  defaults: Components;
  overrides: Components | undefined;
  policy: MarkdownLinkPolicy | undefined;
  components: Components;
};

const MAX_LINK_COMPONENTS_CACHE_ENTRIES = 16;
const linkComponentsCache: LinkComponentsCacheEntry[] = [];

export const markdownLinkComponents = (
  defaults: Components,
  overrides: Components | undefined,
  policy: MarkdownLinkPolicy | undefined,
): Components => {
  if (!overrides && !policy) return defaults;
  const cached = linkComponentsCache.find(
    (entry) =>
      entry.defaults === defaults && entry.overrides === overrides && entry.policy === policy,
  );
  if (cached) return cached.components;
  const components = { ...defaults, ...overrides };
  if (policy) components.a = policy.anchor;
  linkComponentsCache.push({ defaults, overrides, policy, components });
  if (linkComponentsCache.length > MAX_LINK_COMPONENTS_CACHE_ENTRIES) {
    linkComponentsCache.shift();
  }
  return components;
};
