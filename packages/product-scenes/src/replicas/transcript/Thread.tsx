// The transcript of a chat. The newest rows stay at the bottom, as the product follows the stream.
import type { ReactElement, ReactNode } from "react";
import "./Thread.css";

export function Thread({ children }: { children?: ReactNode }): ReactElement {
  return (
    <div className="st-transcript">
      <div className="st-track" data-track="">
        {children}
      </div>
    </div>
  );
}
