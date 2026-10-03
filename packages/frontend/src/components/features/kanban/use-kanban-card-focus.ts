import { type FocusEvent, type RefObject, useLayoutEffect, useRef } from "react";

/** Keep focus on the card when a control disappears, unless another view has taken focus. */
export function useCardFocus(): CardFocus {
  const cardRef = useRef<HTMLElement>(null);
  const focusRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const control = focusRef.current;
    if (control && cardRef.current && hasLostFocus(control)) {
      focusRef.current = null;
      focusCardControl(cardRef.current, getControlKey(control) ?? undefined);
    }
  });

  const onFocusCapture = (event: FocusEvent<HTMLElement>): void => {
    const target = event.target;
    focusRef.current = target instanceof HTMLElement ? target : null;
  };
  const onBlurCapture = (event: FocusEvent<HTMLElement>): void => {
    if (
      event.relatedTarget instanceof HTMLElement &&
      event.relatedTarget.closest("[data-kanban-task-id]")?.getAttribute("data-kanban-task-id") !==
        cardRef.current?.dataset.kanbanTaskId
    ) {
      focusRef.current = null;
    }
  };

  return { cardRef, onFocusCapture, onBlurCapture };
}

type CardFocus = {
  cardRef: RefObject<HTMLElement | null>;
  onFocusCapture: (event: FocusEvent<HTMLElement>) => void;
  onBlurCapture: (event: FocusEvent<HTMLElement>) => void;
};

export const focusCardControl = (card: HTMLElement, control?: string): void => {
  const controls = Array.from(card.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]"));
  const target =
    controls.find((element) => control && getControlKey(element) === control) ??
    controls.find((element) => element.dataset.kanbanControl === "primary") ??
    controls.find((element) => element.dataset.kanbanControl?.startsWith("session:")) ??
    controls.find((element) => element.dataset.kanbanControl === "details");
  target?.focus();
};

export const getControlKey = (element: HTMLElement): string | null =>
  element.dataset.kanbanControl ??
  element.getAttribute("aria-label") ??
  (element.textContent?.trim() || null);

export const hasLostFocus = (element: HTMLElement): boolean =>
  !element.isConnected &&
  (document.activeElement === document.body || document.activeElement === null);
