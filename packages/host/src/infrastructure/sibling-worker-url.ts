/**
 * Resolves a worker entry next to the calling module. Source runs load the `.ts` entry, and
 * bundles load the `.js` entry that the build writes next to the caller.
 */
export const siblingWorkerUrl = (importMetaUrl: string, baseName: string): URL =>
  new URL(`./${baseName}${importMetaUrl.endsWith(".ts") ? ".ts" : ".js"}`, importMetaUrl);
