export const imagePreviewMime = (extension: string): string | undefined =>
  MIME_BY_EXTENSION.get(extension.toLowerCase());

const MIME_BY_EXTENSION = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
  [".bmp", "image/bmp"],
  [".ico", "image/x-icon"],
]);
