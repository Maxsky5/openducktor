/**
 * A Bun macro. Bun runs it when it transpiles or bundles the module that imports it, and puts the
 * result in place of the call. It bundles the page code of the annotation capture with bippy.
 * A macro cannot call `Bun.build` while Bun bundles, so it runs the `bun build` command.
 */
export const bundleBrowserPageCapture = (): string => {
  const result = Bun.spawnSync([
    process.execPath,
    "build",
    `${import.meta.dir}/browser-page-capture.page.ts`,
    "--target=browser",
    "--format=iife",
    "--minify",
  ]);
  if (!result.success) {
    throw new Error(`Could not bundle the page capture code: ${result.stderr.toString()}`);
  }
  return result.stdout.toString().trim();
};
