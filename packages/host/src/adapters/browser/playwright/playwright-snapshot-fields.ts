/** A snapshot line of a form field, with its ref. Playwright prints no `required` state. */
const FIELD_REF_PATTERN =
  /^\s*- (?:textbox|searchbox|combobox|listbox|checkbox|radio|spinbutton|slider|switch)\b[^\n]*? \[ref=([a-z0-9]+)\]/gm;

/** The refs of the form fields of an AI snapshot, in page order. */
export const snapshotFieldRefs = (snapshot: string): string[] =>
  [...snapshot.matchAll(FIELD_REF_PATTERN)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );

/** Adds `[required]` before the ref of each required field, so an agent sees why a form does not submit. */
export const markRequiredSnapshotFields = (
  snapshot: string,
  requiredRefs: ReadonlySet<string>,
): string =>
  requiredRefs.size === 0
    ? snapshot
    : snapshot.replace(/ \[ref=([a-z0-9]+)\]/g, (mark, ref: string) =>
        requiredRefs.has(ref) ? ` [required]${mark}` : mark,
      );
