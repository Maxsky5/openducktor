type BrowserEnv = Record<string, string | undefined> | undefined;
export type BrowserRuntimeConfig = {
  backendUrl?: string;
  appToken?: string;
};

let browserRuntimeConfig: BrowserRuntimeConfig | undefined;

export const configureBrowserRuntimeConfig = (config: BrowserRuntimeConfig): void => {
  browserRuntimeConfig = config;
};

export const resetBrowserRuntimeConfig = (): void => {
  browserRuntimeConfig = undefined;
};

const readBrowserEnv = (): BrowserEnv =>
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ??
  (typeof process !== "undefined" ? process.env : undefined);

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

const readBrowserLocationOrigin = (): string | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.location.origin;
};

const readBrowserRuntimeConfig = (): BrowserRuntimeConfig | undefined => {
  return browserRuntimeConfig;
};

const requireBrowserEnvValue = (env: BrowserEnv, key: string, description: string): string => {
  const value = env?.[key]?.trim();
  if (!value) {
    throw new Error(
      `OpenDucktor web is missing ${description}. Start the app through @openducktor/web so the launcher can inject ${key}.`,
    );
  }

  return value;
};

const parseLoopbackHttpOrigin = (rawUrl: string): URL => {
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

  return parsed;
};

const hostForOrigin = (hostname: string): string => {
  if (hostname === "::1" || hostname === "[::1]") {
    return "[::1]";
  }

  return hostname;
};

const alignBackendOriginWithBrowserOrigin = (
  backendOrigin: URL,
  browserOrigin?: string,
): string => {
  if (!browserOrigin) {
    return backendOrigin.origin;
  }

  let frontendOrigin: URL;
  try {
    frontendOrigin = new URL(browserOrigin);
  } catch {
    return backendOrigin.origin;
  }

  if (frontendOrigin.protocol !== "http:" || !LOOPBACK_HOSTS.has(frontendOrigin.hostname)) {
    return backendOrigin.origin;
  }

  return new URL(
    `${frontendOrigin.protocol}//${hostForOrigin(frontendOrigin.hostname)}:${backendOrigin.port}`,
  ).origin;
};

const normalizeLoopbackHttpUrl = (rawUrl: string, browserOrigin?: string): string => {
  const parsed = parseLoopbackHttpOrigin(rawUrl);

  return alignBackendOriginWithBrowserOrigin(parsed, browserOrigin);
};

export const getBrowserBackendUrl = (
  env: BrowserEnv = readBrowserEnv(),
  browserOrigin: string | undefined = readBrowserLocationOrigin(),
): string =>
  normalizeLoopbackHttpUrl(
    readBrowserRuntimeConfig()?.backendUrl?.trim() ||
      requireBrowserEnvValue(env, "VITE_ODT_BROWSER_BACKEND_URL", "the local web host URL"),
    browserOrigin,
  );

export const getBrowserAuthToken = (env: BrowserEnv = readBrowserEnv()): string =>
  readBrowserRuntimeConfig()?.appToken?.trim() ||
  requireBrowserEnvValue(env, "VITE_ODT_BROWSER_AUTH_TOKEN", "the local web host app token");
