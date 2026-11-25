import {
  elementKey,
  type WorkflowElementKey,
  type WorkflowElementKind,
} from "@openducktor/workflows";
import { createContext, type ReactNode } from "react";

export type OutlineItem = {
  key: WorkflowElementKey;
  label: string;
  /** Muted text at the end of the row, such as the kind of an action. */
  detail?: string | undefined;
  /** The full name for a tooltip, such as the ID of an element with a plain label. */
  title?: string | undefined;
  /** A muted second line, such as what triggers a transition. */
  subtitle?: ReactNode;
  /** More text that a search matches, such as the triggers in the second line. */
  searchText?: string | undefined;
  /** A mark before the label, such as the colour of a state. */
  leading?: ReactNode;
};

/** The text of the search box of the element list. An empty text shows every element. */
export const OutlineSearchContext = createContext("");

/** The outline rows of a list of elements, keyed by their kind and ID. */
export const outlineItems = <Item extends { id: string; label?: string }>(
  kind: WorkflowElementKind,
  list: readonly Item[],
  extra?: (item: Item) => Partial<OutlineItem>,
): OutlineItem[] =>
  list.map((item) => ({
    key: elementKey(kind, item.id),
    label: item.label || item.id,
    title: item.label && item.label !== item.id ? item.id : undefined,
    ...extra?.(item),
  }));
