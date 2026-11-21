// Most users see the tour once, so its slides, its scenes, and its styles load in their own chunks.

/**
 * Loads the chunk of the tour dialog and the tour scenes in parallel. It resolves when all load,
 * so the first render of the dialog shows each scene, not its empty fallback. A second call
 * returns the same module.
 */
export const loadFeatureTourDialog = async (): Promise<typeof import("./feature-tour-dialog")> => {
  const [dialog] = await Promise.all([
    import("./feature-tour-dialog"),
    import("@openducktor/product-scenes/react/tour").then(({ preloadTourScenes }) =>
      preloadTourScenes(),
    ),
  ]);
  return dialog;
};

/**
 * Starts to load the tour dialog before it opens, so it does not wait for the open state. The
 * lazy dialog reports a load failure when it renders.
 */
export const preloadFeatureTourDialog = (): void => {
  loadFeatureTourDialog().catch(() => {});
};
