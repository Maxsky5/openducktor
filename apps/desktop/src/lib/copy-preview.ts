const COPY_PREVIEW_LENGTH = 50;

export function buildCopyPreview(value: string): string {
  if (value.length <= COPY_PREVIEW_LENGTH) {
    return value;
  }

  return `${value.slice(0, COPY_PREVIEW_LENGTH)}...`;
}
