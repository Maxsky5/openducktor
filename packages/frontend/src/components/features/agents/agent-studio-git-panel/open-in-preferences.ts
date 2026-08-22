import {
  type SystemOpenInToolId,
  systemOpenInToolIdValues,
  hasRuntimeType,
} from "@openducktor/contracts";
import { toRightPanelStorageKey } from "@/pages/agents/agents-page-selection";

type PersistedOpenInPreference = {
  openInToolId?: string;
};

const systemOpenInToolIdSet = new Set<string>(systemOpenInToolIdValues);

const isSystemOpenInToolId = (value: string): value is SystemOpenInToolId =>
  systemOpenInToolIdSet.has(value);

const openInPreferencesStorageKey = (): string => toRightPanelStorageKey();

export function readPreferredOpenInTool(): SystemOpenInToolId | null {
  if (hasRuntimeType(globalThis.localStorage, "undefined")) {
    return null;
  }

  const storageKey = openInPreferencesStorageKey();

  try {
    const raw = globalThis.localStorage.getItem(storageKey);
    if (!raw) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || !hasRuntimeType(parsed, "object")) {
      return null;
    }

    // SAFETY: The preceding runtime guard establishes `PersistedOpenInPreference` before this assertion.
    const toolId = (parsed as PersistedOpenInPreference).openInToolId;
    if (!hasRuntimeType(toolId, "string") || !isSystemOpenInToolId(toolId)) {
      return null;
    }

    return toolId;
  } catch (error) {
    console.error("[agent-studio-open-in] Failed to read persisted preferred tool.", {
      storageKey,
      error,
    });
    return null;
  }
}

export function persistPreferredOpenInTool(toolId: SystemOpenInToolId): void {
  if (hasRuntimeType(globalThis.localStorage, "undefined")) {
    return;
  }

  const storageKey = openInPreferencesStorageKey();

  try {
    const raw = globalThis.localStorage.getItem(storageKey);
    // SAFETY: JSON.parse can only produce JSON data, which satisfies `unknown` at this boundary.
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    const nextValue =
      parsed && hasRuntimeType(parsed, "object")
        ? { ...parsed, openInToolId: toolId }
        : { openInToolId: toolId };
    globalThis.localStorage.setItem(storageKey, JSON.stringify(nextValue));
  } catch (error) {
    console.error("[agent-studio-open-in] Failed to persist preferred tool.", {
      storageKey,
      toolId,
      error,
    });
  }
}
