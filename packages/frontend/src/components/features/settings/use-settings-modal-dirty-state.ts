import type { SettingsSnapshot } from "@openducktor/contracts";
import { useCallback, useState } from "react";

export type DirtySections = {
  general: boolean;
  appearance: boolean;
  chat: boolean;
  reusablePrompts: boolean;
  globalGit: boolean;
  agentRuntimes?: boolean;
  kanban: boolean;
  autopilot: boolean;
  globalPromptOverrides: boolean;
  repoSettings: boolean;
};

export const EMPTY_DIRTY_SECTIONS: DirtySections = {
  general: false,
  appearance: false,
  chat: false,
  reusablePrompts: false,
  globalGit: false,
  agentRuntimes: false,
  kanban: false,
  autopilot: false,
  globalPromptOverrides: false,
  repoSettings: false,
};

type UseSettingsModalDirtyStateArgs = {
  open: boolean;
  loadedSnapshot: SettingsSnapshot | null;
};

type SettingsModalDirtyState = {
  dirtySections: DirtySections;
  markDirty: (section: keyof DirtySections) => void;
};

export const useSettingsModalDirtyState = ({
  open,
  loadedSnapshot,
}: UseSettingsModalDirtyStateArgs): SettingsModalDirtyState => {
  const [dirtySections, setDirtySections] = useState<DirtySections>(EMPTY_DIRTY_SECTIONS);
  const [resetInputs, setResetInputs] = useState({ loadedSnapshot, open });

  const markDirty = useCallback((section: keyof DirtySections): void => {
    setDirtySections((current) => {
      if (current[section]) {
        return current;
      }

      return {
        ...current,
        [section]: true,
      };
    });
  }, []);

  if (resetInputs.open !== open || resetInputs.loadedSnapshot !== loadedSnapshot) {
    setResetInputs({ loadedSnapshot, open });
    if (!open || loadedSnapshot) {
      setDirtySections(EMPTY_DIRTY_SECTIONS);
    }
  }

  return {
    dirtySections,
    markDirty,
  };
};
