"use client";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";

/**
 * A page link that loads the page when the reader points at it, focuses it, or touches it. Next.js
 * loads the page of each link as soon as the link shows, and a page shows about 30 links, so the
 * first visit would load about 300 KB of pages that the reader does not open. Fumadocs renders its
 * links with this component, and its `prefetch` option has no effect.
 */
export function IntentLink({
  href = "#",
  prefetch: _prefetch,
  onClick,
  onMouseEnter,
  onFocus,
  onTouchStart,
  ...props
}: ComponentProps<"a"> & { prefetch?: boolean | undefined }) {
  const router = useRouter();
  const load = () => {
    if (href.startsWith("/")) router.prefetch(href);
  };
  return (
    <NextLink
      {...props}
      href={href}
      prefetch={false}
      onClick={(event) => onClick?.(event)}
      onMouseEnter={(event) => {
        onMouseEnter?.(event);
        load();
      }}
      onFocus={(event) => {
        onFocus?.(event);
        load();
      }}
      onTouchStart={(event) => {
        onTouchStart?.(event);
        load();
      }}
    />
  );
}
