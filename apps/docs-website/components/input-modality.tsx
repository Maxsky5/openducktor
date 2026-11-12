"use client";
import { useEffect } from "react";

/**
 * Marks the last input type on the page root as `data-input="pointer"` or `"keyboard"`. A tab takes
 * focus when it is pressed, so the CSS uses this mark to show the tab focus ring for keyboard use
 * only. The mark changes only when the input type changes, so a key press does not restyle the page.
 */
export function InputModality() {
  useEffect(() => {
    const root = document.documentElement;
    const mark = (input: "pointer" | "keyboard") => () => {
      if (root.dataset.input !== input) root.dataset.input = input;
    };
    const pointer = mark("pointer");
    const keyboard = mark("keyboard");
    window.addEventListener("pointerdown", pointer, { capture: true, passive: true });
    window.addEventListener("keydown", keyboard, { capture: true, passive: true });
    return () => {
      window.removeEventListener("pointerdown", pointer, true);
      window.removeEventListener("keydown", keyboard, true);
    };
  }, []);
  return null;
}
