// The touch of a finger on the phone, as a screen recording shows a touch: a soft gray circle.
// finger.ts moves it and taps with it. A framed scene hides it.
import type { ReactElement } from "react";
import "./Touch.css";

export function Touch(): ReactElement {
  return <span className="mob-touch" aria-hidden="true" data-touch="" />;
}
