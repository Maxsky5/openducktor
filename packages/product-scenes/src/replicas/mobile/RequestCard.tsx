// A pending request of a mobile session, as request-card.tsx in
// apps/mobile/src/features/session/pending-input: a header with the icon, the title, a one-line
// description, the status, and the fold chevron, then the body. A permission is an amber card, and
// a question is a card with an input outline. The labels come from PENDING_INPUT_LABELS of
// packages/frontend-core.
import { ChevronDown, CircleDotDashed, ShieldAlert } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import "./RequestCard.css";

/** The labels of pending-input-labels.ts that the cards show. */
export const REQUEST_LABELS = {
  permissionTitle: "Approval required",
  questionTitle: "Input needed",
  permissionStatus: "Action required",
} as const;

type RequestCardProps = {
  kind: "permission" | "question";
  description: string;
  status: string;
  /** The hook that a scene uses to find the card. */
  request?: string;
  hidden?: boolean | undefined;
  children: ReactNode;
};

export function RequestCard({
  kind,
  description,
  status,
  request,
  hidden,
  children,
}: RequestCardProps): ReactElement {
  const permission = kind === "permission";
  return (
    <div className="mob-request" data-kind={kind} hidden={hidden} data-request={request}>
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
  label: string;
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
