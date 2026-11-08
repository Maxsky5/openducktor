/** Joins the class names that are set, as `class:list` of Astro does. */
export function classes(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}
