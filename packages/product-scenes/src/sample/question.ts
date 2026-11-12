// The questions that the agents of the sample story ask. The Builder of the empty notebook task
// asks one question: the opening view answers it in the session preview of the sidebar, and the
// palette view answers it in the palette. The Spec agent of the search shortcut task asks two
// questions in the workflow scene and the question scene.
import type { Question } from "../replicas/transcript/model";

/** The question, its options, and the answer that the visitor picks. */
export const WAITING_QUESTION = {
  header: "Empty state",
  question: "Which action should the empty notebook offer first?",
  options: [
    { label: "Create a note", description: "Start with a blank note in this notebook." },
    { label: "Import notes", description: "Bring notes in from a Markdown folder." },
  ],
  answer: "Create a note",
};

/** The questions of the Spec agent, with the answers that you pick. */
export const SPEC_QUESTIONS: readonly Question[] = [
  {
    header: "Shortcut",
    question: "Which shortcut opens search?",
    options: [
      {
        label: "Cmd+K / Ctrl+K",
        description: "Common in editors and chat apps. Free in Fieldnotes.",
      },
      {
        label: "Cmd+/ / Ctrl+/",
        description: "Free, but some keyboard layouts need Shift for /.",
      },
    ],
    answer: "Cmd+K / Ctrl+K",
  },
  {
    header: "Text fields",
    question: "Should the shortcut work while typing in a text field?",
    options: [
      {
        label: "No, ignore it in text fields",
        description: "The note editor keeps Cmd+K for links.",
      },
      { label: "Yes, everywhere", description: "Search opens even while you type a note." },
    ],
    answer: "No, ignore it in text fields",
  },
];
