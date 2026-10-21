import {
  BROWSER_BLANK_URL,
  type BrowserAddressResult,
  parseBrowserAddress,
} from "@openducktor/contracts";
import { type KeyboardEvent, type ReactElement, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { browserShortAddress } from "./browser-format";

type AddressDraft = {
  text: string;
  /** The page URL when the draft started. */
  sourceUrl: string;
  /** True after Enter, so the next page URL replaces the draft. */
  submitted: boolean;
};

type AddressError = Extract<BrowserAddressResult, { ok: false }>;

export type BrowserAddressBarProps = {
  /** The page URL. A blank page shows an empty address bar. */
  url: string;
  /** When it changes to a value above zero, the address bar takes focus and selects its text. */
  focusRequest: number;
  /** The ID of the toolbar error, or null when the toolbar shows no error. */
  errorId: string | null;
  /** True when the toolbar error is about the typed address. */
  invalid: boolean;
  /** Shows an address error in the toolbar, or clears it with null. */
  onError: (message: string | null) => void;
  /** Loads a normalized `http` or `https` URL. */
  onSubmit: (url: string) => void;
  /** Moves the keyboard focus into the page on F6, or null when the page takes no keys here. */
  onFocusPage: (() => void) | null;
};

/**
 * The address bar of a browser tab. It shows the page URL unless the user edits it. Enter loads
 * the typed address, and Escape restores the page URL. It never runs a web search.
 */
export function BrowserAddressBar({
  url,
  focusRequest,
  errorId,
  invalid,
  onError,
  onSubmit,
  onFocusPage,
}: BrowserAddressBarProps): ReactElement {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState<AddressDraft | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  // Grows on Escape and on focus, so the page URL is selected after it renders.
  const [selectRequest, setSelectRequest] = useState(0);
  // True while a press focuses the address bar. Its click then selects the whole address.
  const selectsOnClick = useRef(false);
  // A new page URL ends a submitted draft, so a later return to its old page URL cannot show it.
  const [pageUrl, setPageUrl] = useState(url);
  if (url !== pageUrl) {
    setPageUrl(url);
    if (draft?.submitted) setDraft(null);
  }
  // A new page URL replaces a submitted draft, and also a draft that the user left.
  const showsDraft = draft !== null && (draft.sourceUrl === url || (isFocused && !draft.submitted));
  const text = showsDraft ? draft.text : pageAddressText(url);
  // Without the focus, a page address shows without its scheme, as in a browser.
  const value = isFocused || (showsDraft && !draft.submitted) ? text : browserShortAddress(text);

  useEffect(() => {
    if (focusRequest <= 0) return;
    inputRef.current?.focus();
    setSelectRequest((request) => request + 1);
  }, [focusRequest]);

  useEffect(() => {
    if (selectRequest > 0) inputRef.current?.select();
  }, [selectRequest]);

  const submit = (): void => {
    const result = parseBrowserAddress(value);
    if (!result.ok) {
      onError(addressErrorText(result));
      return;
    }
    onError(null);
    setDraft({ text: result.url, sourceUrl: url, submitted: true });
    onSubmit(result.url);
  };

  const restore = (): void => {
    onError(null);
    setDraft(null);
    setSelectRequest((request) => request + 1);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "F6" && onFocusPage && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      onFocusPage();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      restore();
    }
  };

  return (
    <Input
      ref={inputRef}
      type="text"
      inputMode="url"
      aria-label="Address"
      aria-invalid={invalid}
      aria-describedby={errorId ?? undefined}
      autoComplete="off"
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      placeholder={BROWSER_ADDRESS_PLACEHOLDER}
      value={value}
      title={isFocused ? undefined : pageAddressText(url) || undefined}
      className={BROWSER_ADDRESS_INPUT_CLASS_NAME}
      onChange={(event) => {
        setDraft({ text: event.currentTarget.value, sourceUrl: url, submitted: false });
      }}
      onFocus={() => {
        setIsFocused(true);
        if (draft !== null && !showsDraft) setDraft(null);
        // The full address shows after this render. A press selects it on its click instead.
        if (!selectsOnClick.current) setSelectRequest((request) => request + 1);
      }}
      onBlur={() => setIsFocused(false)}
      onPointerDown={(event) => {
        selectsOnClick.current = document.activeElement !== event.currentTarget;
      }}
      onClick={(event) => {
        // The first click selects the whole address, as in a browser. A drag keeps its selection.
        const input = event.currentTarget;
        if (selectsOnClick.current && input.selectionStart === input.selectionEnd) input.select();
        selectsOnClick.current = false;
      }}
      onKeyDown={handleKeyDown}
    />
  );
}

export const BROWSER_ADDRESS_INPUT_CLASS_NAME =
  "h-7 min-w-0 flex-1 rounded-md bg-muted/50 px-2 text-xs text-ellipsis shadow-none focus-visible:bg-card";

export const BROWSER_ADDRESS_PLACEHOLDER = "Type a web address";

const pageAddressText = (url: string): string => (url === BROWSER_BLANK_URL ? "" : url);

const addressErrorText = (error: AddressError): string | null => {
  if (error.reason === "scheme") {
    return `Browser tabs do not open ${error.scheme}: addresses. Use an http or https address.`;
  }
  if (error.reason === "invalid") {
    return "This is not a web address. Type an address such as localhost:3000 or example.com.";
  }
  return null;
};
