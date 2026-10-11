import { toast } from "sonner";
import { z } from "zod";
import { create } from "zustand";
import { errorMessage } from "@/lib/errors";
import { RECENT_ITEMS_STORAGE_KEY, RECENT_ITEMS_STORED_LIMIT } from "./constants";
import { paletteChatKey, paletteTaskKey } from "./command-palette-row-keys";

const recentItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("task"),
    workspaceId: z.string(),
    taskId: z.string(),
    openedAt: z.number(),
  }),
  z.object({
    kind: z.literal("chat"),
    workspaceId: z.string(),
    sessionId: z.string(),
    openedAt: z.number(),
  }),
]);
const recentItemsSchema = z.array(recentItemSchema).max(RECENT_ITEMS_STORED_LIMIT);

export type RecentItem = z.infer<typeof recentItemSchema>;

export type RecentItemTarget =
  | { kind: "task"; workspaceId: string; taskId: string }
  | { kind: "chat"; workspaceId: string; sessionId: string };

export const recentItemKey = (item: RecentItemTarget): string =>
  item.kind === "task"
    ? paletteTaskKey(item.workspaceId, item.taskId)
    : paletteChatKey(item.workspaceId, item.sessionId);

/** Put the item first and drop its older copy. The newest items stay within the limit. */
export const addRecentItem = (
  items: readonly RecentItem[],
  target: RecentItemTarget,
  openedAt: number,
): RecentItem[] => {
  const key = recentItemKey(target);
  return [{ ...target, openedAt }, ...items.filter((item) => recentItemKey(item) !== key)].slice(
    0,
    RECENT_ITEMS_STORED_LIMIT,
  );
};

type RecentItemsRead = { items: RecentItem[]; error: string | null };

export const readRecentItems = (): RecentItemsRead => {
  try {
    const saved = globalThis.localStorage.getItem(RECENT_ITEMS_STORAGE_KEY);
    if (saved === null) return { items: [], error: null };
    const parsed = recentItemsSchema.safeParse(JSON.parse(saved));
    if (!parsed.success) {
      return { items: [], error: "The saved list of recent tasks and chats is invalid." };
    }
    return { items: parsed.data, error: null };
  } catch (error) {
    return { items: [], error: errorMessage(error) };
  }
};

type RecentItemsStore = {
  items: RecentItem[];
  /** Why the saved list could not load. The list then starts empty. */
  loadError: string | null;
  /**
   * Put the target first and save the list. A target that is already first changes nothing, so a
   * repeated render does not write the storage again.
   */
  record: (target: RecentItemTarget) => void;
};

/** One device-local Recent list for the command palette. */
export const useRecentItemsStore = create<RecentItemsStore>()((set, get) => {
  const { items, error } = readRecentItems();
  return {
    items,
    loadError: error,
    record: (target) => {
      const current = get().items;
      const [first] = current;
      if (first && recentItemKey(first) === recentItemKey(target)) return;
      const next = addRecentItem(current, target, Date.now());
      set({ items: next });
      try {
        globalThis.localStorage.setItem(RECENT_ITEMS_STORAGE_KEY, JSON.stringify(next));
      } catch (cause) {
        toast.error("Could not save recent tasks and chats.", {
          description: `Allow local storage for this app. ${errorMessage(cause)}`,
        });
      }
    },
  };
});

export const recordRecentItem = (target: RecentItemTarget): void =>
  useRecentItemsStore.getState().record(target);
