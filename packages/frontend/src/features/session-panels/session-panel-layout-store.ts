import { toast } from "sonner";
import { z } from "zod";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import type { ClientStorage } from "@openducktor/frontend-core/platform/client-storage";
import { perConnection } from "@/lib/per-connection";
import { isToolTabKind, TOOL_TAB_KINDS, type ToolTabKind } from "./panel-tab-kinds";
import {
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
  /** Removes the saved and in-memory layouts of tasks, chats, and workspaces that no longer exist. */
  prune: (input: SessionPanelLayoutPruneInput) => void;
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

  const removeStaleRecords = (input: SessionPanelLayoutPruneInput): void => {
    try {
      const staleKeys: string[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        const owner = key === null ? null : parseStorageKey(key);
        if (key !== null && owner !== null && isStaleOwner(owner, input)) staleKeys.push(key);
      }
      for (const key of staleKeys) storage.removeItem(key);
    } catch (error) {
      console.error("[session-panels] Failed to remove old panel layouts.", { error });
      if (pruneErrorShown) return;
      pruneErrorShown = true;
      toast.error("Could not remove old panel layouts", {
        description: `${errorMessage(error)} Saved layouts of removed tasks and chats stay on this computer.`,
      });
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
      removeStaleRecords(input);
      let removed = false;
      for (const [ownerKey, entry] of entries) {
        if (isStaleOwner(storedOwner(entry.owner), input)) {
          entries.delete(ownerKey);
          removed = true;
        }
      }
      if (removed) notify();
    },
  };
};

const STORAGE_PREFIX = "openducktor:session-panel-layout:v1:";

const toolTabKindSchema = z.enum(TOOL_TAB_KINDS);
const selectionKeySchema = z.enum(SESSION_PANEL_SELECTION_KEYS);
const persistedLayoutSchema = z.object({
  version: z.literal(1),
  panels: z.object({ right: z.array(toolTabKindSchema), bottom: z.array(toolTabKindSchema) }),
  closedKinds: z.array(toolTabKindSchema),
  /** Null keeps a selection whose tab is gone, such as a terminal that ended on restart. */
  selectedRight: z.partialRecord(selectionKeySchema, toolTabKindSchema.nullable()),
});

type PersistedLayout = z.infer<typeof persistedLayoutSchema>;

/** The saved part of a layout. Terminals end on restart, so the record has tool tabs only. */
const toPersistedLayout = (layout: SessionPanelLayout): PersistedLayout => {
  const toolKinds = (entries: PanelTabEntry[]): ToolTabKind[] =>
    entries.flatMap((entry) => (isToolTabKind(entry.kind) ? [entry.kind] : []));
  const selectedRight: PersistedLayout["selectedRight"] = {};
  for (const key of SESSION_PANEL_SELECTION_KEYS) {
    const entryId = layout.selectedRight[key];
    if (entryId === undefined) continue;
    selectedRight[key] = entryId !== null && isToolTabKind(entryId) ? entryId : null;
  }
  return {
    version: 1,
    panels: { right: toolKinds(layout.panels.right), bottom: toolKinds(layout.panels.bottom) },
    closedKinds: [...layout.closedKinds],
    selectedRight,
  };
};

const fromPersistedLayout = (record: PersistedLayout): SessionPanelLayout => {
  const entries = (kinds: ToolTabKind[]): PanelTabEntry[] =>
    kinds.map((kind) => ({ id: kind, kind }));
  return {
    panels: { right: entries(record.panels.right), bottom: entries(record.panels.bottom) },
    closedKinds: [...record.closedKinds],
    selectedRight: { ...record.selectedRight },
    selectedBottom: null,
  };
};

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
    const saved = storage.getItem(sessionPanelLayoutStorageKey(owner));
    if (saved === null) return empty;
    const record = persistedLayoutSchema.parse(JSON.parse(saved));
    return { ...empty, layout: fromPersistedLayout(record), savedRecord: saved };
  } catch (error) {
    console.error("[session-panels] Failed to read the saved panel layout.", { owner, error });
    return { ...empty, readError: errorMessage(error) };
  }
};

export const sessionPanelLayoutStorageKey = (owner: SessionPanelOwner): string => {
  const { workspaceId, kind, ownerId } = storedOwner(owner);
  return `${STORAGE_PREFIX}${[workspaceId, kind, ownerId].map(encodeURIComponent).join(":")}`;
};

type StoredOwner = { workspaceId: string; kind: string; ownerId: string };

const parseStorageKey = (key: string): StoredOwner | null => {
  if (!key.startsWith(STORAGE_PREFIX)) return null;
  const [workspaceId, kind, ownerId, ...rest] = key
    .slice(STORAGE_PREFIX.length)
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
