const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** When a version was published, such as "20 Nov 2026, 14:02". */
export const publishedAtText = (publishedAt: string): string =>
  DATE_FORMAT.format(new Date(publishedAt));
