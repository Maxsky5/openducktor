import defaultMdxComponents from "fumadocs-ui/mdx";
import type { ComponentProps } from "react";

const DefaultLink = defaultMdxComponents.a;

/**
 * A link to a section of the same page is a plain link, so the browser changes the hash and sends
 * `hashchange`, and `RouteFocus` gives the section to `openSection`. See `openSection` in
 * `lib/focus.ts`.
 */
export function MdxLink(props: ComponentProps<"a">) {
  if (props.href?.startsWith("#")) return <a {...props} />;
  return <DefaultLink {...props} />;
}
