// The stack of the in-app notifications at the bottom right of the window. A scene adds the
// notifications from its templates. A view that ends on a notification renders it in the stack.
import type { ReactElement, ReactNode } from "react";
import "./ToastStack.css";

type ToastStackProps = {
  /** The stack shows no notifications. The scene still adds them, so its timeline keeps its steps. */
  hidden?: boolean;
  /** The notifications of the last frame. */
  children?: ReactNode;
};

export function ToastStack({ hidden = false, children }: ToastStackProps): ReactElement {
  return (
    <div className="toast-stack" hidden={hidden} data-toasts="">
      {children}
    </div>
  );
}
