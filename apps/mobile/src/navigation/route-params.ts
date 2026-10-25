/** The params of a route as Expo Router gives them. A repeated param is an array. */
export type RawRouteParams = Readonly<Record<string, string | string[] | undefined>>;

/** The first value of a route param, or null when the param is missing or blank. */
export const routeParam = (value: string | string[] | undefined): string | null => {
  const text = Array.isArray(value) ? value[0] : value;
  return text !== undefined && text.trim().length > 0 ? text : null;
};
