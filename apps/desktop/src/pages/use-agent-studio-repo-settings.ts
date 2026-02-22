import { useEffect, useState } from "react";
import type { RepoSettingsInput } from "@/types/state-slices";

export function useAgentStudioRepoSettings(args: {
  activeRepo: string | null;
  loadRepoSettings: () => Promise<RepoSettingsInput>;
}): {
  repoSettings: RepoSettingsInput | null;
} {
  const { activeRepo, loadRepoSettings } = args;
  const [repoSettings, setRepoSettings] = useState<RepoSettingsInput | null>(null);

  useEffect(() => {
    if (!activeRepo) {
      setRepoSettings(null);
      return;
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

  return {
    repoSettings,
  };
}
