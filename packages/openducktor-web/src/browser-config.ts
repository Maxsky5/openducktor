const browserEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;

const DEFAULT_BROWSER_BACKEND_URL = "http://127.0.0.1:14327";

export const getBrowserBackendUrl = (): string => {
  return browserEnv?.VITE_ODT_BROWSER_BACKEND_URL?.trim() || DEFAULT_BROWSER_BACKEND_URL;
};
