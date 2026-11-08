// A toast of the mobile app, as feedback-host.tsx in apps/mobile/src/feedback: a card near the top
// of the screen, under the tallest top bar, with the icon of its kind on a tinted circle, the
// message, and the details. A scene finds it by `data-toast` and shows or hides it.
import { Check, Info, TriangleAlert, X } from "lucide-react";
import type { ReactElement } from "react";
import "./MobileToast.css";

export type ToastKind = "success" | "info" | "warning" | "error";

const ICONS = { success: Check, info: Info, warning: TriangleAlert, error: X } as const;

type MobileToastProps = {
  kind: ToastKind;
  message: string;
  description?: string;
  /** The hook that a scene uses to find the toast. */
  toast?: string;
  hidden?: boolean | undefined;
};

export function MobileToast({
  kind,
  message,
  description,
  toast,
  hidden,
}: MobileToastProps): ReactElement {
  const Icon = ICONS[kind];
  return (
    <div className="mob-toast" data-kind={kind} hidden={hidden} data-toast={toast}>
      <span className="mob-toast-icon">
        <Icon />
      </span>
      <span className="mob-toast-body">
        <strong>{message}</strong>
        {description && <span>{description}</span>}
      </span>
    </div>
  );
}
