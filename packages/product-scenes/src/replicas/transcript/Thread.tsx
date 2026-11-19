// The transcript of a chat of the desktop app. The newest rows stay at the bottom, as the product
// follows the stream. `data-thread` gives its rows the motion of a new row of the app.
import type { ReactElement, ReactNode } from "react";
import "./Thread.css";

export function Thread({ children }: { children?: ReactNode }): ReactElement {
  return (
    <div className="st-transcript" data-thread="">
      <div className="st-track" data-track="">
        {children}
      </div>
    </div>
  );
}
