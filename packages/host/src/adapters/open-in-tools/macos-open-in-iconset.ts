const MAX_OPEN_IN_ICON_DIMENSION = 256;

export const iconsetRepresentationScore = (iconName: string): number | null => {
  const stem = iconName.endsWith(".png") ? iconName.slice(0, -".png".length) : null;
  if (!stem?.startsWith("icon_")) {
    return null;
  }

  const representation = stem.slice("icon_".length);
  const match = representation.match(/^(\d+)x(\d+)(?:@(\d+)x)?$/);
  if (!match) {
    return null;
  }

  const [, widthValue, heightValue, scaleValue] = match;
  const width = Number.parseInt(widthValue ?? "", 10);
  const height = Number.parseInt(heightValue ?? "", 10);
  const scale = scaleValue ? Number.parseInt(scaleValue, 10) : 1;
  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(scale)) {
    return null;
  }

  const effectiveWidth = width * scale;
  const effectiveHeight = height * scale;
  if (effectiveWidth > MAX_OPEN_IN_ICON_DIMENSION || effectiveHeight > MAX_OPEN_IN_ICON_DIMENSION) {
    return null;
  }

  return effectiveWidth * effectiveHeight;
};
