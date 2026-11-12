// A user message that carried browser annotations, as agent-chat-message-card-content.tsx shows
// it: the text, one chip for each annotation from browser-annotation-message-chips.tsx, and the
// screenshot of each annotation as an image chip of agent-chat-attachment-chip.tsx. Each shot
// holds a copy of the captured element, and the chip crops it as object-cover does.
import { ImageIcon, SquareDashedMousePointer } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import "../transcript/UserMessage.css";
import "./AnnotatedMessage.css";

type AnnotatedMessageProps = {
  text: string;
  /** The comment of each annotation, in annotation order. */
  comments: readonly string[];
  /** The screenshot of each annotation, in annotation order. */
  shots: readonly ReactNode[];
  time: string;
  row?: string;
};

export function AnnotatedMessage({
  text,
  comments,
  shots,
  time,
  row,
}: AnnotatedMessageProps): ReactElement {
  return (
    <div className="st-user" data-row={row}>
      <div className="am-bubble">
        <p className="am-text">{text}</p>
        <ul className="am-chips">
          {comments.map((comment, index) => (
            <li className="am-chip" data-annotation={index + 1} key={comment}>
              <SquareDashedMousePointer />
              <span>{comment}</span>
            </li>
          ))}
        </ul>
        <div className="am-files">
          {shots.map((shot, index) => (
            // The shots keep their order, so the index is a stable key.
            <div className="am-file" data-annotation={index + 1} key={index}>
              <div className="am-thumb">{shot}</div>
              <div className="am-name">
                <ImageIcon />
                <span>annotation-{index + 1}.png</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <time>{time}</time>
    </div>
  );
}
