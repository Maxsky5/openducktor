// The frame of a pending request of a session, above the composer. agent-session-question-card.tsx
// and agent-session-approval-card.tsx share it: the header names the request, `meta` holds its
// status, and the children hold its body.
import type { LucideIcon } from "lucide-react";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import "./RequestCard.css";

type RequestCardProps = Omit<ComponentProps<"div">, "title"> & {
  kind: "question" | "approval";
  title: string;
  icon: LucideIcon;
  meta?: ReactNode;
};

export function RequestCard({
  kind,
  title,
  icon: Icon,
  meta,
  children,
  ...attributes
}: RequestCardProps): ReactElement {
  return (
    <div className="request" data-kind={kind} data-request="" {...attributes}>
      <div className="request-head">
        <span>
          <Icon />
          {title}
        </span>
        {meta}
      </div>
      <div className="request-body">{children}</div>
    </div>
  );
}
