// A Sonner toast of the desktop app, as the notification center shows an in-app notification.
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
