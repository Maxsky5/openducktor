import {
  type ArtifactPreviewEnvironment,
  HTML_PREVIEW_MAX_CONTENT_HEIGHT,
  HTML_PREVIEW_MIN_CONTENT_HEIGHT,
} from "@openducktor/contracts";

const INITIAL_FIT_CONTENT_HEIGHT = 320;
const MEASURED_HEIGHT_LIMIT = 200;

// Remembers the last measured height per preview ID so remounting while scrolling never jumps.
const measuredContentHeights = new Map<string, number>();

const clampContentHeight = (height: number): number =>
  Math.min(
    HTML_PREVIEW_MAX_CONTENT_HEIGHT,
    Math.max(HTML_PREVIEW_MIN_CONTENT_HEIGHT, Math.ceil(height)),
  );

export const readMeasuredHtmlPreviewHeight = (contentKey: string | undefined): number | undefined =>
  contentKey ? measuredContentHeights.get(contentKey) : undefined;

/** The height a preview holds while loading or starting, so a remount does not collapse it. */
export const readHtmlPreviewPlaceholderHeight = (contentKey: string | undefined): number => {
  const remembered = readMeasuredHtmlPreviewHeight(contentKey);
  return remembered === undefined ? INITIAL_FIT_CONTENT_HEIGHT : clampContentHeight(remembered);
};

export const rememberHtmlPreviewHeight = (key: string, height: number): void => {
  measuredContentHeights.delete(key);
  measuredContentHeights.set(key, height);
  if (measuredContentHeights.size > MEASURED_HEIGHT_LIMIT) {
    const oldest = measuredContentHeights.keys().next().value;
    if (oldest !== undefined) measuredContentHeights.delete(oldest);
  }
};

type GetPreviewEnvironmentFn = () => Promise<ArtifactPreviewEnvironment>;
const cachedPreviewEnvironments = new WeakMap<
  GetPreviewEnvironmentFn,
  ArtifactPreviewEnvironment
>();
const inflightPreviewEnvironments = new WeakMap<
  GetPreviewEnvironmentFn,
  Promise<ArtifactPreviewEnvironment>
>();

/** Synchronous cache lookup for an already-resolved preview environment. */
export const readCachedHtmlPreviewEnvironment = (
  getEnvironment: GetPreviewEnvironmentFn,
): ArtifactPreviewEnvironment | null => cachedPreviewEnvironments.get(getEnvironment) ?? null;

/** Loads and caches the preview environment per shell platform bridge. */
export const loadCachedHtmlPreviewEnvironment = (
  getEnvironment: GetPreviewEnvironmentFn,
): Promise<ArtifactPreviewEnvironment> => {
  const cached = cachedPreviewEnvironments.get(getEnvironment);
  if (cached) return Promise.resolve(cached);
  const inflight = inflightPreviewEnvironments.get(getEnvironment);
  if (inflight) return inflight;
  const promise = getEnvironment()
    .then((env) => {
      cachedPreviewEnvironments.set(getEnvironment, env);
      inflightPreviewEnvironments.delete(getEnvironment);
      return env;
    })
    .catch((error) => {
      inflightPreviewEnvironments.delete(getEnvironment);
      throw error;
    });
  inflightPreviewEnvironments.set(getEnvironment, promise);
  return promise;
};
