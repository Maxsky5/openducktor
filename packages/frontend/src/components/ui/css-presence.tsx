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
import { afterTransitions } from "./css-transitions";

const AnimationReadyContext = createContext<boolean | null>(null);

/** True while the lists of a subtree change without motion. Nested lists inherit it. */
const InstantContext = createContext(false);

/**
 * The initial read appears at once. Later additions reveal, also in an empty list. An `instant`
 * list, such as the results of a filter that change with each key, adds and removes children at
 * once: a child that leaves is gone before the next paint. Lists inside it inherit the mode.
 */
export function CssPresenceList({
  children,
  isLoading = false,
  instant,
}: {
  children: ReactElement[];
  isLoading?: boolean;
  instant?: boolean;
}): ReactElement {
  const inherited = useContext(InstantContext);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    if (!isLoading) setReady(true);
  }, [isLoading]);
  // No motion component measures layout here. With the default, each list render gives every
  // child a new presence context, so all children render again.
  return (
    <InstantContext value={instant ?? inherited}>
      <AnimationReadyContext.Provider value={ready}>
        <AnimatePresence presenceAffectsLayout={false}>{children}</AnimatePresence>
      </AnimationReadyContext.Provider>
    </InstantContext>
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
  const instant = useContext(InstantContext);
  // Capture the mount state. Later readiness changes must not animate initial content.
  const [animateEntry] = useState(ready && !instant);
  const [isPresent, safeToRemove] = usePresence();
  const elementRef = useRef<HTMLElement | null>(null);
  // A callback ref fits each element type, so one consumer can render different tags.
  const ref = useCallback((element: HTMLElement | null): void => {
    elementRef.current = element;
  }, []);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (isPresent || !element) return;
    // CSS hides an instant exit in the same commit, and presence removes it right after.
    if (instant) {
      queueMicrotask(() => safeToRemove?.());
      return;
    }
    return afterTransitions(element, () => safeToRemove?.());
  }, [instant, isPresent, safeToRemove]);

  return {
    isPresent,
    animateEntry,
    presenceProps: {
      ref,
      "data-presence": isPresent ? "present" : "exiting",
      "data-animate-entry": animateEntry,
      "data-presence-instant": instant || undefined,
      "aria-hidden": isPresent ? undefined : true,
      inert: !isPresent,
    },
  };
}
