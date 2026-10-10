import { useLayoutEffect, useRef, useState } from "react";
import type { PaletteHighlight } from "./use-command-palette-navigation";

/** The listbox and its highlighted option, by element ID. */
export type PaletteListboxLink = { listId: string | undefined; optionId: string | undefined };

/**
 * Link the input to the highlighted option, and scroll to a highlight that the palette set.
 *
 * cmdk owns the element IDs, and it scrolls only when a key moves the highlight. The palette sets
 * the highlight for a new query, scope, or list, for a restored highlight, and when the
 * highlighted row leaves the list. The hook scrolls to each of these, also when the same option
 * stays highlighted. A data update does not scroll, so a wheel scroll stays. The hook reads the
 * DOM again only when the ordered option values change.
 */
export function useHighlightedOption(
  root: HTMLElement | null,
  {
    value,
    needsScroll,
    enabledValues,
  }: Pick<PaletteHighlight, "value" | "needsScroll" | "enabledValues">,
  highlightRequest: number,
): PaletteListboxLink {
  const [link, setLink] = useState<PaletteListboxLink>({
    listId: undefined,
    optionId: undefined,
  });
  const optionsKey = enabledValues.join("\n");
  /** The option and the highlight request of the last run. A data update changes neither. */
  const lastTargetRef = useRef<{ option: HTMLElement | null; request: number }>({
    option: null,
    request: -1,
  });
  useLayoutEffect(() => {
    const listId = root?.querySelector("[cmdk-list]")?.id;
    const options = root?.querySelectorAll<HTMLElement>("[data-palette-value]") ?? [];
    const option = [...options].find((element) => element.dataset.paletteValue === value);
    const lastTarget = lastTargetRef.current;
    const isNewTarget = option !== lastTarget.option || highlightRequest !== lastTarget.request;
    if (option && needsScroll && isNewTarget) scrollOptionIntoView(option);
    lastTargetRef.current = { option: option ?? null, request: highlightRequest };
    const optionId = option?.id;
    setLink((current) =>
      current.listId === listId && current.optionId === optionId ? current : { listId, optionId },
    );
  }, [value, highlightRequest, needsScroll, optionsKey, root]);
  return link;
}

/** Scroll the option into view, and its group heading when it is the first option, as cmdk does. */
const scrollOptionIntoView = (option: HTMLElement): void => {
  const group = option.closest("[cmdk-group]");
  if (group?.querySelector("[cmdk-item]") === option) {
    group.querySelector("[cmdk-group-heading]")?.scrollIntoView({ block: "nearest" });
  }
  option.scrollIntoView({ block: "nearest" });
};
