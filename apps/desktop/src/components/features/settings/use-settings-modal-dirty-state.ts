import type { SettingsSnapshot } from "@openducktor/contracts";
import { useCallback, useEffect, useState } from "react";

export type DirtySections = {
  chat: boolean;
  globalGit: boolean;
  kanban: boolean;
  autopilot: boolean;
  globalPromptOverrides: boolean;
  repoSettings: boolean;
};

export const EMPTY_DIRTY_SECTIONS: DirtySections = {
  chat: false,
  globalGit: false,
  kanban: false,
  autopilot: false,
  globalPromptOverrides: false,
  repoSettings: false,
};

type UseSettingsModalDirtyStateArgs = {
  open: boolean;
  loadedSnapshot: SettingsSnapshot | null;
  onDirtyChange?: () => void;
};

type SettingsModalDirtyState = {
  dirtySections: DirtySections;
  markDirty: (section: keyof DirtySections) => void;
};

export const useSettingsModalDirtyState = ({
  open,
  loadedSnapshot,
  onDirtyChange,
}: UseSettingsModalDirtyStateArgs): SettingsModalDirtyState => {
  const [dirtySections, setDirtySections] = useState<DirtySections>(EMPTY_DIRTY_SECTIONS);

  const markDirty = useCallback(
    (section: keyof DirtySections): void => {
      onDirtyChange?.();
      setDirtySections((current) => {
        if (current[section]) {
          return current;
        }

        return {
          ...current,
          [section]: true,
        };
      });
    },
    [onDirtyChange],
  );

  useEffect(() => {
    if (!open) {
      setDirtySections(EMPTY_DIRTY_SECTIONS);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !loadedSnapshot) {
      return;
    }

    setDirtySections(EMPTY_DIRTY_SECTIONS);
  }, [loadedSnapshot, open]);

  return {
    dirtySections,
    markDirty,
  };
};
