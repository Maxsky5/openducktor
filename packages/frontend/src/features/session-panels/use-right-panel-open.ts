import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

export const RIGHT_PANEL_OPEN_STORAGE_KEY = "openducktor:right-panel:open";
const OLD_RIGHT_PANEL_STORAGE_KEY = "openducktor:agent-studio:right-panel";
const OLD_ROLES = ["spec", "planner", "build", "qa"] as const;
const oldPanelSchema = z.record(z.string(), z.json());

export function useRightPanelOpen() {
  const [isOpen, setIsOpen] = useState(readPanelOpen);
  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(RIGHT_PANEL_OPEN_STORAGE_KEY, String(isOpen));
    } catch (error) {
      console.error("[right-panel] Failed to save panel state.", { isOpen, error });
    }
  }, [isOpen]);
  const toggle = useCallback(() => setIsOpen((open) => !open), []);
  const close = useCallback(() => setIsOpen(false), []);
  return { isOpen, toggle, close };
}

function readPanelOpen(): boolean {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return true;
    const saved = storage.getItem(RIGHT_PANEL_OPEN_STORAGE_KEY);
    if (saved === "true") return true;
    if (saved === "false") return false;
    if (saved !== null) throw new Error("The saved right panel state is invalid.");

    const old = storage.getItem(OLD_RIGHT_PANEL_STORAGE_KEY);
    if (!old) return true;
    const parsed = oldPanelSchema.safeParse(JSON.parse(old));
    if (!parsed.success) return true;
    return !OLD_ROLES.some((role) => parsed.data[role] === false);
  } catch (error) {
    console.error("[right-panel] Failed to read panel state.", { error });
    return true;
  }
}
