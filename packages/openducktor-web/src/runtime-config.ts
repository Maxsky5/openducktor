import { type BrowserRuntimeConfig, configureBrowserRuntimeConfig } from "./browser-config";

export const RUNTIME_CONFIG_PATH = "/openducktor-config.json";

const isRuntimeConfigRecord = (value: unknown): value is BrowserRuntimeConfig => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const config = value as Record<string, unknown>;
  return typeof config.backendUrl === "string" && typeof config.appToken === "string";
};

export const loadBrowserRuntimeConfig = async (fetchImpl: typeof fetch = fetch): Promise<void> => {
  const response = await fetchImpl(RUNTIME_CONFIG_PATH, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(
      `OpenDucktor web failed to load runtime config from ${RUNTIME_CONFIG_PATH}: HTTP ${response.status}.`,
    );
  }

  const config = (await response.json()) as unknown;
  if (!isRuntimeConfigRecord(config)) {
    throw new Error(
      `OpenDucktor web runtime config from ${RUNTIME_CONFIG_PATH} is missing backendUrl or appToken.`,
    );
  }

  configureBrowserRuntimeConfig(config);
};
