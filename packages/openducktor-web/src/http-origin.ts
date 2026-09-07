import { Effect } from "effect";
import { WebValidationError } from "./effect/web-errors";

export const LOCALHOST = "127.0.0.1";
export const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

const stripTrailingDot = (host: string): string => host.replace(/\.$/u, "");

export const isLoopbackHost = (host: string): boolean => LOOPBACK_HOSTS.has(stripTrailingDot(host));

export const formatHost = (host: string): string => {
  if (host.includes(":") && !host.startsWith("[")) {
    return `[${host}]`;
  }
  return host;
};

export const isIpLiteral = (host: string): boolean =>
  host.includes(":") || /^\d{1,3}(\.\d{1,3}){3}$/u.test(host);

export const portOfHttpOrigin = (url: URL): string =>
  url.port || (url.protocol === "https:" ? "443" : "80");

const originError = (
  field: string | undefined,
  input: ConstructorParameters<typeof WebValidationError>[0],
): WebValidationError =>
  new WebValidationError({
    ...input,
    ...(field !== undefined && { field }),
  });

export const isRemoteExternalOrigin = (externalUrl: string | undefined): boolean =>
  externalUrl !== undefined && !isLoopbackHost(new URL(externalUrl).hostname);

export const allowedHostnamesFor = (options: {
  bindHost: string;
  externalUrl: string | undefined;
}): ReadonlySet<string> => {
  const hostnames = new Set<string>(LOOPBACK_HOSTS);
  if (options.externalUrl !== undefined) {
    hostnames.add(stripTrailingDot(new URL(options.externalUrl).hostname));
  }
  hostnames.add(stripTrailingDot(options.bindHost));
  return hostnames;
};

export const isRequestHostAllowed = (request: Request, hostnames: ReadonlySet<string>): boolean => {
  const requestHost = request.headers.get("host");
  if (!requestHost) {
    return false;
  }
  try {
    return hostnames.has(stripTrailingDot(new URL(`http://${requestHost}`).hostname));
  } catch {
    return false;
  }
};

export const parseHttpOriginEffect = (
  rawUrl: string,
  originDescription = "OpenDucktor web backend URL",
  options: { allowPath?: boolean; field?: string; remediation?: string } = {},
): Effect.Effect<URL, WebValidationError> =>
  Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () => new URL(rawUrl),
      catch: (cause) =>
        originError(options.field, {
          message:
            options.remediation === undefined
              ? `${originDescription} is invalid.`
              : `${originDescription} is invalid. ${options.remediation}`,
          cause,
          details: { rawUrl },
        }),
    });

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return yield* originError(options.field, {
        message: `${originDescription} must use http or https.`,
        details: { rawUrl },
      });
    }
    if (!options.allowPath && parsed.pathname !== "/") {
      return yield* originError(options.field, {
        message: `${originDescription} must not include a path.`,
        details: { rawUrl },
      });
    }
    if (parsed.search || parsed.hash) {
      return yield* originError(options.field, {
        message: `${originDescription} must not include a query string or fragment.`,
        details: { rawUrl },
      });
    }
    if (parsed.username || parsed.password) {
      return yield* originError(options.field, {
        message: `${originDescription} must not include credentials.`,
        details: { rawUrl },
      });
    }
    if (parsed.port === "0") {
      return yield* originError(options.field, {
        message: `${originDescription} must not use port 0.`,
        details: { rawUrl },
      });
    }

    return parsed;
  });
