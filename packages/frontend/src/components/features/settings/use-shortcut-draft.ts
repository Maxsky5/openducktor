import { createContext, use, useCallback, useState } from "react";
import { jsonValuesEqual, type ShortcutPreferences } from "@openducktor/contracts";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { useShortcutPreferences } from "@/features/shortcuts/use-shortcut-preferences";

/**
 * The unsaved keyboard shortcuts of the Settings form. Edits change only this draft; "Save
 * settings" writes it with the rest of the form, and Cancel discards it.
 */
export type ShortcutDraft = {
  /** What Settings shows: the draft, else the saved preferences. Undefined until they load. */
  preferences: ShortcutPreferences | undefined;
  dirty: boolean;
  update(next: ShortcutPreferences): void;
  discard(): void;
  /** Writes a changed draft. Resolves false and keeps the draft and the error when it fails. */
  save(): Promise<boolean>;
  saving: boolean;
  saveError: string | null;
};

const samePreferences = (left: ShortcutPreferences, right: ShortcutPreferences) =>
  jsonValuesEqual(left.overrides, right.overrides) &&
  jsonValuesEqual(left.when ?? {}, right.when ?? {});

export function useShortcutDraft(): ShortcutDraft {
  const { query, save } = useShortcutPreferences();
  const [draft, setDraft] = useState<ShortcutPreferences | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saved = query.data;
  const dirty = Boolean(draft && saved && !samePreferences(draft, saved));
  const { mutateAsync } = save;
  const persist = useCallback(async (): Promise<boolean> => {
    if (!draft || !dirty) return true;
    try {
      await mutateAsync(draft);
      setDraft(null);
      setSaveError(null);
      return true;
    } catch (cause) {
      setSaveError(`Keyboard shortcuts were not saved. ${errorMessage(cause)}`);
      return false;
    }
  }, [draft, dirty, mutateAsync]);
  return {
    preferences: draft ?? saved,
    dirty,
    update: setDraft,
    discard: () => {
      setDraft(null);
      setSaveError(null);
    },
    save: persist,
    saving: save.isPending,
    saveError,
  };
}

export const ShortcutDraftContext = createContext<ShortcutDraft | null>(null);

export function useShortcutDraftContext(): ShortcutDraft {
  const draft = use(ShortcutDraftContext);
  if (!draft) throw new Error("Keyboard shortcut settings require the Settings form.");
  return draft;
}
