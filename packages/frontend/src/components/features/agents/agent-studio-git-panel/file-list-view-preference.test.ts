import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { withCapturedConsole } from "@/test-utils/console-capture";
import {
  FILE_LIST_VIEW_MODE_STORAGE_KEY,
  readFileListViewMode,
  useFileListViewModeStore,
} from "./file-list-view-preference";

const createMemoryStorage = ({ failWrites = false }: { failWrites?: boolean } = {}): Storage => {
  const values = new Map<string, string>();
  return {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => {
      if (failWrites) {
        throw new Error("Storage is full.");
      }
      values.set(key, value);
    },
  };
};

const originalStorage = globalThis.localStorage;
let storage: Storage;

const useStorage = (next: Storage): void => {
  storage = next;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: next });
};

beforeEach(() => {
  useStorage(createMemoryStorage());
});

afterEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: originalStorage,
  });
  useFileListViewModeStore.setState({ viewMode: "tree" });
});

describe("readFileListViewMode", () => {
  test("uses tree view when no view is saved", () => {
    expect(readFileListViewMode()).toBe("tree");
  });

  test("reads the saved view", () => {
    storage.setItem(FILE_LIST_VIEW_MODE_STORAGE_KEY, "list");

    expect(readFileListViewMode()).toBe("list");
  });

  test("reports an invalid saved view and uses tree view", async () => {
    storage.setItem(FILE_LIST_VIEW_MODE_STORAGE_KEY, "grid");

    await withCapturedConsole("error", (calls) => {
      expect(readFileListViewMode()).toBe("tree");
      expect(calls).toHaveLength(1);
    });
  });
});

describe("useFileListViewModeStore", () => {
  test("saves a new view for the next app start", () => {
    useFileListViewModeStore.getState().setViewMode("list");

    expect(useFileListViewModeStore.getState().viewMode).toBe("list");
    expect(storage.getItem(FILE_LIST_VIEW_MODE_STORAGE_KEY)).toBe("list");
  });

  test("does nothing when the view does not change", () => {
    useFileListViewModeStore.getState().setViewMode("tree");

    expect(storage.getItem(FILE_LIST_VIEW_MODE_STORAGE_KEY)).toBeNull();
  });

  test("keeps the new view for this session when it cannot be saved", async () => {
    useStorage(createMemoryStorage({ failWrites: true }));

    await withCapturedConsole("error", (calls) => {
      useFileListViewModeStore.getState().setViewMode("list");

      expect(useFileListViewModeStore.getState().viewMode).toBe("list");
      expect(calls).toHaveLength(1);
    });
  });
});
