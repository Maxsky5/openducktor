import type { BrowserFrameSource } from "@openducktor/contracts";

const CHECK_TIMEOUT_MS = 10_000;

type SiteFraming = Extract<BrowserFrameSource, { kind: "direct" | "refused" }>;

const defaultPort = (protocol: string): string => (protocol === "https:" ? "443" : "80");

const portOf = (url: URL): string => url.port || defaultPort(url.protocol);

/**
 * True when one `frame-ancestors` source matches the app origin. The app is an `http` page on
 * this machine, so `'self'` and `'none'` never match it.
 */
const sourceMatches = (source: string, app: URL, site: URL): boolean => {
  const value = source.toLowerCase();
  if (value === "*") return true;
  if (/^[a-z][a-z0-9+.-]*:$/.test(value)) return value === app.protocol;
  const match = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*|(?:\*\.)?[^/:]+)(?::(\d+|\*))?(?:\/.*)?$/.exec(
    value,
  );
  if (!match) return false;
  const [, scheme, host = "", port] = match;
  // A source without a scheme uses the scheme of the site, so an `https` site never names `http`.
  if ((scheme === undefined ? site.protocol : `${scheme}:`) !== app.protocol) return false;
  const hostMatches = host.startsWith("*.")
    ? app.hostname.endsWith(host.slice(1))
    : host === "*" || host === app.hostname;
  if (!hostMatches) return false;
  return port === "*" || (port ?? defaultPort(app.protocol)) === portOf(app);
};

/** The `frame-ancestors` sources of each policy that has the directive. */
const frameAncestorPolicies = (header: string | null): string[][] =>
  (header ?? "").split(",").flatMap((policy) =>
    policy.split(";").flatMap((directive) => {
      const [name, ...sources] = directive.trim().split(/\s+/);
      return name?.toLowerCase() === "frame-ancestors" ? [sources] : [];
    }),
  );

/** Reads the frame rules of a site response, as the browser of the user applies them. */
export const siteFramingFromHeaders = (
  headers: Headers,
  site: URL,
  appOrigin: string,
): SiteFraming => {
  const app = new URL(appOrigin);
  const refused: SiteFraming = {
    kind: "refused",
    message: `${site.host} does not let other sites show its pages in a frame.`,
  };
  const policies = frameAncestorPolicies(headers.get("content-security-policy"));
  // A `frame-ancestors` directive replaces `X-Frame-Options`.
  if (policies.length > 0) {
    return policies.every((sources) => sources.some((source) => sourceMatches(source, app, site)))
      ? { kind: "direct" }
      : refused;
  }
  const frameOptions = (headers.get("x-frame-options") ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase());
  return frameOptions.includes("deny") || frameOptions.includes("sameorigin")
    ? refused
    : { kind: "direct" };
};

/**
 * Asks a site whether the app can show it in a frame. The browser of the user shows only an error
 * page in a frame that a site refuses, so the app checks first and can say why.
 */
export const checkSiteFraming = async (input: {
  target: string;
  appOrigin: string;
  fetch: typeof globalThis.fetch;
}): Promise<SiteFraming> => {
  const site = new URL(input.target);
  let response: Response;
  try {
    response = await input.fetch(site, {
      redirect: "follow",
      headers: { accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
  } catch (cause) {
    const reason = cause instanceof Error && cause.cause instanceof Error ? cause.cause : cause;
    throw new Error(
      `Could not reach ${site.host}: ${reason instanceof Error ? reason.message : String(reason)}`,
      { cause },
    );
  }
  await response.body?.cancel();
  return siteFramingFromHeaders(response.headers, new URL(response.url || site), input.appOrigin);
};
