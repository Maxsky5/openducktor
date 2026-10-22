const BYTE_UNITS = [
  { size: 1_000_000_000, unit: "GB" },
  { size: 1_000_000, unit: "MB" },
  { size: 1_000, unit: "KB" },
] as const;

const sizeFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

/** A byte count in decimal units, such as `1.5 MB`. */
export const formatBrowserBytes = (bytes: number): string => {
  const unit = BYTE_UNITS.find((candidate) => bytes >= candidate.size);
  if (!unit) return `${bytes} B`;
  return `${sizeFormat.format(bytes / unit.size)} ${unit.unit}`;
};

/** A size in whole megabytes, rounded up, such as `120 MB`. */
export const formatBrowserMegabytes = (bytes: number): string =>
  `${Math.ceil(bytes / 1_000_000)} MB`;

/** The host and port of a URL or origin, or the text itself when it is not a URL. */
export const browserSiteLabel = (url: string): string => URL.parse(url)?.host || url;

/** An address without its `http://` or `https://` scheme, and without the `/` of an empty path. */
export const browserShortAddress = (address: string): string => {
  const text = address.replace(/^https?:\/\//u, "");
  return text.indexOf("/") === text.length - 1 ? text.slice(0, -1) : text;
};
