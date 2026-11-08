// The comments of the CI Checks tab in task-execution-ci-comments-list.tsx: the section head with
// the count, the author filters with their counts, the Filter comments button and its popover with
// Hide resolved, and the comment cards, newest first. A scene changes `data-filter` and
// `data-hide-resolved` of the list, `data-checked` of the switch, the counts, and `hidden` of the
// popover and of each card.
import { ChevronRight, ListFilter, MessageSquare } from "lucide-react";
import type { ReactElement } from "react";
import { flag } from "../flag";
import { Switch } from "../ui/Switch";
import { CommentCard } from "./CommentCard";
import {
  type CiComment,
  COMMENT_FILTERS,
  COMMENTS_TEXT,
  type CommentFilter,
  commentCounts,
} from "./comments";
import "./CommentsList.css";

type CommentsListProps = {
  /** The comments, newest first. */
  comments: readonly CiComment[];
  /** The time of the last read of the pull request, for the relative times. */
  now: string;
  filter?: CommentFilter;
  hideResolved?: boolean;
  /** The Filter comments popover is open. */
  menu?: boolean;
  /** The ids of the comments that the frame does not show yet, such as a later review. */
  later?: readonly string[];
};

export function CommentsList({
  comments,
  now,
  filter = "all",
  hideResolved = false,
  menu = false,
  later = [],
}: CommentsListProps): ReactElement {
  const shown = comments.filter((comment) => !later.includes(comment.id));
  const counts = commentCounts(shown, hideResolved);
  return (
    <div className="cl-section" data-comments="">
      <div className="st-checks-sum st-comments">
        <ChevronRight className="st-checks-chevron" />
        <MessageSquare className="st-comments-icon" />
        <b>{COMMENTS_TEXT.title}</b>
        <span className="st-comments-count" data-comments-total="">
          {shown.length}
        </span>
      </div>
      <div
        className="cl-content"
        data-filter={filter}
        data-hide-resolved={flag(hideResolved)}
        data-comments-list=""
      >
        <div className="cl-bar">
          <div className="cl-filters">
            {COMMENT_FILTERS.map((item) => (
              <span
                className="cl-filter"
                data-active={flag(item.id === filter)}
                data-comment-filter={item.id}
                key={item.id}
              >
                <span>{item.label}</span>
                <span data-comment-count={item.id}>{counts[item.id]}</span>
              </span>
            ))}
          </div>
          <span className="cl-menu-button" data-comments-menu-button="">
            <ListFilter />
          </span>
          <div className="cl-menu" hidden={!menu} data-comments-menu="">
            <div>
              <span>{COMMENTS_TEXT.hideResolved}</span>
              <Switch checked={hideResolved} data-hide-resolved-switch="" />
            </div>
          </div>
        </div>
        <div className="cl-cards">
          {comments.map((comment) => (
            <CommentCard
              comment={comment}
              now={now}
              hidden={later.includes(comment.id)}
              key={comment.id}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
