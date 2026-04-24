type BrowserEnv = Record<string, string | undefined> | undefined;

const readBrowserEnv = (): BrowserEnv =>
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ??
  (typeof process !== "undefined" ? process.env : undefined);

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

const requireBrowserEnvValue = (env: BrowserEnv, key: string, description: string): string => {
  const value = env?.[key]?.trim();
  if (!value) {
    throw new Error(
      `OpenDucktor web is missing ${description}. Start the app through @openducktor/web so the launcher can inject ${key}.`,
    );
  }

  return value;
};

const normalizeLoopbackHttpUrl = (rawUrl: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch (error) {
    throw new Error(
      `OpenDucktor web backend URL is invalid. Start the app through @openducktor/web.`,
      { cause: error },
    );
  }

  if (parsed.protocol !== "http:") {
    throw new Error("OpenDucktor web backend URL must use http on a loopback interface.");
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error("OpenDucktor web backend URL must target 127.0.0.1, localhost, or [::1].");
  }
  if (!parsed.port) {
    throw new Error("OpenDucktor web backend URL must include an explicit port.");
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      "OpenDucktor web backend URL must be an origin only, without credentials, path, query, or fragment.",
    );
  }

  return parsed.origin;
};

export const getBrowserBackendUrl = (env: BrowserEnv = readBrowserEnv()): string =>
  normalizeLoopbackHttpUrl(
    requireBrowserEnvValue(env, "VITE_ODT_BROWSER_BACKEND_URL", "the local web host URL"),
  );

export const getBrowserAuthToken = (env: BrowserEnv = readBrowserEnv()): string =>
  requireBrowserEnvValue(env, "VITE_ODT_BROWSER_AUTH_TOKEN", "the local web host app token");
