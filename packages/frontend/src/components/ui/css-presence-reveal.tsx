import type { ReactElement, ReactNode } from "react";
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
  className?: string | undefined;
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
  // The inner box holds the space, so a closed reveal clips its padding with its height.
  return (
    <div {...presenceProps} className="css-presence css-presence-reveal">
      <div className={className}>{children}</div>
    </div>
  );
}
