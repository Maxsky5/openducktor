import { createContext, use } from "react";

export type ModelPickerFocusBridge = {
  setSpeedFocusNode: (element: HTMLElement | null) => void;
  onSpeedSectionHidden: () => void;
};

export const ModelPickerFocusContext = createContext<ModelPickerFocusBridge>({
  setSpeedFocusNode: () => {},
  onSpeedSectionHidden: () => {},
});

export function useModelPickerFocus(): ModelPickerFocusBridge {
  return use(ModelPickerFocusContext);
}
