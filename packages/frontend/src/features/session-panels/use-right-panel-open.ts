import { useSyncExternalStore } from "react";
import { z } from "zod";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { perConnection } from "@/lib/per-connection";

export const RIGHT_PANEL_OPEN_STORAGE_KEY = "openducktor:right-panel:open";
const OLD_RIGHT_PANEL_STORAGE_KEY = "openducktor:agent-studio:right-panel";
const OLD_ROLES = ["spec", "planner", "build", "qa"] as const;
const oldPanelSchema = z.record(z.string(), z.json());

/** Every mounted session view shows the same right panel open state. */
export function useRightPanelOpen() {
  const store = storeOf(useClientConnection());
  const isOpen = useSyncExternalStore(store.subscribe, store.read, store.read);
  return { isOpen, toggle: store.toggle, close: store.close };
}

const storeOf = perConnection(createRightPanelOpenStore);

function createRightPanelOpenStore() {
  let isOpen = readPanelOpen();
  // Moves a value read from the old key to the current key.
  savePanelOpen(isOpen);
  const listeners = new Set<() => void>();
  const set = (next: boolean): void => {
    if (next === isOpen) return;
    isOpen = next;
    savePanelOpen(isOpen);
    for (const listener of listeners) listener();
  };
  return {
    read: () => isOpen,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    toggle: () => set(!isOpen),
    close: () => set(false),
  };
}

function savePanelOpen(isOpen: boolean): void {
  try {
    globalThis.localStorage?.setItem(RIGHT_PANEL_OPEN_STORAGE_KEY, String(isOpen));
  } catch (error) {
    console.error("[right-panel] Failed to save panel state.", { isOpen, error });
  }
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
