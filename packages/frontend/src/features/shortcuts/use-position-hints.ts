import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { AppPlatform } from "@openducktor/contracts";

const hide = () => document.documentElement.removeAttribute("data-shortcut-hints");

/**
 * The only writer of the position hints. They show while Mod is held and `active` is true: shortcuts
 * are loaded, nothing records, and no dialog is open. App keys report here directly; the returned
 * function takes the Mod state of keys from embedded browser pages and preview frames.
 */
export function usePositionHints(
  platform: AppPlatform,
  active: boolean,
): (holdingMod: boolean) => void {
  const activeRef = useRef(active);
  useLayoutEffect(() => {
    activeRef.current = active;
    if (!active) hide();
  }, [active]);
  const report = useCallback((holdingMod: boolean) => {
    if (holdingMod && activeRef.current)
      document.documentElement.setAttribute("data-shortcut-hints", "true");
    else hide();
  }, []);
  useEffect(() => {
    let composing = false;
    const state = (event: KeyboardEvent) => {
      const modifierKey = event.key === (platform === "darwin" ? "Meta" : "Control");
      const mod = modifierKey
        ? event.type === "keydown"
        : platform === "darwin"
          ? event.metaKey
          : event.ctrlKey;
      report(mod && !composing);
    };
    const start = () => {
      composing = true;
      hide();
    };
    const end = () => {
      composing = false;
    };
    window.addEventListener("keydown", state, true);
    window.addEventListener("keyup", state, true);
    window.addEventListener("blur", hide);
    window.addEventListener("compositionstart", start, true);
    window.addEventListener("compositionend", end, true);
    return () => {
      hide();
      window.removeEventListener("keydown", state, true);
      window.removeEventListener("keyup", state, true);
      window.removeEventListener("blur", hide);
      window.removeEventListener("compositionstart", start, true);
      window.removeEventListener("compositionend", end, true);
    };
  }, [platform, report]);
  return report;
}
