import { useIsPresent } from "motion/react";
import type { ReactElement, ReactNode } from "react";
import { useCssPresence } from "@/components/ui/css-presence";
import { cn } from "@/lib/utils";
import { SessionPresentContext, useSessionPresent } from "./session-navigation-presence-context";

/**
 * A session row or group that grows in and shrinks out of the session list with the
 * `css-presence` styles. An exiting row is hidden from assistive technology.
 */
export function SessionPresence({
  as: Tag,
  children,
  className,
  label,
}: {
  as: "li" | "section";
  children: ReactNode;
  className?: string;
  label?: string;
}): ReactElement {
  const { presenceProps } = useCssPresence();
  return (
    <Tag
      {...presenceProps}
      className={cn("css-presence session-presence", className)}
      aria-label={label}
    >
      <SessionPresentScope>{children}</SessionPresentScope>
    </Tag>
  );
}

/** Tells descendants that their row leaves, so they stop effects such as previews. */
function SessionPresentScope({ children }: { children: ReactNode }): ReactElement {
  const isPresent = useIsPresent();
  const ancestorPresent = useSessionPresent();
  return (
    <SessionPresentContext.Provider value={ancestorPresent && isPresent}>
      {children}
    </SessionPresentContext.Provider>
  );
}
