import { type SourceIssue } from "@openducktor/contracts";
import { builtinIssueTypeId } from "@openducktor/workflows";
import { ChevronDown, CircleAlert, CircleCheck, Trash2 } from "lucide-react";
import type { ReactElement } from "react";
import { ISSUE_TYPE_OPTIONS } from "@/components/features/task-composer/constants";
import { toPrioritySelectOptions } from "@openducktor/frontend-core/tasks/create/task-composer-options";
import { Button } from "@/components/ui/button";
import { Collapsible } from "@/components/ui/collapsible-root";
import { CollapsibleContent } from "@/components/ui/collapsible-content";
import { CollapsibleTrigger } from "@/components/ui/collapsible-trigger";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { IssueMarkdownRenderer } from "@/components/features/issue-source/issue-markdown-renderer";
import { TagSelector } from "@/components/ui/tag-selector";
import { cn } from "@/lib/utils";
import {
  ISSUE_IMPORT_LABELS,
  issueImportItemTitle,
  issueImportReviewStatus,
} from "@openducktor/frontend-core/tasks/issue-import/issue-import-model";
import {
  initialReview,
  type ImportOutcome,
  type IssueReview,
} from "@openducktor/frontend-core/tasks/issue-import/issue-import-state";

const ISSUE_TYPE_COMBOBOX_OPTIONS: ComboboxOption[] = ISSUE_TYPE_OPTIONS.map((option) => {
  const Icon = option.icon;
  return {
    value: option.value,
    label: option.label,
    description: option.description,
    icon: <Icon className="size-4" />,
  };
});
const PRIORITY_COMBOBOX_OPTIONS = toPrioritySelectOptions();
const LABEL_COMMIT_KEYS = ["Enter"] as const;

type IssueReviewStepProps = {
  repoPath: string;
  selectedItems: SourceIssue[];
  reviews: Map<string, IssueReview>;
  outcomes: Map<string, ImportOutcome>;
  isSubmitting: boolean;
  refreshingId: string | null;
  submitError: string | null;
  removeItem: (sourceId: string) => void;
  changeReview: (sourceId: string, update: Partial<IssueReview>) => void;
  refreshItem: (sourceId: string) => Promise<void>;
};

export function IssueReviewStep({
  repoPath,
  selectedItems,
  reviews,
  outcomes,
  isSubmitting,
  refreshingId,
  submitError,
  removeItem,
  changeReview,
  refreshItem,
}: IssueReviewStepProps): ReactElement {
  return (
    <div className="flex flex-col gap-4">
      {selectedItems.map((item) => (
        <IssueReviewCard
          repoPath={repoPath}
          key={item.sourceId}
          item={item}
          review={reviews.get(item.sourceId) ?? initialReview(item)}
          outcome={outcomes.get(item.sourceId)}
          isSubmitting={isSubmitting}
          isRefreshing={refreshingId === item.sourceId}
          onRemove={() => removeItem(item.sourceId)}
          onChange={(update) => changeReview(item.sourceId, update)}
          onRefresh={() => void refreshItem(item.sourceId)}
        />
      ))}
      {submitError ? (
        <p role="alert" className="text-sm text-destructive">
          {submitError}
        </p>
      ) : null}
    </div>
  );
}

function IssueReviewCard({
  repoPath,
  item,
  review,
  outcome,
  isSubmitting,
  isRefreshing,
  onRemove,
  onChange,
  onRefresh,
}: {
  repoPath: string;
  item: SourceIssue;
  review: IssueReview;
  outcome: ImportOutcome | undefined;
  isSubmitting: boolean;
  isRefreshing: boolean;
  onRemove: () => void;
  onChange: (update: Partial<IssueReview>) => void;
  onRefresh: () => void;
}): ReactElement {
  const fieldsDisabled = isSubmitting || outcome?.outcome === "created";
  const wasCreated = outcome?.outcome === "created";
  const statusText = issueImportReviewStatus(item, outcome)?.text ?? null;
  return (
    <section
      aria-label={`Review ${item.title}`}
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{issueImportItemTitle(item)}</p>
          <p className="text-xs text-muted-foreground">{item.creator}</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="destructiveGhost"
          disabled={isSubmitting}
          onClick={onRemove}
        >
          <Trash2 className="size-4" />
          {ISSUE_IMPORT_LABELS.remove}
        </Button>
      </div>
      <Collapsible className="rounded-md bg-muted/50">
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" className="group w-full justify-between px-3">
            {ISSUE_IMPORT_LABELS.description}
            <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent
          aria-label={`Description for ${item.title}`}
          className="max-h-[32rem] overflow-y-auto px-3 pb-3"
          role="region"
          tabIndex={0}
        >
          {item.description ? (
            <IssueMarkdownRenderer
              markdown={item.description}
              issueImageContext={{ repoPath, sourceId: item.sourceId, providerId: item.providerId }}
              variant="compact"
              lightweight
              className="break-words prose-code:text-rose-700 dark:prose-code:text-rose-300 [&_img]:max-h-48 [&_img]:rounded-md [&_pre]:overflow-x-hidden [&_pre]:whitespace-pre-wrap [&_pre]:break-all"
            />
          ) : (
            <p className="text-sm text-muted-foreground">{ISSUE_IMPORT_LABELS.noDescription}</p>
          )}
        </CollapsibleContent>
      </Collapsible>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label id={`issue-type-label-${item.sourceId}`}>{ISSUE_IMPORT_LABELS.issueType}</Label>
          <Combobox
            disabled={fieldsDisabled}
            value={review.issueType}
            options={ISSUE_TYPE_COMBOBOX_OPTIONS}
            searchable={false}
            triggerAriaLabelledBy={`issue-type-label-${item.sourceId}`}
            onValueChange={(value) => onChange({ issueType: builtinIssueTypeId(value) })}
          />
        </div>
        <div className="grid gap-2">
          <Label id={`priority-label-${item.sourceId}`}>{ISSUE_IMPORT_LABELS.priority}</Label>
          <Combobox
            disabled={fieldsDisabled}
            value={String(review.priority)}
            options={PRIORITY_COMBOBOX_OPTIONS}
            searchable={false}
            triggerAriaLabelledBy={`priority-label-${item.sourceId}`}
            onValueChange={(value) => onChange({ priority: Number(value) })}
          />
        </div>
      </div>
      <div className="grid gap-2">
        <Label>{ISSUE_IMPORT_LABELS.labels}</Label>
        <TagSelector
          value={review.labels}
          suggestions={item.tags}
          disabled={fieldsDisabled}
          commitKeys={LABEL_COMMIT_KEYS}
          onChange={(labels) => onChange({ labels })}
        />
      </div>
      {statusText ? (
        <div
          role="status"
          className={cn(
            "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
            wasCreated
              ? "border-success-border bg-success-surface text-success-surface-foreground"
              : "border-destructive-border bg-destructive-surface text-destructive-surface-foreground",
          )}
        >
          {wasCreated ? (
            <CircleCheck className="mt-0.5 size-4 shrink-0" />
          ) : (
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
          )}
          <span>{statusText}</span>
        </div>
      ) : null}
      {outcome?.outcome === "failed" ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isSubmitting || isRefreshing}
          onClick={onRefresh}
        >
          {isRefreshing ? ISSUE_IMPORT_LABELS.refreshingItem : ISSUE_IMPORT_LABELS.refreshItem}
        </Button>
      ) : null}
    </section>
  );
}
