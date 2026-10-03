import { type RefObject, useRef, useState } from "react";

type RequestCardCollapse = {
  isExpanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  contentRef: RefObject<HTMLDivElement | null>;
  triggerRef: RefObject<HTMLButtonElement | null>;
};

/**
 * Reset expansion before a returning chat paints.
 * Move focus to the header so it does not stay in hidden controls.
 */
export function useRequestCardCollapse(resetKey: string): RequestCardCollapse {
  const [state, setState] = useState({ resetKey, expanded: true });
  const contentRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  if (state.resetKey !== resetKey) {
    setState({ resetKey, expanded: true });
  }

  const onExpandedChange = (expanded: boolean): void => {
    if (!expanded && contentRef.current?.contains(document.activeElement)) {
      triggerRef.current?.focus();
    }
    setState({ resetKey, expanded });
  };

  return { isExpanded: state.expanded, onExpandedChange, contentRef, triggerRef };
}
