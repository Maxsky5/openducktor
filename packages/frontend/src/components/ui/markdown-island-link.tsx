import { type ReactElement, type ReactNode, useEffect, useRef } from "react";

const forwardToLink = (event: Event): void => {
  if (!(event instanceof MouseEvent) || !(event.currentTarget instanceof Element)) return;
  const anchor = event.currentTarget.closest("a");
  if (!anchor) return;
  event.preventDefault();
  event.stopPropagation();
  anchor.dispatchEvent(
    new MouseEvent(event.type, {
      bubbles: true,
      cancelable: true,
      button: event.button,
      buttons: event.buttons,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
    }),
  );
};

/**
 * Words mounts image islands in React portals, so their mouse events skip the link handlers of the
 * view. A mouse event in a linked image goes to its link again, from the link element, with the
 * same button and keys.
 */
export function IslandLink({ children }: { children: ReactNode }): ReactElement {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.addEventListener("click", forwardToLink);
    element.addEventListener("auxclick", forwardToLink);
    element.addEventListener("contextmenu", forwardToLink);
    return () => {
      element.removeEventListener("click", forwardToLink);
      element.removeEventListener("auxclick", forwardToLink);
      element.removeEventListener("contextmenu", forwardToLink);
    };
  }, []);
  return <span ref={ref}>{children}</span>;
}
