// Most users see the tour once, so its slides, its scenes, and its styles load in their own chunks.

/** The product scenes that the tour shows. */
export const TOUR_SCENES = ["hero", "palette"] as const;
export type TourSceneName = (typeof TOUR_SCENES)[number];

/** Loads the views and the timelines of the tour scenes. */
const loadTourScenes = async (): Promise<void> => {
  const { preloadScene } = await import("@openducktor/product-scenes/react");
  await Promise.all(TOUR_SCENES.map(preloadScene));
};

/**
 * Loads the chunk of the tour dialog and the tour scenes in parallel. It resolves when all load,
 * so the first render of the dialog shows each scene, not its empty fallback. A second call
 * returns the same module.
 */
export const loadFeatureTourDialog = async (): Promise<typeof import("./feature-tour-dialog")> => {
  const [dialog] = await Promise.all([import("./feature-tour-dialog"), loadTourScenes()]);
  return dialog;
};

/**
 * Starts to load the tour dialog before it opens, so it does not wait for the open state. The
 * lazy dialog reports a load failure when it renders.
 */
export const preloadFeatureTourDialog = (): void => {
  loadFeatureTourDialog().catch(() => {});
};
