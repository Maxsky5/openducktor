const OPAQUE_HEX = /^#[0-9a-f]{6}$/i;
const HEX_WITH_ALPHA = /^(#[0-9a-f]{6})([0-9a-f]{2})?$/i;

/**
 * Adds an alpha channel to a `#rrggbb` color. `alpha` goes from 0 to 1. Any other color throws,
 * so a token that gets an alpha channel in the desktop CSS fails when the theme builds. A
 * string suffix would make a 10-digit color, which React Native drops with only a log line.
 */
export const withAlpha = (color: string, alpha: number): string => {
  if (!OPAQUE_HEX.test(color)) {
    throw new Error(`withAlpha needs a #rrggbb color, not ${color}. Use an opaque color token.`);
  }
  if (alpha < 0 || alpha > 1) {
    throw new Error(`withAlpha needs an alpha from 0 to 1, not ${alpha}.`);
  }
  const channel = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0");
  return `${color}${channel}`;
};

/**
 * A color at a desktop opacity modifier, such as `bg-info-surface/40`: the alpha of the color
 * times `opacity`. A `#rrggbbaa` token keeps its share of its own alpha.
 */
export const multiplyAlpha = (color: string, opacity: number): string => {
  const match = HEX_WITH_ALPHA.exec(color);
  if (!match?.[1]) {
    throw new Error(`multiplyAlpha needs a #rrggbb or #rrggbbaa color, not ${color}.`);
  }
  const alpha = match[2] === undefined ? 1 : Number.parseInt(match[2], 16) / 255;
  return withAlpha(match[1], alpha * opacity);
};
