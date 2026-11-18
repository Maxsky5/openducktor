// A Sonner toast of the desktop app, as the notification center shows an in-app notification, and
// the success toast of the client feedback of an action, such as Task closed.
import { ArrowUpRight, X } from "lucide-react";
import type { ReactElement } from "react";
import type { Notification } from "../vocabulary";
import "./Toast.css";

export function Toast({ title, body }: Notification): ReactElement {
  return (
    <div className="toast">
      <span className="toast-close">
        <X />
      </span>
      <strong>{title}</strong>
      <p>{body}</p>
      <span className="toast-open">
        Open
        <ArrowUpRight className="i14" />
      </span>
    </div>
  );
}

/** The success icon of Sonner. The app colors it with text-success-accent. */
function SuccessIcon(): ReactElement {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
      />
    </svg>
  );
}

/** The toast of feedback.show("success"): the icon, the title, and the description. */
export function SuccessToast({
  title,
  description,
}: {
  title: string;
  description: string;
}): ReactElement {
  return (
    <div className="toast" data-kind="success">
      <span className="toast-close">
        <X />
      </span>
      <span className="toast-icon">
        <SuccessIcon />
      </span>
      <div className="toast-text">
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
    </div>
  );
}
