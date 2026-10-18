import type {
  ClientFeedback,
  ClientFeedbackKind,
  ClientFeedbackOptions,
} from "../platform/client-feedback";

export type ShownFeedback = {
  kind: ClientFeedbackKind;
  message: string;
  options: ClientFeedbackOptions | undefined;
};

export const createFeedbackFake = (): ClientFeedback & {
  shown: ShownFeedback[];
  dismissed: string[];
  shownOf(kind: ClientFeedbackKind): ShownFeedback[];
} => {
  const shown: ShownFeedback[] = [];
  const dismissed: string[] = [];
  return {
    shown,
    dismissed,
    show: (kind, message, options) => {
      shown.push({ kind, message, options });
    },
    dismiss: (id) => {
      dismissed.push(id);
    },
    shownOf: (kind) => shown.filter((entry) => entry.kind === kind),
  };
};
