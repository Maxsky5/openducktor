// The fake pointer of a replica and its click ring. cursor.ts moves them. A framed scene hides
// them, and they still move, so the scene plays the same steps without a pointer on screen.
// `data-shape="crosshair"` on the cursor shows the crosshair of the element picker of a browser
// tab in place of the arrow.
import type { ReactElement } from "react";
import "./Pointer.css";

/** The four arms of the crosshair, open around the tip of the arrow. */
const CROSS = "M4 -6v7.4M4 4.6V12M-5 3h7.4M6.6 3H13";

export function Pointer(): ReactElement {
  return (
    <>
      <svg className="cursor" viewBox="0 0 22 22" aria-hidden="true" data-cursor="">
        <path
          className="cursor-arrow"
          d="M4 2.5v15.2l4.1-3.9 2.7 6.1 2.6-1.1-2.7-6h5.8L4 2.5Z"
          strokeLinejoin="round"
        />
        <g className="cursor-cross">
          <path className="cursor-cross-halo" d={CROSS} />
          <path className="cursor-cross-line" d={CROSS} />
        </g>
      </svg>
      <span className="click-ring" aria-hidden="true" data-click-ring="" />
    </>
  );
}
