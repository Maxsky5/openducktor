/** The one open question of a confirmation dialog, and the promise of the caller that waits. */
export type QuestionSlot<Question> = {
  /** Shows the question. It resolves true only when the user confirms. */
  ask: (question: Question) => Promise<boolean>;
  /** Hides the question and resolves its promise with the answer. */
  answer: (confirmed: boolean) => void;
  /** Resolves the open question with false, for a screen that closes. */
  dispose: () => void;
};

/**
 * A new question answers the open one with false, and so does `dispose`, so no caller waits for
 * a dialog that no longer shows.
 */
export const createQuestionSlot = <Question>(
  show: (question: Question | null) => void,
): QuestionSlot<Question> => {
  let resolveOpen: ((confirmed: boolean) => void) | null = null;
  const settle = (confirmed: boolean): void => {
    const resolve = resolveOpen;
    resolveOpen = null;
    resolve?.(confirmed);
  };
  return {
    ask: (question) =>
      new Promise<boolean>((resolve) => {
        settle(false);
        resolveOpen = resolve;
        show(question);
      }),
    answer: (confirmed) => {
      show(null);
      settle(confirmed);
    },
    dispose: () => settle(false),
  };
};
