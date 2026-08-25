import { type SystemOpenInToolId, systemOpenInToolIdValues } from "@openducktor/contracts";
import { toRightPanelStorageKey } from "@/pages/agents/agents-page-selection";
import { z } from "zod";

const systemOpenInToolIdSet = new Set<string>(systemOpenInToolIdValues);
const persistedOpenInPreferenceSchema = z.object({
  openInToolId: z.string().optional(),
});

const isSystemOpenInToolId = (value: string): value is SystemOpenInToolId =>
  systemOpenInToolIdSet.has(value);

const openInPreferencesStorageKey = (): string => toRightPanelStorageKey();

export function readPreferredOpenInTool(): SystemOpenInToolId | null {
  if (typeof globalThis.localStorage === "undefined") {
    return null;
  }

  const storageKey = openInPreferencesStorageKey();

  try {
    const raw = globalThis.localStorage.getItem(storageKey);
    if (!raw) {
      return null;
    }

    const parsed = persistedOpenInPreferenceSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return null;
    }

    const toolId = parsed.data.openInToolId;
    if (typeof toolId !== "string" || !isSystemOpenInToolId(toolId)) {
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
  if (typeof globalThis.localStorage === "undefined") {
    return;
  }

  const storageKey = openInPreferencesStorageKey();

  try {
    const raw = globalThis.localStorage.getItem(storageKey);
    const parsed = raw ? persistedOpenInPreferenceSchema.safeParse(JSON.parse(raw)) : null;
    const nextValue = parsed?.success
      ? { ...parsed.data, openInToolId: toolId }
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
