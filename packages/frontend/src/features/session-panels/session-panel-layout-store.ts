import { toast } from "sonner";
import { z } from "zod";
import { errorMessage } from "@/lib/errors";
import { isToolTabKind, TOOL_TAB_KINDS, type ToolTabKind } from "./panel-tab-kinds";
import {
  emptySessionPanelLayout,
  type PanelTabEntry,
  type SessionPanelLayout,
  SESSION_PANEL_SELECTION_KEYS,
  type SessionPanelOwner,
  sessionPanelOwnerKey,
} from "./session-panel-layout";

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

const entries = new Map<string, StoreEntry>();
const listeners = new Set<() => void>();
let layoutsSnapshot: ReadonlyMap<string, SessionPanelLayout> = new Map();

const notify = (): void => {
  layoutsSnapshot = new Map([...entries].map(([ownerKey, entry]) => [ownerKey, entry.layout]));
  for (const listener of listeners) listener();
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

const readEntry = (owner: SessionPanelOwner): StoreEntry => {
  try {
    const saved = globalThis.localStorage.getItem(sessionPanelLayoutStorageKey(owner));
    if (saved === null) {
      return {
        owner,
        layout: emptySessionPanelLayout(),
        savedRecord: null,
        readError: null,
        writeErrorShown: false,
      };
    }
    const record = persistedLayoutSchema.parse(JSON.parse(saved));
    return {
      owner,
      layout: fromPersistedLayout(record),
      savedRecord: saved,
      readError: null,
      writeErrorShown: false,
    };
  } catch (error) {
    console.error("[session-panels] Failed to read the saved panel layout.", { owner, error });
    return {
      owner,
      layout: emptySessionPanelLayout(),
      savedRecord: null,
      readError: errorMessage(error),
      writeErrorShown: false,
    };
  }
};

const entryFor = (owner: SessionPanelOwner): StoreEntry => {
  const key = sessionPanelOwnerKey(owner);
  let entry = entries.get(key);
  if (!entry) {
    entry = readEntry(owner);
    entries.set(key, entry);
  }
  return entry;
};

export const subscribeSessionPanelLayouts = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * The layouts in memory by owner key. A new map replaces it on each change. An owner that was only
 * read since the last change shows after the next change.
 */
export const sessionPanelLayoutsSnapshot = (): ReadonlyMap<string, SessionPanelLayout> =>
  layoutsSnapshot;

/** Reads the layout of an owner. The first read restores the saved layout. */
export const readSessionPanelLayout = (owner: SessionPanelOwner): SessionPanelLayout =>
  entryFor(owner).layout;

/** Returns the restore failure of an owner one time, so the app reports it once. */
export const takeSessionPanelLayoutReadError = (owner: SessionPanelOwner): string | null => {
  const entry = entryFor(owner);
  const error = entry.readError;
  entry.readError = null;
  return error;
};

export const updateSessionPanelLayout = (
  owner: SessionPanelOwner,
  update: (layout: SessionPanelLayout) => SessionPanelLayout,
): void => {
  const entry = entryFor(owner);
  const layout = update(entry.layout);
  if (layout === entry.layout) return;
  entry.layout = layout;
  const record = JSON.stringify(toPersistedLayout(layout));
  if (record !== entry.savedRecord) {
    try {
      globalThis.localStorage.setItem(sessionPanelLayoutStorageKey(owner), record);
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

let pruneErrorShown = false;

const removeStaleRecords = (input: SessionPanelLayoutPruneInput): void => {
  try {
    const storage = globalThis.localStorage;
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

/** Removes the saved and in-memory layouts of tasks, chats, and workspaces that no longer exist. */
export const pruneSessionPanelLayouts = (input: SessionPanelLayoutPruneInput): void => {
  removeStaleRecords(input);

  let removedMemory = false;
  for (const [ownerKey, entry] of entries) {
    if (isStaleOwner(storedOwner(entry.owner), input)) {
      entries.delete(ownerKey);
      removedMemory = true;
    }
  }
  if (removedMemory) notify();
};
