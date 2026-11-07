type RuntimeVersion = readonly [number, number, number];

const parseRuntimeVersion = (value: string): RuntimeVersion | null => {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(value);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

/**
 * Compares the version that the host read from a runtime executable with a minimum version.
 * `null`: OpenDucktor cannot read one of the versions.
 */
export const compareRuntimeVersion = (
  runtimeVersion: string | null,
  minimum: string,
): { readonly version: string; readonly supported: boolean } | null => {
  const required = parseRuntimeVersion(minimum);
  const current = runtimeVersion === null ? null : parseRuntimeVersion(runtimeVersion);
  if (!required || !current) return null;
  let supported = true;
  for (let index = 0; index < current.length; index += 1) {
    const difference = (current[index] ?? 0) - (required[index] ?? 0);
    if (difference !== 0) {
      supported = difference > 0;
      break;
    }
  }
  return { version: current.join("."), supported };
};
