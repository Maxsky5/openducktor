import { useEffect } from "react";
import type { AppPlatform } from "@openducktor/contracts";
export function usePositionHints(platform: AppPlatform, active: boolean): void {
  useEffect(() => {
    let composing = false;
    const hide = () => document.documentElement.removeAttribute("data-shortcut-hints");
    const state = (event: KeyboardEvent) => {
      const modifierKey = event.key === (platform === "darwin" ? "Meta" : "Control");
      const mod = modifierKey
        ? event.type === "keydown"
        : platform === "darwin"
          ? event.metaKey
          : event.ctrlKey;
      if (mod && !composing && active)
        document.documentElement.setAttribute("data-shortcut-hints", "true");
      else hide();
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
  }, [platform, active]);
}
