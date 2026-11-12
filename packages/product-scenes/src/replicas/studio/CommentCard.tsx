// A comment card of task-execution-ci-comment-card.tsx: the avatar, the author, the Bot badge, the
// badge of a review outcome, the relative time, and for a review thread its resolution and its
// place in the code. An unresolved item opens, and a resolved thread stays closed. An open card
// shows the diff hunk of the thread, the Markdown body, and each suggested change. A scene shows
// and hides a card with `hidden`, and changes the text of its `data-age` time.
import { ChevronRight, ExternalLink, Lightbulb } from "lucide-react";
import type { ReactElement } from "react";
import { flag } from "../flag";
import {
  type CiComment,
  COMMENTS_TEXT,
  commentAge,
  commentLocation,
  REVIEW_OUTCOMES,
} from "./comments";
import { PatchDiff } from "./PatchDiff";
import { Paragraph } from "../ui/InlineCode";
import "./CommentCard.css";

type CommentCardProps = {
  comment: CiComment;
  /** The time of the last read of the pull request, for the relative time. */
  now: string;
  hidden?: boolean;
};

type SuggestionProps = { patch: string; position: number; total: number };

function Suggestion({ patch, position, total }: SuggestionProps): ReactElement {
  return (
    <section className="cc-suggestion" data-suggestion="">
      <div>
        <header>
          <Lightbulb className="i14" />
          <b>{COMMENTS_TEXT.suggestion}</b>
          {total > 1 && (
            <small>
              {position} of {total}
            </small>
          )}
        </header>
        <PatchDiff patch={patch} />
      </div>
    </section>
  );
}

function CommentBody({ comment }: { comment: CiComment }): ReactElement {
  const suggestions = comment.suggestions ?? [];
  return (
    <div>
      {comment.patch && (
        <div className="cc-patch">
          <PatchDiff patch={comment.patch} />
        </div>
      )}
      {comment.body && (
        <div className="cc-body">
          {comment.body.split("\n\n").map((text) => (
            <Paragraph text={text} key={text} />
          ))}
        </div>
      )}
      {suggestions.map((patch, index) => (
        <Suggestion patch={patch} position={index + 1} total={suggestions.length} key={patch} />
      ))}
    </div>
  );
}

function ThreadRow({ comment }: { comment: CiComment }): ReactElement | null {
  const location = commentLocation(comment);
  if (comment.resolved === null && !location) return null;
  return (
    <span className="cc-thread">
      {comment.resolved !== null && (
        <span className="cc-badge" data-variant={comment.resolved ? "success" : "warning"}>
          {comment.resolved ? COMMENTS_TEXT.resolved : COMMENTS_TEXT.unresolved}
        </span>
      )}
      {location && (
        <span className="cc-location" dir="rtl">
          <span dir="ltr">{location}</span>
        </span>
      )}
    </span>
  );
}

export function CommentCard({ comment, now, hidden = false }: CommentCardProps): ReactElement {
  const open = comment.resolved !== true;
  const outcome = comment.outcome && REVIEW_OUTCOMES[comment.outcome];
  return (
    <article
      className="cc-card"
      hidden={hidden}
      data-comment={comment.id}
      data-bot={flag(comment.bot)}
      data-resolved={flag(comment.resolved === true)}
    >
      <header>
        <span className="cc-toggle" data-open={flag(open)}>
          <span className="cc-avatar">{comment.author.charAt(0).toUpperCase()}</span>
          <span className="cc-meta">
            <span className="cc-line">
              <b>{comment.author}</b>
              {comment.bot && (
                <span className="cc-badge cc-bot" data-variant="secondary">
                  {COMMENTS_TEXT.bot}
                </span>
              )}
              {outcome && (
                <span className="cc-badge" data-variant={outcome.variant}>
                  {outcome.label}
                </span>
              )}
              <small data-age={comment.createdAt}>{commentAge(comment.createdAt, now)}</small>
            </span>
            <ThreadRow comment={comment} />
          </span>
          <ChevronRight className="cc-chevron" />
        </span>
        <span className="cc-open">
          <span>
            <ExternalLink className="i14" />
          </span>
        </span>
      </header>
      {open && <CommentBody comment={comment} />}
    </article>
  );
}
