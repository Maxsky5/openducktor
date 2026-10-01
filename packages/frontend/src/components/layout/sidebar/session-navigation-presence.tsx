import { AnimatePresence, usePresence } from "motion/react";
import {
  createContext,
  createElement,
  type ReactElement,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import { SessionPresentContext, useSessionPresent } from "./session-navigation-presence-context";

const AnimationReadyContext = createContext<boolean | null>(null);

/** The initial read appears at once. Later additions reveal, also in an empty list. */
export function SessionPresenceList({
  children,
  isLoading = false,
}: {
  children: ReactElement[];
  isLoading?: boolean;
}): ReactElement {
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    if (!isLoading) setReady(true);
  }, [isLoading]);
  return (
    <AnimationReadyContext.Provider value={ready}>
      <AnimatePresence>{children}</AnimatePresence>
    </AnimationReadyContext.Provider>
  );
}

/** CSS owns the motion. Presence retains only the outgoing visual until its transitions end. */
export function SessionPresence({
  as,
  children,
  className,
  label,
}: {
  as: "li" | "section";
  children: ReactNode;
  className?: string;
  label?: string;
}): ReactElement {
  const ready = useContext(AnimationReadyContext);
  if (ready === null) throw new Error("SessionPresence requires SessionPresenceList.");
  // Capture the mount state. Later readiness changes must not animate initial content.
  const [animateEntry] = useState(ready);
  const [isPresent, safeToRemove] = usePresence();
  const ancestorPresent = useSessionPresent();
  const elementRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (isPresent || !elementRef.current) return;
    // getAnimations flushes the new CSS state, including an interrupted entrance.
    const transitions = elementRef.current.getAnimations();
    let interrupted = false;
    void Promise.allSettled(transitions.map((animation) => animation.finished)).then(() => {
      if (!interrupted) safeToRemove?.();
    });
    return () => {
      interrupted = true;
    };
  }, [isPresent, safeToRemove]);

  return createElement(
    as,
    {
      ref: elementRef,
      className: cn("session-presence", className),
      "aria-label": label,
      "aria-hidden": isPresent ? undefined : true,
      inert: !isPresent,
      "data-session-presence": isPresent ? "present" : "exiting",
      "data-animate-entry": String(animateEntry),
    },
    <SessionPresentContext.Provider value={ancestorPresent && isPresent}>
      {children}
    </SessionPresentContext.Provider>,
  );
}
