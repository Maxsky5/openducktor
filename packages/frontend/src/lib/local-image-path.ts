const WINDOWS_DRIVE_PATH = /^[a-z]:[\\/]/i;

/**
 * The host path of an image source that names a local file: a `file:` URL, an absolute path, or
 * a Windows drive path. Other sources, such as web URLs, return null.
 */
export const localImagePathOf = (source: string): string | null => {
  if (/^file:/i.test(source)) {
    if (!URL.canParse(source)) return null;
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(source).pathname);
    } catch {
      // An agent can write a URL with a broken percent escape.
      return null;
    }
    return /^\/[a-z]:\//i.test(pathname) ? pathname.slice(1) : pathname;
  }
  if (source.startsWith("/") && !source.startsWith("//")) return source;
  return WINDOWS_DRIVE_PATH.test(source) ? source : null;
};
