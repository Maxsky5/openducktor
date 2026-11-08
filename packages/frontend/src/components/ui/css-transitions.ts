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
