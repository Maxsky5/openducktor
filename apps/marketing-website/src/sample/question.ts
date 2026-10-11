// The question that the Builder of the empty notebook task asks. The opening view answers it in
// the session preview of the sidebar, and the palette view answers it in the palette.

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

export type WaitingQuestion = typeof WAITING_QUESTION;
