import { cn } from "@/lib/utils";

// The card has no border. Its surface and shadow set it apart from the transcript.
// Above the queued message stack (z-40), so the card covers the tucked edge of its front card.
export const COMPOSER_CARD_CLASS_NAME =
  "relative z-50 rounded-xl transition-[background-color,box-shadow] duration-150";

/** The card of an editor that takes input. Only the draft editor highlights the card. */
export const ACTIVE_COMPOSER_CARD_CLASS_NAME = cn(
  COMPOSER_CARD_CLASS_NAME,
  "bg-chat-surface shadow-chat has-[[data-composer-editor]:focus]:shadow-chat-focus",
);

// The attach button and the selectors stay quiet, so they do not compete with the draft text.
// Their focus ring uses the neutral form control color.
export const COMPOSER_QUIET_CONTROL_CLASS_NAME =
  "text-muted-foreground shadow-none hover:text-foreground focus-visible:ring-input-focus data-[state=open]:text-foreground";
