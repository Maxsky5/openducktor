import { createHostContentCache } from "../lru-cache";

/** Aspect ratios of images that showed before, so a remounted row keeps its height. */
const aspectRatios = createHostContentCache<string, number>(256);

/** The aspect ratio of an image that showed before, so its placeholder keeps the same height. */
export const knownAspectRatio = (recyclingKey: string): number | undefined =>
  aspectRatios.get(recyclingKey);

/**
 * Keeps the aspect ratio of the first load of an image and returns the kept ratio. Android
 * reports the size of the image as decoded for the view. A new ratio resizes the view, the image
 * decodes again at the new size, and rounding can give another ratio, so the image would load
 * again and again.
 */
export const keepAspectRatio = (recyclingKey: string, aspectRatio: number): number => {
  const known = aspectRatios.get(recyclingKey);
  if (known !== undefined) return known;
  aspectRatios.set(recyclingKey, aspectRatio);
  return aspectRatio;
};

/** The most height that an image takes. A placeholder of a known image uses it too. */
export const MAX_IMAGE_HEIGHT = 420;
