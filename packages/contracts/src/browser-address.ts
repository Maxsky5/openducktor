import { BROWSER_URL_MAX_LENGTH, parseBrowserUrl } from "./browser-url-rules";

export type BrowserAddressResult =
  | { ok: true; url: string }
  | { ok: false; reason: "empty" | "invalid" }
  | { ok: false; reason: "scheme"; scheme: string };

const SCHEME_WITH_AUTHORITY = /^([a-z][a-z0-9+.-]*):\/\//i;
// Schemes without `//` that a user can type. Text such as `localhost:3000` has no scheme.
const SCHEME_WITHOUT_AUTHORITY =
  /^(about|blob|chrome|data|devtools|file|javascript|mailto|vbscript|view-source):/i;

const isLoopbackOrPrivateIpv4 = (host: string): boolean => {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) {
    return false;
  }
  const [a = 0, b = 0] = parts.map(Number);
  return (
    a === 127 ||
    a === 10 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
};

const isLoopbackOrPrivateIpv6 = (host: string): boolean => {
  if (!host.startsWith("[") || !host.endsWith("]")) {
    return false;
  }
  const address = host.slice(1, -1).toLowerCase();
  return (
    address === "::1" ||
    address.startsWith("fc") ||
    address.startsWith("fd") ||
    address.startsWith("fe80:")
  );
};

/** True for `localhost`, `.localhost` names, loopback addresses, and private network addresses. */
const isLocalBrowserHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    isLoopbackOrPrivateIpv4(host) ||
    isLoopbackOrPrivateIpv6(host)
  );
};

const isIpAddress = (host: string): boolean =>
  /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || (host.startsWith("[") && host.endsWith("]"));

/** Reads the scheme of a URL, without the trailing colon. */
export const browserUrlScheme = (url: string): string | null => {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(url.trim());
  return match?.[1]?.toLowerCase() ?? null;
};

/**
 * Turns address bar text into a URL. Text without a scheme gets `http://` for local and private
 * hosts and `https://` for other hosts. Only `http` and `https` load. The address bar never
 * runs a web search, so text that is not an address fails.
 */
export const parseBrowserAddress = (input: string): BrowserAddressResult => {
  const text = input.trim();
  if (text.length === 0) {
    return { ok: false, reason: "empty" };
  }
  if (text.length > BROWSER_URL_MAX_LENGTH || /\s/.test(text)) {
    return { ok: false, reason: "invalid" };
  }

  const explicitScheme =
    SCHEME_WITH_AUTHORITY.exec(text)?.[1] ?? SCHEME_WITHOUT_AUTHORITY.exec(text)?.[1];
  if (explicitScheme !== undefined) {
    const scheme = explicitScheme.toLowerCase();
    if (scheme !== "http" && scheme !== "https") {
      return { ok: false, reason: "scheme", scheme };
    }
    return parseHttpUrl(text);
  }

  const probe = parseHttpUrl(`http://${text}`);
  if (!probe.ok) {
    return probe;
  }
  const hostname = new URL(probe.url).hostname;
  if (isLocalBrowserHost(hostname)) {
    return probe;
  }
  // A single word such as `foo` is search text in a normal browser, not an address.
  if (!hostname.includes(".") && !isIpAddress(hostname)) {
    return { ok: false, reason: "invalid" };
  }
  return parseHttpUrl(`https://${text}`);
};

const parseHttpUrl = (text: string): BrowserAddressResult => {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (url.hostname.length === 0) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, url: url.href };
};

/**
 * A page URL that fits `BROWSER_URL_MAX_LENGTH`, for tab state. A longer URL loses its fragment,
 * then its query, then its path. The page keeps its full URL; only the saved and shown copy is
 * shorter.
 */
export const limitBrowserUrl = (url: string): string => {
  if (url.length <= BROWSER_URL_MAX_LENGTH) return url;
  const parsed = parseBrowserUrl(url);
  if (parsed === null) return url.slice(0, BROWSER_URL_MAX_LENGTH);
  parsed.hash = "";
  if (parsed.href.length <= BROWSER_URL_MAX_LENGTH) return parsed.href;
  parsed.search = "";
  if (parsed.href.length <= BROWSER_URL_MAX_LENGTH) return parsed.href;
  return `${parsed.origin}/`;
};
