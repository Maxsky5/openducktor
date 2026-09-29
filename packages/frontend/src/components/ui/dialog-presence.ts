import { useLayoutEffect, useRef, useState } from "react";

export function useDialogPresence(open: boolean): boolean {
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
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setMounted(false);
      return;
    }
    const duration = getComputedStyle(document.documentElement)
      .getPropertyValue("--modal-close-dur")
      .trim();
    const milliseconds = Number.parseFloat(duration) * (duration.endsWith("ms") ? 1 : 1000);
    const timeout = window.setTimeout(() => {
      if (!currentOpen.current) setMounted(false);
    }, milliseconds);
    return () => window.clearTimeout(timeout);
  }, [open, mounted]);
  return mounted;
}
