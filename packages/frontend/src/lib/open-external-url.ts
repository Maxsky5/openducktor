import { getShellBridge } from "./shell-bridge";

export const openExternalUrl = async (url: string): Promise<void> => {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error("Cannot open an empty URL.");
  }

  await getShellBridge().openExternalUrl(trimmed);
};
