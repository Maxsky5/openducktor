// The parsers of the options of the video renderer in render.ts.

/** Reads a time in seconds that is 0 or more. */
export function seconds(value: string, option: string): number {
  const time = Number(value);
  if (!(time >= 0)) throw new Error(`Set ${option} to a time in seconds, 0 or more.`);
  return time;
}

/**
 * Reads the stage width of `--stage` in CSS pixels, such as 390 for the phone layout of a scene.
 * Without the option, the scene keeps its design width. A film shows each scene at its design
 * width, so it takes no stage width.
 */
export function stageWidth(value: string | undefined, film: boolean): number | undefined {
  if (value === undefined) return undefined;
  if (film) throw new Error("A film shows each scene at its design width, so remove --stage.");
  const width = Number(value);
  if (!(Number.isInteger(width) && width > 0)) {
    throw new Error("Set --stage to a stage width in CSS pixels, such as 390.");
  }
  return width;
}
