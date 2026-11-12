// The pending review comments in the composer card, as pending-comments-notice.tsx in
// apps/mobile/src/features/composer: one line that counts the comments that go with the next
// message, and the View link to Changes. A send takes the comments, and a scene hides the notice.
import { MessageSquareDiff } from "lucide-react";
import type { ReactElement } from "react";
import "./PendingCommentsNotice.css";

/** The line of the notice for `count` comments. */
export function pendingCommentsText(count: number): string {
  return `${count} pending review ${count === 1 ? "comment goes" : "comments go"} with your next message`;
}

export function PendingCommentsNotice({ count }: { count: number }): ReactElement {
  return (
    <div className="mob-comments-notice" data-comments-notice="">
      <MessageSquareDiff />
      <span>{pendingCommentsText(count)}</span>
      <strong>View</strong>
    </div>
  );
}
