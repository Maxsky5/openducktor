import { useCallback, useEffect, useState } from "react";
import type { RepoSettingsInput } from "@/types/state-slices";

export const REPO_SETTINGS_UPDATED_EVENT = "odt:repo-settings-updated";

type RepoSettingsUpdatedEventDetail = {
  repoPath: string;
};

export function useAgentStudioRepoSettings(args: {
  activeRepo: string | null;
  loadRepoSettings: () => Promise<RepoSettingsInput>;
}): {
  repoSettings: RepoSettingsInput | null;
} {
  const { activeRepo, loadRepoSettings } = args;
  const [repoSettings, setRepoSettings] = useState<RepoSettingsInput | null>(null);

  const reloadRepoSettings = useCallback(() => {
    if (!activeRepo) {
      setRepoSettings(null);
      return () => {};
    }

    let cancelled = false;
    void loadRepoSettings()
      .then((settings) => {
        if (!cancelled) {
          setRepoSettings(settings);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRepoSettings(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeRepo, loadRepoSettings]);

  useEffect(() => {
    return reloadRepoSettings();
  }, [reloadRepoSettings]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleRepoSettingsUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<RepoSettingsUpdatedEventDetail>;
      const repoPath = customEvent.detail?.repoPath;
      if (!repoPath || !activeRepo || repoPath !== activeRepo) {
        return;
      }

      reloadRepoSettings();
    };

    window.addEventListener(REPO_SETTINGS_UPDATED_EVENT, handleRepoSettingsUpdated);
    return () => {
      window.removeEventListener(REPO_SETTINGS_UPDATED_EVENT, handleRepoSettingsUpdated);
    };
  }, [activeRepo, reloadRepoSettings]);

  return {
    repoSettings,
  };
}
