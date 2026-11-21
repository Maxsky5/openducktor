import { useLayoutEffect, useRef, useState } from "react";
import { cssTimeMs } from "./css-time";

/** "instant" shows and hides a dialog without motion, such as a dialog that opens from a key. */
export type DialogMotion = "animated" | "instant";

export function useDialogPresence(open: boolean, motion: DialogMotion = "animated"): boolean {
  const [mounted, setMounted] = useState(open);
  const currentOpen = useRef(open);
  useLayoutEffect(() => {
    currentOpen.current = open;
  }, [open]);
  useLayoutEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    if (motion === "instant" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setMounted(false);
      return;
    }
    const milliseconds = cssTimeMs(
      getComputedStyle(document.documentElement).getPropertyValue("--modal-close-dur"),
    );
    const timeout = window.setTimeout(() => {
      if (!currentOpen.current) setMounted(false);
    }, milliseconds);
    return () => window.clearTimeout(timeout);
  }, [open, mounted, motion]);
  return mounted;
}
