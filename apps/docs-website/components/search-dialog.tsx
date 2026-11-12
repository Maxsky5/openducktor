"use client";
import { useStaticSearch } from "fumadocs-core/search/client";
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogFooter,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  type SearchItemType,
  type SharedProps,
} from "fumadocs-ui/components/dialog/search";
import { useRef, useState } from "react";
import { openSection } from "@/lib/focus";

const INDEX = "/search-index.json";

function NoResults() {
  return (
    <p role="status" className="docs-search-note">
      No pages match this search. Try another word, or browse the navigation.
    </p>
  );
}

/**
 * Searches the static index in the browser. The client keeps a failed index load for its address,
 * so a retry loads the index from a new address. The query stays in the field.
 */
export default function DocsSearchDialog(props: SharedProps) {
  const [attempt, setAttempt] = useState(0);
  const search = useStaticSearch({ from: attempt === 0 ? INDEX : `${INDEX}?attempt=${attempt}` });
  // A retry keeps the last error until it succeeds, so loading does not depend on the error.
  const loading = search.isLoading && !search.data;
  const failed = search.error !== undefined && !search.isLoading;
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<Element | null>(null);
  const opened = useRef<string | null>(null);

  const onSelect = (item: SearchItemType) => {
    opened.current = "url" in item ? item.url : null;
  };
  const onOpenAutoFocus = () => {
    opener.current = document.activeElement;
    opened.current = null;
  };
  // The dialog has no Radix trigger, so it returns focus here: to the control that opened it, or
  // to the section of a result on the same page. A result on another page gets focus on arrival.
  const onCloseAutoFocus = (event: Event) => {
    event.preventDefault();
    if (opened.current !== null) {
      openSection(opened.current);
      return;
    }
    if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus();
  };
  const retry = () => {
    setAttempt((value) => value + 1);
    input.current?.focus();
  };

  return (
    <SearchDialog {...search} {...props} onSelect={onSelect}>
      <SearchDialogOverlay />
      <SearchDialogContent onOpenAutoFocus={onOpenAutoFocus} onCloseAutoFocus={onCloseAutoFocus}>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput ref={input} className="docs-search-input" />
          <SearchDialogClose />
        </SearchDialogHeader>
        {loading ? (
          <p role="status" className="docs-search-note">
            Searching the documentation.
          </p>
        ) : null}
        <SearchDialogList Empty={NoResults} />
        {failed ? (
          <SearchDialogFooter className="docs-search-failure">
            <p>
              The search index did not load. Check your network connection, then retry. The page
              links still work.
            </p>
            <button type="button" onClick={retry}>
              Retry search
            </button>
          </SearchDialogFooter>
        ) : null}
      </SearchDialogContent>
    </SearchDialog>
  );
}
