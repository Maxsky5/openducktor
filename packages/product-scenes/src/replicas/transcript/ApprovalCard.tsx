// A pending runtime approval from agent-session-approval-card.tsx, with the Codex command copy of
// packages/adapters-codex-app-server/src/codex-app-server-requests.ts.
import { ShieldAlert } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "../ui/Button";
import { RequestCard } from "./RequestCard";
import "./ApprovalCard.css";

export function ApprovalCard({
  summary,
  command,
}: {
  summary: string;
  command: string;
}): ReactElement {
  return (
    <RequestCard
      kind="approval"
      title="Approval required"
      icon={ShieldAlert}
      meta={<small>Action required</small>}
    >
      <div className="st-approval-text">
        <strong>Bash approval requested</strong>
        <p>{summary}</p>
        <p>Command: {command}</p>
        <p>Action: Bash</p>
      </div>
      <div className="st-approval-actions">
        <Button size="sm" data-approve="once">
          Approve once
        </Button>
        <Button size="sm" variant="outline" data-approve="session">
          Approve for session
        </Button>
        <Button size="sm" variant="destructive">
          Reject
        </Button>
      </div>
    </RequestCard>
  );
}
