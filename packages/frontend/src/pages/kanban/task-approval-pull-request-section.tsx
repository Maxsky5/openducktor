import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import type { MouseEvent, ReactElement } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { openExternalUrl } from "@/lib/open-external-url";
import {
  TASK_APPROVAL_COPY as COPY,
  TASK_APPROVAL_PULL_REQUEST_DRAFT_OPTIONS,
} from "@openducktor/frontend-core/tasks/approval/task-approval-copy";
import type { TaskApprovalApprovalModalModel } from "@openducktor/frontend-core/tasks/approval/task-approval-types";
import { OptionCard, SECTION_LABEL_CLASS } from "./task-approval-stage-controls";

export function TaskApprovalPullRequestSection({
  model,
}: {
  model: TaskApprovalApprovalModalModel;
}): ReactElement {
  const openExistingPullRequest = (event: MouseEvent<HTMLAnchorElement>): void => {
    event.preventDefault();
    if (model.pullRequestUrl) {
      openExistingPullRequestUrl(model.pullRequestUrl);
    }
  };
  const openExistingPullRequestFromAuxiliaryClick = (
    event: MouseEvent<HTMLAnchorElement>,
  ): void => {
    event.preventDefault();
    if (event.button === 1 && model.pullRequestUrl) {
      openExistingPullRequestUrl(model.pullRequestUrl);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Label className={SECTION_LABEL_CLASS}>{COPY.pullRequestDraftLabel}</Label>
        <div className="grid gap-3 md:grid-cols-2">
          {TASK_APPROVAL_PULL_REQUEST_DRAFT_OPTIONS.map((option) => (
            <OptionCard
              key={option.value}
              value={option.value}
              selectedValue={model.pullRequestDraftMode}
              label={option.label}
              description={option.description}
              disabled={model.isSubmitting}
              onSelect={model.onPullRequestDraftModeChange}
            />
          ))}
        </div>
      </div>

      {model.pullRequestDraftMode === "manual" ? (
        <div className="grid gap-4 rounded-lg border border-border bg-card p-3">
          <div className="grid gap-2">
            <Label htmlFor="task-approval-pr-title">{COPY.pullRequestTitleLabel}</Label>
            <Input
              id="task-approval-pr-title"
              value={model.title}
              disabled={model.isSubmitting}
              onChange={(event) => model.onTitleChange(event.currentTarget.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="task-approval-pr-body">{COPY.pullRequestDescriptionLabel}</Label>
            <Textarea
              id="task-approval-pr-body"
              className="min-h-56"
              value={model.body}
              disabled={model.isSubmitting}
              onChange={(event) => model.onBodyChange(event.currentTarget.value)}
            />
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
          {COPY.generatePullRequestNotice}
        </div>
      )}

      {model.pullRequestUrl ? (
        <a
          href={model.pullRequestUrl}
          onClick={openExistingPullRequest}
          onAuxClick={openExistingPullRequestFromAuxiliaryClick}
          onContextMenu={(event) => event.preventDefault()}
          className="text-sm text-primary underline underline-offset-4"
        >
          {COPY.openExistingPullRequest}
        </a>
      ) : null}
    </div>
  );
}

const openExistingPullRequestUrl = (url: string): void => {
  void openExternalUrl(url).catch((error) => {
    toast.error("Failed to open pull request", {
      description: errorMessage(error),
    });
  });
};
