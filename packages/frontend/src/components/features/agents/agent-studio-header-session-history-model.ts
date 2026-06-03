export const deriveSessionHistorySelectionFocusBehavior = (params: {
  currentValue: string;
  nextValue: string;
  shouldAutofocusComposerForValue: (value: string) => boolean;
}): "composer" | "trigger" | "none" => {
  if (params.nextValue === params.currentValue) {
    return "none";
  }

  return params.shouldAutofocusComposerForValue(params.nextValue) ? "composer" : "trigger";
};
