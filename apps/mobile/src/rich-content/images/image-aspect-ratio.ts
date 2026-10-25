import { createHostContentCache } from "../lru-cache";

/** Aspect ratios of images that showed before, so a remounted row keeps its height. */
const aspectRatios = createHostContentCache<string, number>(256);

/** The aspect ratio of an image that showed before, so its placeholder keeps the same height. */
export const knownAspectRatio = (recyclingKey: string): number | undefined =>
  aspectRatios.get(recyclingKey);

export const rememberAspectRatio = (recyclingKey: string, aspectRatio: number): void => {
  aspectRatios.set(recyclingKey, aspectRatio);
};

/** The most height that an image takes. A placeholder of a known image uses it too. */
export const MAX_IMAGE_HEIGHT = 420;
