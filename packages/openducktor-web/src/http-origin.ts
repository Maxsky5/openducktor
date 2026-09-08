import { Effect } from "effect";
import { WebValidationError } from "./effect/web-errors";

export const LOCALHOST = "127.0.0.1";

const invalidHostError = (raw: string, flag: string): WebValidationError =>
  new WebValidationError({
    message: `Invalid ${flag} value: ${raw}. Expected a hostname or IP address without a scheme, port, or path.`,
    field: flag,
    details: { raw },
  });

export const parseHostEffect = (
  raw: string | undefined,
  flag: string,
  allowBareIpv6 = false,
): Effect.Effect<string, WebValidationError> =>
  Effect.gen(function* () {
    if (raw === undefined) {
      return yield* new WebValidationError({
        message: `Missing value for ${flag}.`,
        field: flag,
      });
    }
    let hostname = raw.trim();
    if (hostname.includes(":") && !hostname.startsWith("[")) {
      if (!allowBareIpv6) {
        return yield* invalidHostError(raw, flag);
      }
      hostname = `[${hostname}]`;
    }
    const parsed = yield* Effect.try({
      try: () => new URL(`http://${hostname}`),
      catch: () => invalidHostError(raw, flag),
    });
    if (parsed.href !== `http://${parsed.hostname}/`) {
      return yield* invalidHostError(raw, flag);
    }
    return parsed.hostname;
  });

export const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

const stripTrailingDot = (host: string): string => host.replace(/\.$/u, "");

export const isLoopbackHost = (host: string): boolean => {
  let hostname = stripTrailingDot(host);
  // URL hostnames use compressed hex; programmatic bind hosts can use dotted IPv4.
  const mapped = /^(?:\[::ffff:([^\]]+)\]|::ffff:(.+))$/iu.exec(hostname);
  if (mapped) {
    hostname = mapped[1] ?? mapped[2] ?? "";
    if (!/^127(\.\d{1,3}){3}$/u.test(hostname)) {
      return /^7f[0-9a-f]{2}:[0-9a-f]{1,4}$/iu.test(hostname);
    }
  }
  return (
    LOOPBACK_HOSTS.has(hostname) ||
    hostname.endsWith(".localhost") ||
    (/^127(\.\d{1,3}){3}$/u.test(hostname) &&
      hostname.split(".").every((octet) => Number(octet) <= 255))
  );
};

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

    if (
      parsed.hostname === "0.0.0.0" ||
      parsed.hostname === "[::]" ||
      parsed.hostname === "[::ffff:0:0]"
    ) {
      return yield* originError(options.field, {
        message: `${originDescription} must not use a wildcard address. Use the real IP address or DNS name that browsers will reach; use wildcard addresses only for --host.`,
        details: { rawUrl },
      });
    }
    return parsed;
  });
