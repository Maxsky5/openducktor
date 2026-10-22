import type { BrowserPromptAnswer } from "@openducktor/contracts";
import {
  type KeyboardEvent,
  type ReactElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BrowserPromptOf } from "./browser-component-types";
import { useBrowserAsyncAction } from "./use-browser-async-action";

export type BrowserDialogPromptProps = {
  prompt: BrowserPromptOf<"dialog"> | BrowserPromptOf<"leave_page">;
  /** The URL of the page that opened the dialog. The card names its site. */
  pageUrl: string;
  /** A rejected promise keeps the card and shows the error. */
  onAnswer: (answer: BrowserPromptAnswer) => Promise<void>;
  /** Moves the focus into the page. The card calls it when it closes with the focus inside. */
  returnFocus: () => void;
};

type DialogModel = {
  title: string;
  message: string;
  acceptLabel: string;
  /** Null when the dialog has only one button, as `alert` has. */
  dismissLabel: string | null;
  hasTextField: boolean;
  accept: (promptText: string) => BrowserPromptAnswer;
  dismiss: BrowserPromptAnswer;
};

const UNSAVED_CHANGES_TEXT = "Changes that you made may not be saved.";

/**
 * A JS dialog of one tab. It covers the page area of its tab, not the app, and the page waits for
 * the answer. Enter accepts and Escape dismisses. Focus moves into the card when it shows, except
 * for a dialog that an agent action opened: the user then keeps typing where they were, and Tab or
 * a click reaches the card.
 */
export function BrowserDialogPrompt({
  prompt,
  pageUrl,
  onAnswer,
  returnFocus,
}: BrowserDialogPromptProps): ReactElement {
  const model = dialogModel(prompt, pageUrl);
  const defaultText = prompt.kind === "dialog" ? prompt.defaultPrompt : "";
  const [text, setText] = useState(defaultText);
  const answer = useBrowserAsyncAction();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const textFieldRef = useRef<HTMLInputElement | null>(null);
  const acceptRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const messageId = useId();

  const takesFocus = !prompt.startedByAgent;
  useEffect(() => {
    if (!takesFocus) return;
    const textField = textFieldRef.current;
    if (textField) {
      textField.focus();
      textField.select();
      return;
    }
    acceptRef.current?.focus();
  }, [takesFocus]);

  // The focus goes back to the page, as in a browser. The cleanup of a layout effect runs while the
  // card is still in the document.
  useLayoutEffect(() => {
    const card = cardRef.current;
    return () => {
      if (card?.contains(document.activeElement)) returnFocus();
    };
  }, [returnFocus]);

  const dismiss = (): void => {
    void answer.run(() => onAnswer(model.dismiss));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    dismiss();
  };

  return (
    <div
      ref={cardRef}
      className="pointer-events-auto absolute inset-0 z-20 flex items-start justify-center overflow-y-auto bg-background/60 p-4 pt-[10%]"
    >
      {/* A non-modal dialog: it blocks only the page area of its tab, not the app. */}
      <dialog
        open
        role="alertdialog"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        className="static w-full max-w-sm rounded-lg border border-border bg-card text-card-foreground shadow-lg"
        onKeyDown={handleKeyDown}
      >
        <form
          className="flex flex-col gap-3 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void answer.run(() => onAnswer(model.accept(text)));
          }}
        >
          <h2 id={titleId} className="truncate text-sm font-semibold text-foreground">
            {model.title}
          </h2>
          <p
            id={messageId}
            className="max-h-60 overflow-y-auto text-sm whitespace-pre-wrap break-words text-muted-foreground"
          >
            {model.message}
          </p>
          {model.hasTextField ? (
            <Input
              ref={textFieldRef}
              aria-label="Answer"
              value={text}
              disabled={answer.pending}
              onChange={(event) => setText(event.currentTarget.value)}
            />
          ) : null}
          {answer.error ? (
            <p role="alert" className="text-xs text-destructive">
              {answer.error}
            </p>
          ) : null}
          <div className="flex justify-end gap-1.5">
            {model.dismissLabel ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={answer.pending}
                onClick={dismiss}
              >
                {model.dismissLabel}
              </Button>
            ) : null}
            <Button ref={acceptRef} type="submit" size="sm" disabled={answer.pending}>
              {model.acceptLabel}
            </Button>
          </div>
        </form>
      </dialog>
    </div>
  );
}

const dialogModel = (prompt: BrowserDialogPromptProps["prompt"], pageUrl: string): DialogModel => {
  if (prompt.kind === "leave_page") {
    return {
      title: "Leave this page?",
      message: `The page asked to stay, so it is still open. ${UNSAVED_CHANGES_TEXT}`,
      acceptLabel: "Leave page",
      dismissLabel: "Stay",
      hasTextField: false,
      accept: () => ({ kind: "leave_page", leave: true }),
      dismiss: { kind: "leave_page", leave: false },
    };
  }
  const dismiss: BrowserPromptAnswer = { kind: "dialog", accept: false };
  switch (prompt.type) {
    case "alert":
      return {
        title: pageSaysTitle(pageUrl),
        message: prompt.message,
        acceptLabel: "OK",
        dismissLabel: null,
        hasTextField: false,
        accept: () => ({ kind: "dialog", accept: true }),
        dismiss,
      };
    case "confirm":
      return {
        title: pageSaysTitle(pageUrl),
        message: prompt.message,
        acceptLabel: "OK",
        dismissLabel: "Cancel",
        hasTextField: false,
        accept: () => ({ kind: "dialog", accept: true }),
        dismiss,
      };
    case "prompt":
      return {
        title: pageSaysTitle(pageUrl),
        message: prompt.message,
        acceptLabel: "OK",
        dismissLabel: "Cancel",
        hasTextField: true,
        accept: (promptText) => ({ kind: "dialog", accept: true, promptText }),
        dismiss,
      };
    case "beforeunload":
      return {
        title: "Leave this page?",
        message: UNSAVED_CHANGES_TEXT,
        acceptLabel: "Leave page",
        dismissLabel: "Stay",
        hasTextField: false,
        accept: () => ({ kind: "dialog", accept: true }),
        dismiss,
      };
  }
};

const pageSaysTitle = (pageUrl: string): string => {
  const host = URL.parse(pageUrl)?.host;
  return host ? `${host} says` : "This page says";
};
