import { Effect } from "effect";
import { z } from "zod";
import { runWebSyncBoundary, WebValidationError } from "./effect/web-errors";
import {
  formatHost,
  isLoopbackHost,
  LOOPBACK_HOSTS,
  parseHttpOriginEffect,
  portOfHttpOrigin,
} from "./http-origin";

type BrowserEnvValues = {
  VITE_ODT_BROWSER_AUTH_TOKEN?: string;
  VITE_ODT_BROWSER_BACKEND_URL?: string;
};
type BrowserEnv = BrowserEnvValues | undefined;
type BrowserEnvKey = keyof BrowserEnvValues;
export type BrowserRuntimeConfig = {
  backendUrl?: string;
  appToken?: string;
};

let browserRuntimeConfig: BrowserRuntimeConfig | undefined;

export const configureBrowserRuntimeConfig = (config: BrowserRuntimeConfig): void => {
  browserRuntimeConfig = config;
};

const readBrowserEnv = (): BrowserEnv => {
  const processEnv = globalThis.process === undefined ? undefined : process.env;
  const viteBackendUrl: unknown = import.meta.env.VITE_ODT_BROWSER_BACKEND_URL;
  const viteAuthToken: unknown = import.meta.env.VITE_ODT_BROWSER_AUTH_TOKEN;
  const parsedBackendUrl = z.string().safeParse(viteBackendUrl);
  const parsedAuthToken = z.string().safeParse(viteAuthToken);
  const backendUrl =
    (parsedBackendUrl.success ? parsedBackendUrl.data : undefined) ??
    processEnv?.VITE_ODT_BROWSER_BACKEND_URL;
  const authToken =
    (parsedAuthToken.success ? parsedAuthToken.data : undefined) ??
    processEnv?.VITE_ODT_BROWSER_AUTH_TOKEN;
  const env: BrowserEnvValues = {};
  if (backendUrl !== undefined) {
    env.VITE_ODT_BROWSER_BACKEND_URL = backendUrl;
  }
  if (authToken !== undefined) {
    env.VITE_ODT_BROWSER_AUTH_TOKEN = authToken;
  }
  return env;
};

const OPAQUE_BROWSER_ORIGIN = "null";

const isUsableBrowserOrigin = (origin: string | undefined): origin is string =>
  origin !== undefined && origin.length > 0 && origin !== OPAQUE_BROWSER_ORIGIN;

const readBrowserLocationOrigin = (): string | undefined => {
  if (globalThis.window === undefined) {
    return undefined;
  }

  const origin = window.location.origin;
  return isUsableBrowserOrigin(origin) ? origin : undefined;
};

const readBrowserRuntimeConfig = (): BrowserRuntimeConfig | undefined => {
  return browserRuntimeConfig;
};

const requireBrowserEnvValueEffect = (
  env: BrowserEnv,
  key: BrowserEnvKey,
  description: string,
): Effect.Effect<string, WebValidationError> =>
  Effect.gen(function* () {
    const value = env?.[key]?.trim();
    if (!value) {
      return yield* new WebValidationError({
        field: key,
        message: `OpenDucktor web is missing ${description}. Start the app through @openducktor/web so the launcher can inject ${key}.`,
      });
    }

    return value;
  });

const originWithPath = (url: URL): string => {
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/u, "");
  return `${url.origin}${path}`;
};

const isHttpLoopbackOrigin = (url: URL): boolean =>
  url.protocol === "http:" && isLoopbackHost(url.hostname);

const alignBackendOriginWithBrowserOriginEffect = (
  backendOrigin: URL,
  browserOrigin?: string,
): Effect.Effect<string, WebValidationError> =>
  Effect.gen(function* () {
    if (!isUsableBrowserOrigin(browserOrigin)) {
      return originWithPath(backendOrigin);
    }

    const frontendOrigin = yield* Effect.try({
      try: () => new URL(browserOrigin),
      catch: (cause) =>
        new WebValidationError({
          message: "OpenDucktor web browser origin is invalid.",
          cause,
          details: { browserOrigin },
        }),
    });

    if (!isHttpLoopbackOrigin(frontendOrigin) || !isHttpLoopbackOrigin(backendOrigin)) {
      return originWithPath(backendOrigin);
    }

    if (frontendOrigin.hostname === backendOrigin.hostname) {
      return originWithPath(backendOrigin);
    }
    if (!LOOPBACK_HOSTS.has(frontendOrigin.hostname)) {
      return yield* new WebValidationError({
        message: `OpenDucktor web cannot use ${frontendOrigin.hostname} in place of the configured backend hostname. Open the launcher URL or configure --external-url with the desired browser origin.`,
        details: { browserOrigin, rawUrl: backendOrigin.href },
      });
    }

    const alignedUrl = new URL(
      `${frontendOrigin.protocol}//${formatHost(frontendOrigin.hostname)}:${portOfHttpOrigin(
        backendOrigin,
      )}${backendOrigin.pathname}`,
    );
    return originWithPath(alignedUrl);
  });

const normalizeHttpUrlEffect = (
  rawUrl: string,
  browserOrigin?: string,
  options: { allowPath?: boolean } = {},
): Effect.Effect<string, WebValidationError> =>
  Effect.gen(function* () {
    const parsed = yield* parseHttpOriginEffect(rawUrl, undefined, {
      ...options,
      remediation: "Start the app through @openducktor/web.",
    });

    return yield* alignBackendOriginWithBrowserOriginEffect(parsed, browserOrigin);
  });

export const getBrowserBackendUrlEffect = (
  env: BrowserEnv = readBrowserEnv(),
  browserOrigin: string | undefined = readBrowserLocationOrigin(),
): Effect.Effect<string, WebValidationError> =>
  Effect.gen(function* () {
    const configuredUrl = readBrowserRuntimeConfig()?.backendUrl?.trim();
    const rawUrl = configuredUrl
      ? configuredUrl
      : yield* requireBrowserEnvValueEffect(
          env,
          "VITE_ODT_BROWSER_BACKEND_URL",
          "the local web host URL",
        );
    return yield* normalizeHttpUrlEffect(rawUrl, browserOrigin, {
      allowPath: true,
    });
  });

export const getBrowserBackendUrl = (
  env: BrowserEnv = readBrowserEnv(),
  browserOrigin: string | undefined = readBrowserLocationOrigin(),
): string => runWebSyncBoundary(getBrowserBackendUrlEffect(env, browserOrigin));

export const getBrowserAuthTokenEffect = (
  env: BrowserEnv = readBrowserEnv(),
): Effect.Effect<string, WebValidationError> =>
  Effect.gen(function* () {
    const configuredToken = readBrowserRuntimeConfig()?.appToken?.trim();
    if (configuredToken) {
      return configuredToken;
    }
    return yield* requireBrowserEnvValueEffect(
      env,
      "VITE_ODT_BROWSER_AUTH_TOKEN",
      "the local web host app token",
    );
  });

export const getBrowserAuthToken = (env: BrowserEnv = readBrowserEnv()): string =>
  runWebSyncBoundary(getBrowserAuthTokenEffect(env));
