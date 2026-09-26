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
import { errorMessage } from "@/lib/errors";
import { openExternalUrl } from "@/lib/open-external-url";
import { host } from "@/state/operations/shared/host";
import { issueItemsQueryKeys } from "@/state/queries/issue-items";
import {
  useIssueImportSearch,
  useIssueImportSubmission,
  useIssueSelectionState,
} from "./issue-import-dialog-state";
import { IssueReviewStep } from "./issue-import-review-step";
import { IssueSelectionStep } from "./issue-import-selection-step";

type IssueImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoPath: string;
  provider: NonNullable<RepositoryGitProviderContext>;
  onImported: () => void;
};

export function IssueImportDialog({ open, ...props }: IssueImportDialogProps): ReactElement | null {
  return open ? <IssueImportDialogSession {...props} /> : null;
}

function IssueImportDialogSession({
  onOpenChange,
  repoPath,
  provider,
  onImported,
}: Omit<IssueImportDialogProps, "open">): ReactElement {
  const { openSettings } = useSettingsModal();
  const [step, setStep] = useState<"select" | "review">("select");
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
    queryKey: [
      ...issueItemsQueryKeys.repo(repoPath),
      provider.config.id,
      provider.config.repository,
      provider.config.settings?.areaPath,
      search,
      cursors[pageIndex],
    ],
    enabled: !unavailable && !searchPending,
    queryFn: () => host.issueItemsList({ repoPath, search, cursor: cursors[pageIndex] }),
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
    onImported,
    onComplete: (createdCount) => {
      onOpenChange(false);
      toast.success(`${createdCount} ${createdCount === 1 ? "Task" : "Tasks"} created`);
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
    openSettings();
  };

  const openSource = (item: SourceIssue): void => {
    void openExternalUrl(item.url).catch((cause) =>
      toast.error("Failed to open source item", { description: errorMessage(cause) }),
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

function issueImportUnavailableReason(
  provider: NonNullable<RepositoryGitProviderContext>,
): string | null {
  if (provider.config.id === "azure_devops" && !provider.config.settings?.areaPath) {
    return "Choose an Azure DevOps area path in repository settings before importing work items.";
  }
  if (!provider.health.available) {
    return (
      provider.health.reason ?? "Connect the Git provider in repository settings before importing."
    );
  }
  return null;
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
  step: "select" | "review";
  selection: ReactElement;
  review: ReactElement;
}): ReactElement {
  if (unavailableReason) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warning-border bg-warning-surface p-4 text-sm text-warning-surface-foreground">
        <p>{unavailableReason}</p>
        <Button type="button" variant="outline" onClick={onOpenSettings}>
          Open repository settings
        </Button>
      </div>
    );
  }
  return step === "select" ? selection : review;
}

function selectedItemsWithCurrentLinks(
  selected: Map<string, SourceIssue>,
  items: SourceIssue[],
): SourceIssue[] {
  const linkedOnPage = new Map<string, string>();
  for (const item of items) {
    if (item.linkedTaskId) linkedOnPage.set(item.sourceId, item.linkedTaskId);
  }
  return [...selected.values()].map((item) => {
    const linkedTaskId = linkedOnPage.get(item.sourceId);
    return linkedTaskId ? { ...item, linkedTaskId } : item;
  });
}

function IssueImportHeader({
  providerId,
  step,
}: {
  providerId: string;
  step: "select" | "review";
}): ReactElement {
  return (
    <DialogHeader className="border-b border-border px-6 py-4 pr-14">
      <DialogTitle>
        Import from {providerId === "github" ? "GitHub Issues" : "Azure DevOps work items"}
      </DialogTitle>
      <DialogDescription>
        {step === "select"
          ? "Choose open source items. Your selections stay when you search or change pages."
          : "Review each Task before import."}
      </DialogDescription>
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
  step: "select" | "review";
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
          Back
        </Button>
      ) : null}
      {step === "select" ? (
        <Button type="button" className="ml-auto" disabled={pendingCount === 0} onClick={onReview}>
          Review Tasks
        </Button>
      ) : (
        <Button
          type="button"
          className="ml-auto"
          disabled={busy !== null || pendingCount === 0}
          onClick={() => void importItems()}
        >
          {busy === "import" ? <Loader2 className="size-4 animate-spin" /> : null}
          {busy === "import" ? "Importing..." : "Import selected"}
        </Button>
      )}
    </DialogFooter>
  );
}
