import type { Components, UrlTransform } from "react-markdown";

const destinations = new WeakMap<Parameters<UrlTransform>[2], string>();

export const markdownLinkDestination = (node: Parameters<UrlTransform>[2] | undefined) =>
  node ? destinations.get(node) : undefined;

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
    // Associate the destination with the node without exposing a navigation URL.
    destinations.set(node, url);
    return "#";
  };
};

export const markdownLinkComponents = (
  defaults: Components,
  overrides: Components | undefined,
  policy: MarkdownLinkPolicy | undefined,
): Components => {
  if (!overrides && !policy) return defaults;
  const components = { ...defaults, ...overrides };
  if (policy) components.a = policy.anchor;
  return components;
};
