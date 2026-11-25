/**
 * Loads the lazy modules of the Markdown views, so a test does not wait for its first import.
 * Await it at the top of a test file.
 */
export const loadMarkdownModules = async (): Promise<void> => {
  await Promise.all([
    import("pele"),
    import("@pierre/words/highlights"),
    import("@pierre/highlights/themes/pierre-light"),
    import("@pierre/highlights/themes/pierre-dark"),
  ]);
};
