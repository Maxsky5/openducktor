import type { ReactElement, ReactNode } from "react";
import { CssPresenceList, useCssPresence } from "./css-presence";

/**
 * Content that opens and closes like an accordion when `open` changes. Put the space above it in
 * `className` as padding, not in a gap of the parent or a margin of the content, so a closed reveal
 * takes no space. `motionClassName` sets the durations, the easing, and the clip margin.
 */
export function CssPresenceReveal({
  open,
  className,
  motionClassName = "css-presence-reveal",
  children,
}: {
  open: boolean;
  className?: string | undefined;
  motionClassName?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <CssPresenceList>
      {open
        ? [
            <RevealContent key="content" className={className} motionClassName={motionClassName}>
              {children}
            </RevealContent>,
          ]
        : []}
    </CssPresenceList>
  );
}

function RevealContent({
  className,
  motionClassName,
  children,
}: {
  className: string | undefined;
  motionClassName: string;
  children: ReactNode;
}): ReactElement {
  const { presenceProps } = useCssPresence();
  // The inner box holds the space, so a closed reveal clips its padding with its height.
  return (
    <div {...presenceProps} className={`css-presence ${motionClassName}`}>
      <div className={className}>{children}</div>
    </div>
  );
}
