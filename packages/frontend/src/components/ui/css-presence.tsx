import { AnimatePresence, usePresence } from "motion/react";
import {
  createContext,
  type ReactElement,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

const AnimationReadyContext = createContext<boolean | null>(null);

/**
 * Runs `done` when the CSS transitions of the element end. The returned cleanup cancels it, for
 * example when a new state interrupts the transitions. getAnimations flushes the new CSS state,
 * including an interrupted entrance.
 */
export const afterTransitions = (element: Element, done: () => void): (() => void) => {
  let interrupted = false;
  void Promise.allSettled(element.getAnimations().map((animation) => animation.finished)).then(
    () => {
      if (!interrupted) done();
    },
  );
  return () => {
    interrupted = true;
  };
};

/** The initial read appears at once. Later additions reveal, also in an empty list. */
export function CssPresenceList({
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
  // No motion component measures layout here. With the default, each list render gives every
  // child a new presence context, so all children render again.
  return (
    <AnimationReadyContext.Provider value={ready}>
      <AnimatePresence presenceAffectsLayout={false}>{children}</AnimatePresence>
    </AnimationReadyContext.Provider>
  );
}

/**
 * CSS owns the motion of a `CssPresenceList` child. Presence retains only the outgoing visual
 * until its transitions end. Spread `presenceProps` on the element that the CSS animates. They
 * give `isPresent` and `animateEntry` to the CSS, and they hide an exiting element from assistive
 * technology.
 */
export function useCssPresence() {
  const ready = useContext(AnimationReadyContext);
  if (ready === null) throw new Error("useCssPresence requires CssPresenceList.");
  // Capture the mount state. Later readiness changes must not animate initial content.
  const [animateEntry] = useState(ready);
  const [isPresent, safeToRemove] = usePresence();
  const elementRef = useRef<HTMLElement | null>(null);
  // A callback ref fits each element type, so one consumer can render different tags.
  const ref = useCallback((element: HTMLElement | null): void => {
    elementRef.current = element;
  }, []);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (isPresent || !element) return;
    return afterTransitions(element, () => safeToRemove?.());
  }, [isPresent, safeToRemove]);

  return {
    isPresent,
    animateEntry,
    presenceProps: {
      ref,
      "data-presence": isPresent ? "present" : "exiting",
      "data-animate-entry": animateEntry,
      "aria-hidden": isPresent ? undefined : true,
      inert: !isPresent,
    },
  };
}
