// A Permission Prompt of a mobile session, as permission-prompt-card.tsx in
// apps/mobile/src/features/session/pending-input: the amber request card with the details of the
// request in short lines, and the replies that the runtime offers, in request order. Two replies
// share one row, and more replies stack at the full width.
import type { ReactElement } from "react";
import { ReplyButton, type ReplyVariant, RequestCard, REQUEST_LABELS } from "./RequestCard";
import "./PermissionCard.css";

/** A reply of the request: its outcome, its label, and its look. */
export type PermissionReply = { outcome: string; label: string; variant: ReplyVariant };

/** The fields of AgentApprovalRequest that the card shows. */
export type PermissionRequest = {
  title: string;
  /** What the operation can change, such as "Effect unknown". */
  mutation?: string;
  summary?: string;
  command?: string;
  workingDirectory?: string;
  action?: string;
  tool?: string;
  replies: readonly PermissionReply[];
};

/**
 * The working directory on one line with the ellipsis in the middle, as `ellipsizeMode="middle"`
 * shows it: the start of the path gives way, and its last two folders stay.
 */
function WorkingDirectory({ path }: { path: string }): ReactElement {
  const parts = path.split("/");
  const tail = parts.slice(-2).join("/");
  const head = `In ${parts.slice(0, -2).join("/")}/`;
  return (
    <p className="mob-approval-path">
      <span>{head}</span>
      <span>{tail}</span>
    </p>
  );
}

export function PermissionCard({
  request,
  hidden,
}: {
  request: PermissionRequest;
  hidden?: boolean | undefined;
}): ReactElement {
  const { title, mutation, summary, command, workingDirectory, action, tool, replies } = request;
  return (
    <RequestCard
      kind="permission"
      description={title}
      status={REQUEST_LABELS.permissionStatus}
      request="permission"
      hidden={hidden}
    >
      <div className="mob-approval">
        <p className="mob-approval-title">{title}</p>
        {mutation && <p className="mob-approval-muted">{mutation}</p>}
        {summary && <p>{summary}</p>}
        {command && (
          <div>
            <p>Command: {command}</p>
            {workingDirectory && <WorkingDirectory path={workingDirectory} />}
          </div>
        )}
        {action && <p>Action: {action}</p>}
        {tool && <p>Tool: {tool}</p>}
      </div>
      <div className="mob-replies" data-stack={replies.length > 2 ? "column" : "row"}>
        {replies.map((reply) => (
          <ReplyButton
            key={reply.outcome}
            label={reply.label}
            variant={reply.variant}
            reply={reply.outcome}
          />
        ))}
      </div>
    </RequestCard>
  );
}
