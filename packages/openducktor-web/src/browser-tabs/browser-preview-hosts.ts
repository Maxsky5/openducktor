/**
 * The app host names that previews serve. A preview listens on `127.0.0.1` or `::1` and accepts
 * only these names, so an app at another loopback name, such as `dev.localhost`, shows no pages.
 */
const PREVIEW_APP_HOSTNAMES: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** True for the host name of an app URL that can show frame tabs. IPv6 names keep brackets. */
export const isPreviewAppHostname = (hostname: string): boolean =>
  PREVIEW_APP_HOSTNAMES.has(hostname);
