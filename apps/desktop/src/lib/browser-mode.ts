const browserEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;

const BROWSER_APP_MODE = "browser";
const DEFAULT_BROWSER_BACKEND_URL = "http://127.0.0.1:14327";

export const isBrowserAppMode = (): boolean => {
  return browserEnv?.VITE_ODT_APP_MODE === BROWSER_APP_MODE;
};

export const getBrowserBackendUrl = (): string => {
  return browserEnv?.VITE_ODT_BROWSER_BACKEND_URL?.trim() || DEFAULT_BROWSER_BACKEND_URL;
};
