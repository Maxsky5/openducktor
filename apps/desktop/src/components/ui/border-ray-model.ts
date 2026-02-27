export type BorderRaySize = {
  width: number;
  height: number;
  radius: number;
  borderWidth: number;
};

export const BORDER_RAY_DEFAULT_PERIMETER = 1000;
export const BORDER_RAY_DEFAULT_LENGTH = 190;
export const BORDER_RAY_DEFAULT_LENGTH_RATIO = 0.15;
export const BORDER_RAY_DEFAULT_LENGTH_MIN = 50;
export const BORDER_RAY_DEFAULT_LENGTH_MAX = 320;
export const BORDER_RAY_DEFAULT_TURN_DURATION_MS = 3000;

export const DEFAULT_BORDER_RAY_SIZE: BorderRaySize = {
  width: 680,
  height: 460,
  radius: 12,
  borderWidth: 1,
};

export const DEFAULT_BORDER_RAY_PATH_METRICS = {
  perimeter: BORDER_RAY_DEFAULT_PERIMETER,
  rayLength: BORDER_RAY_DEFAULT_LENGTH,
};

export function computeBorderRayLength(
  perimeter: number,
  ratio = BORDER_RAY_DEFAULT_LENGTH_RATIO,
  min = BORDER_RAY_DEFAULT_LENGTH_MIN,
  max = BORDER_RAY_DEFAULT_LENGTH_MAX,
): number {
  return Math.min(Math.max(perimeter * ratio, min), max);
}
