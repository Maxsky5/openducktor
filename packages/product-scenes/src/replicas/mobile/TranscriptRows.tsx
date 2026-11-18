// The message rows of a mobile session transcript, as assistant-message-row.tsx, separator-row.tsx,
// and markdown-blocks.tsx in apps/mobile/src/features/session/transcript/rows. An assistant message
// is full-width document Markdown without a bubble. The last message of a turn comes after the
// separator with the time of the turn, and ends with the model that answered and the copy and fork
// actions. ToolRun.tsx shows the tool calls, and UserMessageRow.tsx the messages of the user. The
// rows keep the hooks of replicas/transcript/rows.ts, so its steps show and stream them. A web
// address in a message is a link, as the GFM autolinks of markdown-inline.tsx in
// apps/mobile/src/rich-content/markdown show it.
import { Copy, GitFork } from "lucide-react";
import type { ReactElement } from "react";
import { type Session, signature } from "../../sample/sessions";
import { InlineCode } from "../ui/InlineCode";
import "./TranscriptRows.css";

/** A web address up to its last character that is not a punctuation mark. */
const WEB_ADDRESS = /(https?:\/\/\S*[^\s.,;:!?)])/;

/** A paragraph of a message with its inline code spans and its links. */
function MessageParagraph({ text }: { text: string }): ReactElement {
  return (
    <p>
      {text.split(WEB_ADDRESS).map((part, index) =>
        // The parts of a split never change order, so the index is a stable key.
        index % 2 === 1 ? (
          <span key={index} className="mob-agent-link">
            {part}
          </span>
        ) : (
          <InlineCode key={index} text={part} />
        ),
      )}
    </p>
  );
}

/**
 * An assistant message. `paragraphs` take inline code in backticks, as the Markdown of the app
 * renders it. The last message of a turn takes the session that answered, and shows its footer.
 */
export function AgentMessage({
  paragraphs,
  footer,
  row,
  hidden,
}: {
  paragraphs: readonly string[];
  footer?: Session | undefined;
  row?: string;
  hidden?: boolean | undefined;
}): ReactElement {
  return (
    <div className="mob-agent" hidden={hidden} data-row={row}>
      <div className="mob-agent-text" data-text="">
        {paragraphs.map((paragraph) => (
          <MessageParagraph key={paragraph} text={paragraph} />
        ))}
      </div>
      {footer ? (
        <div className="mob-agent-footer" data-sig="">
          <span className="mob-agent-info" data-runtime={footer.runtime}>
            <i />
            <span>{signature(footer)}</span>
          </span>
          <Copy className="mob-agent-action" />
          <GitFork className="mob-agent-action" />
        </div>
      ) : null}
    </div>
  );
}

/** The separator before the last message of a turn, with the time that the turn took. */
export function TurnSeparator({
  worked,
  row,
  hidden,
}: {
  worked: string;
  row?: string;
  hidden?: boolean | undefined;
}): ReactElement {
  return (
    <div className="mob-separator" data-row={row} hidden={hidden}>
      <i />
      <span>Worked for {worked}</span>
      <i />
    </div>
  );
}
