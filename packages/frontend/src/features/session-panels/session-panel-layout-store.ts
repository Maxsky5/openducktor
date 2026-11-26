import { browserTabIdSchema } from "@openducktor/contracts";
import { toast } from "sonner";
import { z } from "zod";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import type { ClientStorage } from "@openducktor/frontend-core/platform/client-storage";
import { perConnection } from "@openducktor/frontend-core/lib/per-connection";
import { isToolTabKind, TOOL_TAB_KINDS } from "./panel-tab-kinds";
import {
  type BottomPanelCheck,
  type BottomPanelState,
  bottomStateFromSaved,
  NO_BOTTOM_CHECK,
  savedBottomOpen,
} from "./session-panel-bottom-rules";
import { fromV1Record, V1_STORAGE_PREFIX } from "./session-panel-layout-v1";
import {
  browserTabEntry,
  emptySessionPanelLayout,
  type PanelTabEntry,
  type SessionPanelLayout,
  type SessionPanelOwner,
  sessionPanelOwnerKey,
} from "./session-panel-layout";

/** The open state of the panels of an owner. A right panel without a saved state is null. */
export type SessionPanelsOpenState = { right: boolean | null; bottom: BottomPanelState };

/** The panel layouts and open states of one client connection. */
export type SessionPanelLayoutStore = {
  subscribe: (listener: () => void) => () => void;
  /**
   * The layouts in memory by owner key. A new map replaces it on each change. An owner that was only
   * read since the last change shows after the next change.
   */
  snapshot: () => ReadonlyMap<string, SessionPanelLayout>;
  /** Reads the layout of an owner. The first read restores the saved layout. */
  read: (owner: SessionPanelOwner) => SessionPanelLayout;
  /**
   * Returns the restore failure of an owner one time. A cause that the app already reported for
   * this connection returns null, so the app reports each cause once.
   */
  takeReadError: (owner: SessionPanelOwner) => string | null;
  /**
   * Applies `change` to the layout of an owner and saves the tool tabs when they change. A save
   * failure reports each cause once until a save succeeds. The layout stays in memory.
   */
  update: (
    owner: SessionPanelOwner,
    change: (layout: SessionPanelLayout) => SessionPanelLayout,
  ) => void;
  /**
   * The open state of the panels of an owner. The first read restores the saved record. A new object
   * replaces it on each change.
   */
  readPanels: (owner: SessionPanelOwner) => SessionPanelsOpenState;
  /**
   * Sets the open state of a panel of an owner, and saves it. A save failure acts as in `update`.
   * A bottom state change that keeps the saved value does not write.
   */
  setRightOpen: (owner: SessionPanelOwner, isOpen: boolean) => void;
  setBottomState: (owner: SessionPanelOwner, state: BottomPanelState) => void;
  /**
   * The last check of the bottom panel rules for an owner. Only the shown view reads and writes it,
   * so a write tells no view.
   */
  readBottomCheck: (owner: SessionPanelOwner) => BottomPanelCheck;
  writeBottomCheck: (owner: SessionPanelOwner, check: BottomPanelCheck) => void;
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

const storeOf = perConnection((connection) =>
  createSessionPanelLayoutStore(connection.layoutStorage),
);

/**
 * Keeps the layouts and open states of all owners in memory. It saves the tool tabs and the open
 * states in `storage`, one record for each owner.
 */
export const createSessionPanelLayoutStore = (storage: ClientStorage): SessionPanelLayoutStore => {
  const entries = new Map<string, StoreEntry>();
  const listeners = new Set<() => void>();
  const pruneListeners = new Set<(owners: readonly SessionPanelOwner[]) => void>();
  let snapshot: ReadonlyMap<string, SessionPanelLayout> = new Map();
  let pruneFailure: string | null = null;
  /** The save failure causes reported since the last successful save. */
  const reportedWriteFailures = new Set<string>();
  const reportedReadErrors = new Set<string>();

  const emit = (): void => {
    for (const listener of listeners) listener();
  };
  const notify = (): void => {
    snapshot = new Map([...entries].map(([ownerKey, entry]) => [ownerKey, entry.layout]));
    emit();
  };

  /** Saves the record of an owner when it changed. The new state stays in memory on a failure. */
  const save = (entry: StoreEntry): void => {
    const record = JSON.stringify(toPersistedLayout(entry.layout, entry.panels));
    if (record === entry.savedRecord) return;
    try {
      storage.setItem(sessionPanelLayoutStorageKey(entry.owner), record);
      entry.savedRecord = record;
      reportedWriteFailures.clear();
    } catch (error) {
      const message = errorMessage(error);
      if (reportedWriteFailures.has(message)) return;
      reportedWriteFailures.add(message);
      console.error("[session-panels] Failed to save the panels.", { owner: entry.owner, error });
      toast.error("Could not save the panels", {
        description: `${message} The panels keep their tabs and open state until the app restarts.`,
      });
    }
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

  const setPanels = (entry: StoreEntry, change: Partial<SessionPanelsOpenState>): void => {
    const panels = { ...entry.panels, ...change };
    if (panels.right === entry.panels.right && panels.bottom === entry.panels.bottom) return;
    entry.panels = panels;
    save(entry);
    // The layouts do not change, so the layout snapshot stays.
    emit();
  };

  /** Removes the stale records and returns their owners. */
  const removeStaleRecords = (input: SessionPanelLayoutPruneInput): SessionPanelOwner[] => {
    try {
      const staleKeys: string[] = [];
      const owners: SessionPanelOwner[] = [];
      for (let index = 0, count = storage.length; index < count; index += 1) {
        const key = storage.key(index);
        const stored = key === null ? null : parseStorageKey(key);
        if (key === null || stored === null || !isStaleOwner(stored, input)) continue;
        staleKeys.push(key);
        const owner = panelOwnerOf(stored);
        if (owner) owners.push(owner);
      }
      for (const key of staleKeys) storage.removeItem(key);
      pruneFailure = null;
      return owners;
    } catch (error) {
      const message = errorMessage(error);
      if (pruneFailure !== message) {
        pruneFailure = message;
        console.error("[session-panels] Failed to remove old panel layouts.", { error });
        toast.error("Could not remove old panel layouts", {
          description: `${message} Saved layouts of removed tasks and sessions stay on this computer.`,
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
      if (error === null || reportedReadErrors.has(error)) return null;
      reportedReadErrors.add(error);
      return error;
    },
    update: (owner, change) => {
      const entry = entryFor(owner);
      const layout = change(entry.layout);
      if (layout === entry.layout) return;
      entry.layout = layout;
      save(entry);
      notify();
    },
    readPanels: (owner) => entryFor(owner).panels,
    setRightOpen: (owner, isOpen) => setPanels(entryFor(owner), { right: isOpen }),
    setBottomState: (owner, state) => setPanels(entryFor(owner), { bottom: state }),
    readBottomCheck: (owner) => entryFor(owner).bottomCheck,
    writeBottomCheck: (owner, check) => {
      entryFor(owner).bottomCheck = check;
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
/** A task role ID, built-in or custom, or `chat`. */
const selectionKeySchema = z.string().min(1);

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
  /** A missing record or panel has no saved open state, so the default rule applies. */
  open: z.object({ right: z.boolean().optional(), bottom: z.boolean().optional() }).optional(),
});

type PersistedLayout = z.infer<typeof persistedLayoutSchema>;

/** The saved part of an entry. Terminals end on restart, and the New tab is not kept. */
const toPersistedTab = (entry: PanelTabEntry): PersistedPanelTab | null => {
  if (entry.kind === "browser") return { kind: "browser", tabId: entry.tabId };
  if (isToolTabKind(entry.kind)) return { kind: entry.kind };
  return null;
};

const toPersistedLayout = (
  layout: SessionPanelLayout,
  openState: SessionPanelsOpenState,
): PersistedLayout => {
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
  for (const [key, entryId] of Object.entries(layout.selectedRight)) {
    if (entryId === undefined) continue;
    selectedRight[key] = savedSelection(entryId);
  }
  const record: PersistedLayout = {
    version: 2,
    panels,
    closedKinds: [...layout.closedKinds],
    selectedRight,
    selectedBottom: savedSelection(layout.selectedBottom),
  };
  const bottom = savedBottomOpen(openState.bottom);
  if (openState.right !== null || bottom !== null) {
    record.open = {};
    if (openState.right !== null) record.open.right = openState.right;
    if (bottom !== null) record.open.bottom = bottom;
  }
  return record;
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

export const NO_SAVED_PANELS: SessionPanelsOpenState = { right: null, bottom: "default" };

type StoreEntry = {
  owner: SessionPanelOwner;
  layout: SessionPanelLayout;
  panels: SessionPanelsOpenState;
  bottomCheck: BottomPanelCheck;
  /** The last saved or restored record, so a change of live entries only does not write. */
  savedRecord: string | null;
  readError: string | null;
};

/**
 * Restores the saved layout and open state of an owner. A failed read starts an empty layout
 * without a saved open state, and keeps the error.
 */
const readEntry = (storage: ClientStorage, owner: SessionPanelOwner): StoreEntry => {
  const empty: StoreEntry = {
    owner,
    layout: emptySessionPanelLayout(),
    panels: NO_SAVED_PANELS,
    bottomCheck: NO_BOTTOM_CHECK,
    savedRecord: null,
    readError: null,
  };
  try {
    const key = sessionPanelLayoutStorageKey(owner);
    const saved = storage.getItem(key);
    if (saved !== null) {
      const record = persistedLayoutSchema.parse(JSON.parse(saved));
      const panels: SessionPanelsOpenState = {
        right: record.open?.right ?? null,
        bottom: bottomStateFromSaved(record.open?.bottom ?? null),
      };
      return {
        ...empty,
        layout: fromPersistedLayout(record),
        panels,
        savedRecord: saved,
      };
    }
    // A layout of an app version before browser tabs upgrades once, then only v2 stays.
    const oldKey = ownerStorageKey(V1_STORAGE_PREFIX, owner);
    const old = storage.getItem(oldKey);
    if (old === null) return empty;
    const layout = fromV1Record(old);
    const record = JSON.stringify(toPersistedLayout(layout, NO_SAVED_PANELS));
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
type SessionPanelLayoutPruneInput =
  | { kind: "workspaces"; ids: ReadonlySet<string> }
  | { kind: "tasks"; workspaceId: string; ids: ReadonlySet<string> }
  | { kind: "chats"; workspaceId: string; ids: ReadonlySet<string> };

const isStaleOwner = (owner: StoredOwner, input: SessionPanelLayoutPruneInput): boolean => {
  if (input.kind === "workspaces") return !input.ids.has(owner.workspaceId);
  if (owner.workspaceId !== input.workspaceId) return false;
  if (input.kind === "tasks") return owner.kind === "task" && !input.ids.has(owner.ownerId);
  return owner.kind === "chat" && !input.ids.has(owner.ownerId);
};
