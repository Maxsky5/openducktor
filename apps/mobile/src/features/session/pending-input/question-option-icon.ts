import type { IconName } from "@/ui/icon";

/** The desktop option icon: a check box or a radio circle, in the foreground when selected. */
export const optionIcon = (multiple: boolean, selected: boolean): IconName => {
  if (multiple) return selected ? "check-square" : "square";
  return selected ? "circle-check" : "circle";
};
