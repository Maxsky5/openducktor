// The fake pointer of a replica and its click ring. cursor.ts moves them. A framed scene hides
// them, and they still move, so the scene plays the same steps without a pointer on screen.
import type { ReactElement } from "react";
import "./Pointer.css";

export function Pointer(): ReactElement {
  return (
    <>
      <svg className="cursor" viewBox="0 0 22 22" aria-hidden="true" data-cursor="">
        <path d="M4 2.5v15.2l4.1-3.9 2.7 6.1 2.6-1.1-2.7-6h5.8L4 2.5Z" strokeLinejoin="round" />
      </svg>
      <span className="click-ring" aria-hidden="true" data-click-ring="" />
    </>
  );
}
