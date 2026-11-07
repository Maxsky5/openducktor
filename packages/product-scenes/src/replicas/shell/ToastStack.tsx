// The stack of the in-app notifications at the bottom right of the window. A scene adds the
// notifications from its templates.
import type { ReactElement } from "react";
import "./ToastStack.css";

type ToastStackProps = {
  /** The stack shows no notifications. The scene still adds them, so its timeline keeps its steps. */
  hidden?: boolean;
};

export function ToastStack({ hidden = false }: ToastStackProps): ReactElement {
  return <div className="toast-stack" hidden={hidden} data-toasts="" />;
}
