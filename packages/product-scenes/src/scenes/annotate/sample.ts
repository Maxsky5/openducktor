// The sample data of the annotate scene: the note of each annotation, the message that sends
// them, and the change of the Builder. The developer checks the empty notebook of the dev server
// in a browser tab and asks for two changes.

/** The tooltip of Annotate while the picker is off: browser-toolbar.tsx. */
export const ANNOTATE_TIP = "Annotate page elements";

/**
 * Each annotation: the element of the page, the name that the picker gives it, and the note. The
 * picker names the nearest React component of an element, else its tag.
 */
export const ANNOTATIONS = [
  {
    element: "create-note",
    label: "Button",
    note: "Make this the main action, with a plus icon.",
  },
  {
    element: "empty-subtitle",
    label: "EmptyNotebook",
    note: "Add a link to import notes.",
  },
] as const;

/** The message that sends the annotations, and the time of the message. */
export const ANNOTATION_MESSAGE = "Fix these two points.";
export const MESSAGE_TIME = "10:48:21 AM";

/** The file that the Builder changes for the annotations. */
export const EMPTY_STATE_FILE = "src/notebooks/EmptyNotebook.tsx";

/** The time that the Builder takes for the annotations. */
export const FIX_WORKED = "41s";
