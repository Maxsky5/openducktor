/** Tells whether the user can see the app now. Each platform reads its own visibility signal. */
export type AppVisibility = {
  isHidden(): boolean;
  /** Calls `onChange` after each visibility change and returns the function that stops it. */
  subscribe(onChange: () => void): () => void;
};

/** Calls `onHide` each time the app becomes hidden, and returns the function that stops it. */
export const subscribeAppHide = (visibility: AppVisibility, onHide: () => void): (() => void) =>
  visibility.subscribe(() => {
    if (visibility.isHidden()) onHide();
  });
