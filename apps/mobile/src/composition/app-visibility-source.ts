import type { AppVisibility } from "@openducktor/frontend-core/platform/app-visibility";

/** A device state that a listener can follow, such as the React Native `AppState`. */
export type AppStateSource<State> = {
  current(): State;
  subscribe(listener: (state: State) => void): () => void;
};

/**
 * Makes an `AppVisibility` from a device state. It reports only a change of `hidden`, because one
 * visibility can have more than one device state, such as the iOS `active` and `inactive`.
 */
export const visibilityOf = <State>(
  source: AppStateSource<State>,
  hidden: (state: State) => boolean,
): AppVisibility => ({
  isHidden: () => hidden(source.current()),
  subscribe(onChange) {
    let wasHidden = hidden(source.current());
    return source.subscribe((state) => {
      const isHidden = hidden(state);
      if (isHidden === wasHidden) return;
      wasHidden = isHidden;
      onChange();
    });
  },
});
