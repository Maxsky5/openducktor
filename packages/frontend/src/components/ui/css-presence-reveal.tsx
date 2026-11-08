import type { ReactElement, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CssPresenceList, useCssPresence } from "./css-presence";

/**
 * Content that opens and closes like an accordion when `open` changes. Put the space above it in
 * `className`, not in a gap of the parent, so a closed reveal takes no space.
 */
export function CssPresenceReveal({
  open,
  className,
  children,
}: {
  open: boolean;
  className?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <CssPresenceList>
      {open
        ? [
            <RevealContent key="content" className={className}>
              {children}
            </RevealContent>,
          ]
        : []}
    </CssPresenceList>
  );
}

function RevealContent({
  className,
  children,
}: {
  className: string | undefined;
  children: ReactNode;
}): ReactElement {
  const { presenceProps } = useCssPresence();
  return (
    <div {...presenceProps} className={cn("css-presence css-presence-reveal", className)}>
      {children}
    </div>
  );
}
