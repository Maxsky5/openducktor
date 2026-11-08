// The reply view of command-palette-reply.tsx: the Reply here block of the waiting session under
// the chip of its task. After the answer, the palette closes.
import type { ReactElement } from "react";
import { WAITING_QUESTION } from "../../sample/question";
import { ReplyHere } from "../transcript/ReplyHere";
import "./PaletteReply.css";

export function PaletteReply(): ReactElement {
  return (
    <div className="pal-reply" data-pal-list="reply">
      <ReplyHere question={WAITING_QUESTION} />
    </div>
  );
}
