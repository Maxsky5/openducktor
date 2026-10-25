import type { RepositoryGitProviderContext, SourceIssue } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import { type ReactElement, useState } from "react";
import { toast } from "sonner";
import { useSettingsModal } from "@/components/features/settings/settings-modal";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { openExternalUrl } from "@/lib/open-external-url";
import {
  ISSUE_IMPORT_LABELS,
  type IssueImportStep,
  issueImportCreatedMessage,
  issueImportListQueryOptions,
  issueImportStepDescription,
  issueImportTitle,
  issueImportUnavailableReason,
  selectedItemsWithCurrentLinks,
} from "@openducktor/frontend-core/tasks/issue-import/issue-import-model";
import {
  useIssueImportSearch,
  useIssueImportSubmission,
  useIssueSelectionState,
} from "@openducktor/frontend-core/tasks/issue-import/issue-import-state";
import { IssueReviewStep } from "./issue-import-review-step";
import { IssueSelectionStep } from "./issue-import-selection-step";

type IssueImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoPath: string;
  provider: NonNullable<RepositoryGitProviderContext>;
  onCloseAutoFocus?: (event: Event) => void;
};

export function IssueImportDialog({ open, ...props }: IssueImportDialogProps): ReactElement | null {
  return open ? <IssueImportDialogSession {...props} /> : null;
}

function IssueImportDialogSession({
  onOpenChange,
  repoPath,
  provider,
  onCloseAutoFocus,
}: Omit<IssueImportDialogProps, "open">): ReactElement {
  const { openSettings } = useSettingsModal();
  const [step, setStep] = useState<IssueImportStep>("select");
  const {
    searchText,
    setSearchText,
    search,
    cursors,
    setCursors,
    pageIndex,
    setPageIndex,
    searchPending,
  } = useIssueImportSearch();
  const { selected, reviews, toggleItem, removeItem, changeReview, replaceItem } =
    useIssueSelectionState();
  const unavailableReason = issueImportUnavailableReason(provider);
  const unavailable = unavailableReason !== null;
  const query = useQuery({
    ...issueImportListQueryOptions({ repoPath, provider, search, cursor: cursors[pageIndex] }),
    enabled: !unavailable && !searchPending,
  });
  const items = query.data?.items ?? [];
  const selectedItems = selectedItemsWithCurrentLinks(selected, items);
  const {
    outcomes,
    isSubmitting,
    refreshingId,
    submitError,
    pendingItems,
    importItems,
    refreshItem,
    clearOutcome,
  } = useIssueImportSubmission({
    selectedItems,
    reviews,
    repoPath,
    providerId: provider.config.id,
    providerScope: provider.config,
    onComplete: (createdCount) => {
      onOpenChange(false);
      toast.success(issueImportCreatedMessage(createdCount));
    },
    onRefreshed: replaceItem,
  });
  const removeSelectedItem = (sourceId: string): void => {
    removeItem(sourceId);
    clearOutcome(sourceId);
  };
  const toggleSelectedItem = (item: SourceIssue): void => {
    if (selected.has(item.sourceId)) clearOutcome(item.sourceId);
    toggleItem(item);
  };

  const showSettings = (): void => {
    onOpenChange(false);
    openSettings({
      deepLink: { kind: "repository-configuration", repositoryPath: repoPath },
    });
  };

  const openSource = (item: SourceIssue): void => {
    void openExternalUrl(item.url).catch((cause) =>
      toast.error(ISSUE_IMPORT_LABELS.openSourceFailed, { description: errorMessage(cause) }),
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!isSubmitting && refreshingId === null) onOpenChange(next);
      }}
    >
      <DialogContent
        onCloseAutoFocus={onCloseAutoFocus}
        className="my-0 gap-0 p-0 sm:max-w-3xl"
        closeButton={isSubmitting || refreshingId !== null ? null : undefined}
      >
        <IssueImportHeader providerId={provider.config.id} step={step} />
        <DialogBody className="flex flex-col gap-4 overflow-y-auto px-6 py-4">
          <IssueImportBodyContent
            unavailableReason={unavailableReason}
            onOpenSettings={showSettings}
            step={step}
            selection={
              <IssueSelectionStep
                provider={provider}
                query={query}
                searchText={searchText}
                searchPending={searchPending}
                setSearchText={setSearchText}
                setCursors={setCursors}
                setPageIndex={setPageIndex}
                pageIndex={pageIndex}
                selected={selected}
                selectedItems={selectedItems}
                toggleItem={toggleSelectedItem}
                removeItem={removeSelectedItem}
                openSource={openSource}
              />
            }
            review={
              <IssueReviewStep
                repoPath={repoPath}
                selectedItems={selectedItems}
                reviews={reviews}
                outcomes={outcomes}
                isSubmitting={isSubmitting || refreshingId !== null}
                refreshingId={refreshingId}
                submitError={submitError}
                removeItem={removeSelectedItem}
                changeReview={changeReview}
                refreshItem={refreshItem}
              />
            }
          />
        </DialogBody>
        <IssueImportFooter
          unavailable={unavailable}
          step={step}
          pendingCount={pendingItems.length}
          busy={isSubmitting ? "import" : refreshingId !== null ? "refresh" : null}
          onBack={() => setStep("select")}
          onReview={() => setStep("review")}
          importItems={importItems}
        />
      </DialogContent>
    </Dialog>
  );
}

function IssueImportBodyContent({
  unavailableReason,
  onOpenSettings,
  step,
  selection,
  review,
}: {
  unavailableReason: string | null;
  onOpenSettings: () => void;
  step: IssueImportStep;
  selection: ReactElement;
  review: ReactElement;
}): ReactElement {
  if (unavailableReason) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warning-border bg-warning-surface p-4 text-sm text-warning-surface-foreground">
        <p>{unavailableReason}</p>
        <Button type="button" variant="outline" onClick={onOpenSettings}>
          {ISSUE_IMPORT_LABELS.openRepositorySettings}
        </Button>
      </div>
    );
  }
  return step === "select" ? selection : review;
}

function IssueImportHeader({
  providerId,
  step,
}: {
  providerId: string;
  step: IssueImportStep;
}): ReactElement {
  return (
    <DialogHeader className="border-b border-border px-6 py-4 pr-14">
      <DialogTitle>{issueImportTitle(providerId)}</DialogTitle>
      <DialogDescription>{issueImportStepDescription(step)}</DialogDescription>
    </DialogHeader>
  );
}

function IssueImportFooter({
  unavailable,
  step,
  pendingCount,
  busy,
  onBack,
  onReview,
  importItems,
}: {
  unavailable: boolean;
  step: IssueImportStep;
  pendingCount: number;
  busy: "import" | "refresh" | null;
  onBack: () => void;
  onReview: () => void;
  importItems: () => Promise<void>;
}): ReactElement | null {
  if (unavailable) return null;
  return (
    <DialogFooter className="mt-0 flex-row items-center justify-between border-t border-border px-6 py-4">
      {step === "review" ? (
        <Button type="button" variant="outline" disabled={busy !== null} onClick={onBack}>
          <ArrowLeft className="size-4" />
          {ISSUE_IMPORT_LABELS.back}
        </Button>
      ) : null}
      {step === "select" ? (
        <Button type="button" className="ml-auto" disabled={pendingCount === 0} onClick={onReview}>
          {ISSUE_IMPORT_LABELS.reviewTasks}
        </Button>
      ) : (
        <Button
          type="button"
          className="ml-auto"
          disabled={busy !== null || pendingCount === 0}
          onClick={() => void importItems()}
        >
          {busy === "import" ? <Loader2 className="size-4 animate-spin" /> : null}
          {busy === "import" ? ISSUE_IMPORT_LABELS.importing : ISSUE_IMPORT_LABELS.importSelected}
        </Button>
      )}
    </DialogFooter>
  );
}
