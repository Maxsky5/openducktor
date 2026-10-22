/** The URL and size rules of browser tabs, shared by the host, the engines, and the clients. */

export const BROWSER_URL_MAX_LENGTH = 8_192;
export const BROWSER_BLANK_URL = "about:blank";
export const BROWSER_TITLE_MAX_LENGTH = 1_024;
/** A `data:` image URL of a page icon. */
export const BROWSER_FAVICON_MAX_LENGTH = 65_536;

const BLANK_PAGE_URL = /^about:blank(?:[?#]|$)/;

/**
 * The parsed URL, or null when the text is no URL. Some client platforms have no `URL.canParse`,
 * so this parses with the constructor.
 */
export const parseBrowserUrl = (url: string): URL | null => {
  try {
    return new URL(url);
  } catch {
    return null;
  }
};

/** True when a tab may load the URL as a top-level page. */
export const isBrowserNavigableUrl = (url: string): boolean => {
  const protocol = parseBrowserUrl(url)?.protocol;
  return protocol === "http:" || protocol === "https:";
};

/** True for the blank page, also with a query or a fragment. */
export const isBrowserBlankUrl = (url: string): boolean => BLANK_PAGE_URL.test(url);

/** True for a URL that a tab shows: an `http` or `https` page, or the blank page. */
export const isBrowserTabLoadableUrl = (url: string): boolean =>
  isBrowserNavigableUrl(url) || isBrowserBlankUrl(url);
