export type ClientFeedbackKind = "success" | "info" | "warning" | "error";

export type ClientFeedbackOptions = {
  /** Shows the message once. A later message with the same ID replaces it. */
  id?: string;
  description?: string;
  /** Milliseconds. `Infinity` keeps the message until the code or the user dismisses it. */
  duration?: number;
};

/** Short-lived messages for the user. Each platform shows them in its own way. */
export type ClientFeedback = {
  show(kind: ClientFeedbackKind, message: string, options?: ClientFeedbackOptions): void;
  dismiss(id: string): void;
};
