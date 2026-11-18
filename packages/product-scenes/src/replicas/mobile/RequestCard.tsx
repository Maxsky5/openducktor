// A pending request of a mobile session, as request-card.tsx in
// apps/mobile/src/features/session/pending-input: a header with the icon, the title, a one-line
// description, the status, and the fold chevron, then the body, and the feedback rows under the
// body. A permission is an amber card, and a question is a card with an input outline. The labels
// come from PENDING_INPUT_LABELS of packages/frontend-core.
import { ChevronDown, CircleDotDashed, ShieldAlert } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import "./RequestCard.css";

/** The labels of pending-input-labels.ts that the cards show. */
export const REQUEST_LABELS = {
  permissionTitle: "Approval required",
  questionTitle: "Input needed",
  permissionStatus: "Action required",
  submittingAnswers: "Submitting answers…",
} as const;

type RequestCardProps = {
  kind: "permission" | "question";
  description: string;
  status: ReactNode;
  /** The hook that a scene uses to find the card. */
  request?: string;
  /** The state of the request that the parts of the card show, such as a question that submits. */
  state?: string | undefined;
  /** The rows under the body, such as the submit progress. */
  feedback?: ReactNode;
  hidden?: boolean | undefined;
  children: ReactNode;
};

export function RequestCard({
  kind,
  description,
  status,
  request,
  state,
  feedback,
  hidden,
  children,
}: RequestCardProps): ReactElement {
  const permission = kind === "permission";
  return (
    <div
      className="mob-request"
      data-kind={kind}
      hidden={hidden}
      data-request={request}
      data-request-state={state}
    >
      <div className="mob-request-head">
        <span className="mob-request-text">
          <span className="mob-request-title">
            {permission ? <ShieldAlert /> : <CircleDotDashed />}
            {permission ? REQUEST_LABELS.permissionTitle : REQUEST_LABELS.questionTitle}
          </span>
          <span className="mob-request-description">{description}</span>
        </span>
        <span className="mob-request-status">{status}</span>
        <ChevronDown className="mob-request-chevron" />
      </div>
      <div className="mob-request-body">{children}</div>
      {feedback && <div className="mob-request-feedback">{feedback}</div>}
    </div>
  );
}

/** The look of a reply button of session-button.tsx. */
export type ReplyVariant = "default" | "outline" | "destructive";

/** A reply button of a request. A scene finds it by `data-reply`. */
export function ReplyButton({
  label,
  variant,
  reply,
  icon,
}: {
  label: ReactNode;
  variant: ReplyVariant;
  reply?: string;
  icon?: ReactNode;
}): ReactElement {
  return (
    <span className="mob-reply" data-variant={variant} data-reply={reply}>
      {icon}
      {label}
    </span>
  );
}
