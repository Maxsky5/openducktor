import { browserTabIdSchema } from "@openducktor/contracts";
import { toast } from "sonner";
import { z } from "zod";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import type { ClientStorage } from "@openducktor/frontend-core/platform/client-storage";
import { perConnection } from "@/lib/per-connection";
import { isToolTabKind, TOOL_TAB_KINDS } from "./panel-tab-kinds";
import { fromV1Record, V1_STORAGE_PREFIX } from "./session-panel-layout-v1";
import {
  browserTabEntry,
  emptySessionPanelLayout,
  type PanelTabEntry,
  type SessionPanelLayout,
  SESSION_PANEL_SELECTION_KEYS,
  type SessionPanelOwner,
  sessionPanelOwnerKey,
} from "./session-panel-layout";

/** The panel layouts of one client connection. */
export type SessionPanelLayoutStore = {
  subscribe: (listener: () => void) => () => void;
  /**
   * The layouts in memory by owner key. A new map replaces it on each change. An owner that was only
   * read since the last change shows after the next change.
   */
  snapshot: () => ReadonlyMap<string, SessionPanelLayout>;
  /** Reads the layout of an owner. The first read restores the saved layout. */
  read: (owner: SessionPanelOwner) => SessionPanelLayout;
  /** Returns the restore failure of an owner one time, so the app reports it once. */
  takeReadError: (owner: SessionPanelOwner) => string | null;
  /**
   * Applies `change` to the layout of an owner and saves the tool tabs when they change. A save
   * failure shows one toast for each owner. The layout stays in memory.
   */
  update: (
    owner: SessionPanelOwner,
    change: (layout: SessionPanelLayout) => SessionPanelLayout,
  ) => void;
  /**
   * Removes the saved and in-memory layouts of tasks, chats, and workspaces that no longer exist.
   * Then it tells each prune listener the owners that it removed.
   */
  prune: (input: SessionPanelLayoutPruneInput) => void;
  /**
   * Tells a listener the owners whose layouts a prune removed, so that the browser feature can
   * remove their pending annotations.
   */
  subscribePrunes: (listener: (owners: readonly SessionPanelOwner[]) => void) => () => void;
};

/** The panel layouts of the selected host. */
export const useSessionPanelLayoutStore = (): SessionPanelLayoutStore =>
  storeOf(useClientConnection());

const storeOf = perConnection((connection) => createSessionPanelLayoutStore(connection.storage));

/**
 * Keeps the layouts of all owners in memory. It saves the tool tabs in `storage`, one record for
 * each owner.
 */
export const createSessionPanelLayoutStore = (storage: ClientStorage): SessionPanelLayoutStore => {
  const entries = new Map<string, StoreEntry>();
  const listeners = new Set<() => void>();
  const pruneListeners = new Set<(owners: readonly SessionPanelOwner[]) => void>();
  let snapshot: ReadonlyMap<string, SessionPanelLayout> = new Map();
  let pruneErrorShown = false;

  const notify = (): void => {
    snapshot = new Map([...entries].map(([ownerKey, entry]) => [ownerKey, entry.layout]));
    for (const listener of listeners) listener();
  };

  const entryFor = (owner: SessionPanelOwner): StoreEntry => {
    const key = sessionPanelOwnerKey(owner);
    let entry = entries.get(key);
    if (!entry) {
      entry = readEntry(storage, owner);
      entries.set(key, entry);
    }
    return entry;
  };

  /** Removes the stale records and returns their owners. */
  const removeStaleRecords = (input: SessionPanelLayoutPruneInput): SessionPanelOwner[] => {
    try {
      const staleKeys: string[] = [];
      const owners: SessionPanelOwner[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        const stored = key === null ? null : parseStorageKey(key);
        if (key === null || stored === null || !isStaleOwner(stored, input)) continue;
        staleKeys.push(key);
        const owner = panelOwnerOf(stored);
        if (owner) owners.push(owner);
      }
      for (const key of staleKeys) storage.removeItem(key);
      return owners;
    } catch (error) {
      console.error("[session-panels] Failed to remove old panel layouts.", { error });
      if (!pruneErrorShown) {
        pruneErrorShown = true;
        toast.error("Could not remove old panel layouts", {
          description: `${errorMessage(error)} Saved layouts of removed tasks and chats stay on this computer.`,
        });
      }
      return [];
    }
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot: () => snapshot,
    read: (owner) => entryFor(owner).layout,
    takeReadError: (owner) => {
      const entry = entryFor(owner);
      const error = entry.readError;
      entry.readError = null;
      return error;
    },
    update: (owner, change) => {
      const entry = entryFor(owner);
      const layout = change(entry.layout);
      if (layout === entry.layout) return;
      entry.layout = layout;
      const record = JSON.stringify(toPersistedLayout(layout));
      if (record !== entry.savedRecord) {
        try {
          storage.setItem(sessionPanelLayoutStorageKey(owner), record);
          entry.savedRecord = record;
        } catch (error) {
          console.error("[session-panels] Failed to save the panel layout.", { owner, error });
          if (!entry.writeErrorShown) {
            entry.writeErrorShown = true;
            toast.error("Could not save the panel layout", {
              description: `${errorMessage(error)} The layout works until the app restarts.`,
            });
          }
        }
      }
      notify();
    },
    prune: (input) => {
      const removedOwners = new Map<string, SessionPanelOwner>();
      for (const owner of removeStaleRecords(input)) {
        removedOwners.set(sessionPanelOwnerKey(owner), owner);
      }
      let removed = false;
      for (const [ownerKey, entry] of entries) {
        if (isStaleOwner(storedOwner(entry.owner), input)) {
          entries.delete(ownerKey);
          removedOwners.set(ownerKey, entry.owner);
          removed = true;
        }
      }
      if (removed) notify();
      if (removedOwners.size === 0) return;
      const owners = [...removedOwners.values()];
      for (const listener of pruneListeners) listener(owners);
    },
    subscribePrunes: (listener) => {
      pruneListeners.add(listener);
      return () => {
        pruneListeners.delete(listener);
      };
    },
  };
};

const STORAGE_PREFIX = "openducktor:session-panel-layout:v2:";

const toolTabKindSchema = z.enum(TOOL_TAB_KINDS);
const selectionKeySchema = z.enum(SESSION_PANEL_SELECTION_KEYS);

const persistedPanelTabSchema = z.discriminatedUnion("kind", [
  z.object({ kind: toolTabKindSchema }),
  z.object({ kind: z.literal("browser"), tabId: browserTabIdSchema }),
]);

type PersistedPanelTab = z.infer<typeof persistedPanelTabSchema>;

const persistedLayoutSchema = z.object({
  version: z.literal(2),
  panels: z.object({
    right: z.array(persistedPanelTabSchema),
    bottom: z.array(persistedPanelTabSchema),
  }),
  closedKinds: z.array(toolTabKindSchema),
  /** Entry IDs. Null keeps a selection whose tab is gone, such as a terminal that ended on restart. */
  selectedRight: z.partialRecord(selectionKeySchema, z.string().nullable()),
  selectedBottom: z.string().nullable(),
});

type PersistedLayout = z.infer<typeof persistedLayoutSchema>;

/** The saved part of an entry. Terminals end on restart, and the New tab is not kept. */
const toPersistedTab = (entry: PanelTabEntry): PersistedPanelTab | null => {
  if (entry.kind === "browser") return { kind: "browser", tabId: entry.tabId };
  if (isToolTabKind(entry.kind)) return { kind: entry.kind };
  return null;
};

const toPersistedLayout = (layout: SessionPanelLayout): PersistedLayout => {
  const savedIds = new Set<string>();
  const persistedTabs = (panelEntries: PanelTabEntry[]): PersistedPanelTab[] =>
    panelEntries.flatMap((entry) => {
      const persisted = toPersistedTab(entry);
      if (!persisted) return [];
      savedIds.add(entry.id);
      return [persisted];
    });
  const panels = {
    right: persistedTabs(layout.panels.right),
    bottom: persistedTabs(layout.panels.bottom),
  };
  const savedSelection = (entryId: string | null): string | null =>
    entryId !== null && savedIds.has(entryId) ? entryId : null;
  const selectedRight: PersistedLayout["selectedRight"] = {};
  for (const key of SESSION_PANEL_SELECTION_KEYS) {
    const entryId = layout.selectedRight[key];
    if (entryId === undefined) continue;
    selectedRight[key] = savedSelection(entryId);
  }
  return {
    version: 2,
    panels,
    closedKinds: [...layout.closedKinds],
    selectedRight,
    selectedBottom: savedSelection(layout.selectedBottom),
  };
};

const fromPersistedTab = (tab: PersistedPanelTab): PanelTabEntry => {
  if (tab.kind === "browser") return browserTabEntry(tab.tabId);
  return { id: tab.kind, kind: tab.kind };
};

const fromPersistedLayout = (record: PersistedLayout): SessionPanelLayout => ({
  panels: {
    right: record.panels.right.map(fromPersistedTab),
    bottom: record.panels.bottom.map(fromPersistedTab),
  },
  closedKinds: [...record.closedKinds],
  selectedRight: { ...record.selectedRight },
  selectedBottom: record.selectedBottom,
});

type StoreEntry = {
  owner: SessionPanelOwner;
  layout: SessionPanelLayout;
  /** The last saved or restored record, so a change of live entries only does not write. */
  savedRecord: string | null;
  readError: string | null;
  writeErrorShown: boolean;
};

/** Restores the saved layout of an owner. A failed read starts an empty layout and keeps the error. */
const readEntry = (storage: ClientStorage, owner: SessionPanelOwner): StoreEntry => {
  const empty: StoreEntry = {
    owner,
    layout: emptySessionPanelLayout(),
    savedRecord: null,
    readError: null,
    writeErrorShown: false,
  };
  try {
    const key = sessionPanelLayoutStorageKey(owner);
    const saved = storage.getItem(key);
    if (saved !== null) {
      const record = persistedLayoutSchema.parse(JSON.parse(saved));
      return { ...empty, layout: fromPersistedLayout(record), savedRecord: saved };
    }
    // A layout of an app version before browser tabs upgrades once, then only v2 stays.
    const oldKey = ownerStorageKey(V1_STORAGE_PREFIX, owner);
    const old = storage.getItem(oldKey);
    if (old === null) return empty;
    const layout = fromV1Record(old);
    const record = JSON.stringify(toPersistedLayout(layout));
    storage.setItem(key, record);
    storage.removeItem(oldKey);
    return { ...empty, layout, savedRecord: record };
  } catch (error) {
    console.error("[session-panels] Failed to read the saved panel layout.", { owner, error });
    return { ...empty, readError: errorMessage(error) };
  }
};

const ownerStorageKey = (prefix: string, owner: SessionPanelOwner): string => {
  const { workspaceId, kind, ownerId } = storedOwner(owner);
  return `${prefix}${[workspaceId, kind, ownerId].map(encodeURIComponent).join(":")}`;
};

export const sessionPanelLayoutStorageKey = (owner: SessionPanelOwner): string =>
  ownerStorageKey(STORAGE_PREFIX, owner);

type StoredOwner = { workspaceId: string; kind: string; ownerId: string };

/** Reads the owner of a v2 key, or of a v1 key that no read upgraded yet. */
const parseStorageKey = (key: string): StoredOwner | null => {
  const prefix = [STORAGE_PREFIX, V1_STORAGE_PREFIX].find((candidate) => key.startsWith(candidate));
  if (prefix === undefined) return null;
  const [workspaceId, kind, ownerId, ...rest] = key
    .slice(prefix.length)
    .split(":")
    .map(decodeURIComponent);
  if (workspaceId === undefined || kind === undefined || ownerId === undefined || rest.length > 0) {
    return null;
  }
  return { workspaceId, kind, ownerId };
};

const storedOwner = (owner: SessionPanelOwner): StoredOwner => ({
  workspaceId: owner.workspaceId,
  kind: owner.kind,
  ownerId: owner.kind === "task" ? owner.taskId : owner.sessionId,
});

const panelOwnerOf = ({ workspaceId, kind, ownerId }: StoredOwner): SessionPanelOwner | null => {
  if (kind === "task") return { kind, workspaceId, taskId: ownerId };
  if (kind === "chat") return { kind, workspaceId, sessionId: ownerId };
  return null;
};

/** One current list of owners. Each list removes the layouts of the owners that it no longer has. */
export type SessionPanelLayoutPruneInput =
  | { kind: "workspaces"; ids: ReadonlySet<string> }
  | { kind: "tasks"; workspaceId: string; ids: ReadonlySet<string> }
  | { kind: "chats"; workspaceId: string; ids: ReadonlySet<string> };

const isStaleOwner = (owner: StoredOwner, input: SessionPanelLayoutPruneInput): boolean => {
  if (input.kind === "workspaces") return !input.ids.has(owner.workspaceId);
  if (owner.workspaceId !== input.workspaceId) return false;
  if (input.kind === "tasks") return owner.kind === "task" && !input.ids.has(owner.ownerId);
  return owner.kind === "chat" && !input.ids.has(owner.ownerId);
};
