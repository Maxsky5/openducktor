import { useCallback } from "react";
import { useShellPlatform } from "./shell-platform";

export type ExternalUrlOpener = (url: string) => Promise<void>;

export const useOpenExternalUrl = (): ExternalUrlOpener => {
  const { openExternalUrl } = useShellPlatform();
  return useCallback(
    async (url) => {
      const trimmed = url.trim();
      if (!trimmed) throw new Error("Cannot open an empty URL.");
      await openExternalUrl(trimmed);
    },
    [openExternalUrl],
  );
};
