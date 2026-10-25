import type {
  TaskArtifact,
  TaskArtifactCollection,
  TaskAssetRenderContext,
  TaskCard,
  WorkflowTaskArtifact,
} from "@openducktor/contracts";
import { workflowArtifactId } from "@openducktor/contracts";
import {
  taskArtifactContentQueryOptions,
  taskArtifactsQueryOptions,
} from "@openducktor/frontend-core/queries/artifacts";
import { taskDocumentQueryOptions } from "@openducktor/frontend-core/queries/documents";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronRight,
  FileCode2,
  FileImage,
  FileText,
  Files,
  Lock,
  Plus,
} from "lucide-react";
import {
  type ReactElement,
  type ReactNode,
  type RefObject,
  useCallback,
  useMemo,
  useRef,
  useState,
  memo,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CollapsibleCard } from "@/components/ui/collapsible-card";
import { useDialogPresence } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
import { formatElapsedAgo, useMinuteClock } from "@/lib/relative-time";
import { humanDate } from "@/lib/task-display";
import { cn } from "@/lib/utils";
import { ArtifactActionDialog, type ArtifactAction } from "./artifact-action-dialog";
import { formatFileSize } from "./artifact-file-info";
import { TaskArtifactPreview } from "./task-artifact-preview";
import { FreeArtifactControls, WorkflowArtifactControls } from "./artifact-controls";

export type TaskArtifactsProps = {
  repoPath: string;
  taskId: string;
  workspaceId?: string;
  artifactSummary?: TaskCard["artifactSummary"];
  /** `panel` fills its parent. `section` is a collapsible card that grows with its content. */
  layout?: "panel" | "section";
};

export type ArtifactSelection =
  | { kind: "collection" }
  | { kind: "workflow"; workflowKind: "spec" | "plan" | "qaReport" }
  | { kind: "artifact"; artifactId: string };

export type TaskArtifactsViewProps = TaskArtifactsProps & {
  selection: ArtifactSelection;
  onSelectionChange: (selection: ArtifactSelection) => void;
};

export function TaskArtifacts(props: TaskArtifactsProps): ReactElement {
  return (
    <TaskArtifactsState
      key={`${props.workspaceId ?? ""}:${props.repoPath}:${props.taskId}`}
      {...props}
    />
  );
}

function TaskArtifactsState(props: TaskArtifactsProps): ReactElement {
  const [selection, onSelectionChange] = useState<ArtifactSelection>({ kind: "collection" });
  return (
    <TaskArtifactsView {...props} selection={selection} onSelectionChange={onSelectionChange} />
  );
}

export function TaskArtifactsView(props: TaskArtifactsViewProps): ReactElement {
  return (
    <TooltipProvider>
      <ArtifactCollection
        key={`${props.workspaceId ?? ""}:${props.repoPath}:${props.taskId}`}
        {...props}
      />
    </TooltipProvider>
  );
}

function ArtifactCollection({
  repoPath,
  taskId,
  workspaceId,
  artifactSummary,
  layout = "panel",
  selection,
  onSelectionChange,
}: TaskArtifactsViewProps): ReactElement {
  const queryClient = useQueryClient();
  const collection = useQuery(taskArtifactsQueryOptions(queryClient, repoPath, taskId));
  const [action, setAction] = useState<ArtifactAction | null>(null);
  const [actionOpen, setActionOpen] = useState(false);
  const section = useRef<HTMLElement>(null);
  const actionTrigger = useRef<HTMLElement | null>(null);
  const actionPresence = useDialogPresence(actionOpen);
  const canManage = collection.data?.canManageFree === true && !collection.error;
  const {
    artifact: selected,
    artifactId: selectedId,
    isAbsentWorkflow,
  } = resolveSelection(collection.data?.artifacts, selection, taskId, artifactSummary);
  const openAction = useCallback((next: ArtifactAction, trigger: HTMLElement) => {
    actionTrigger.current = trigger;
    setAction(next);
    setActionOpen(true);
  }, []);
  const select = useCallback(
    (artifactId: string) => {
      onSelectionChange({ kind: "artifact", artifactId });
      requestAnimationFrame(() =>
        section.current?.querySelector<HTMLButtonElement>("button")?.focus(),
      );
    },
    [onSelectionChange],
  );
  const back = useCallback(() => {
    onSelectionChange({ kind: "collection" });
    requestAnimationFrame(() => {
      const rows = section.current?.querySelectorAll<HTMLButtonElement>("[data-artifact-id]");
      const row = Array.from(rows ?? []).find((item) => item.dataset.artifactId === selectedId);
      const target = row ?? section.current?.querySelector<HTMLButtonElement>("button");
      target?.focus();
    });
  }, [selectedId, onSelectionChange]);
  const content = selectedId ? (
    <ArtifactContent
      key={selectedId}
      repoPath={repoPath}
      taskId={taskId}
      artifactId={selectedId}
      title={selected?.name ?? selectionTitle(selection)}
      {...(workspaceId ? { workspaceId } : {})}
      artifact={selected}
      workflowKind={selection.kind === "workflow" ? selection.workflowKind : undefined}
      canManage={canManage}
      onBack={back}
      onAction={openAction}
    />
  ) : null;
  const body = isAbsentWorkflow ? (
    <UnavailableSelection selection={selection} />
  ) : (
    <CollectionBody
      collection={collection}
      selection={selection}
      layout={layout}
      onSelect={select}
    />
  );
  const header = (
    <CollectionHeader
      selection={selection}
      canManage={canManage}
      onBack={back}
      onAction={openAction}
    />
  );
  const restoreActionFocus = useCallback((event: Event) => {
    event.preventDefault();
    const target = actionTrigger.current?.isConnected
      ? actionTrigger.current
      : section.current?.querySelector<HTMLButtonElement>("button");
    target?.focus();
  }, []);
  const frame: ArtifactFrameProps = {
    sectionRef: section,
    content,
    header,
    body,
    collection,
    dialog:
      actionPresence && action ? (
        <ArtifactActionDialog
          key={action.kind === "create" ? "create" : `${action.kind}:${action.artifact.artifactId}`}
          action={action}
          repoPath={repoPath}
          taskId={taskId}
          canManage={canManage}
          open={actionOpen}
          onOpenChange={setActionOpen}
          onCloseAutoFocus={restoreActionFocus}
        />
      ) : null,
  };
  if (layout === "section")
    return (
      <ArtifactSectionFrame
        {...frame}
        isCollection={selection.kind === "collection"}
        headerAction={canManage ? <AddArtifactButton size="xs" onAction={openAction} /> : null}
      />
    );
  return <ArtifactPanelFrame {...frame} />;
}

type ArtifactFrameProps = {
  sectionRef: RefObject<HTMLElement | null>;
  content: ReactElement | null;
  header: ReactElement;
  body: ReactElement;
  collection: UseQueryResult<TaskArtifactCollection>;
  dialog: ReactElement | null;
};

function ArtifactPanelFrame({
  sectionRef,
  content,
  header,
  body,
  collection,
  dialog,
}: ArtifactFrameProps): ReactElement {
  return (
    <section ref={sectionRef} aria-label="Task artifacts" className="flex h-full min-h-0 flex-col">
      {content ?? (
        <>
          {header}
          <div className="min-h-0 flex-1 overflow-auto p-3">{body}</div>
        </>
      )}
      <CollectionNotice collection={collection} className="border-t border-border px-3 py-2" />
      {dialog}
    </section>
  );
}

function ArtifactSectionFrame({
  sectionRef,
  content,
  header,
  body,
  collection,
  dialog,
  isCollection,
  headerAction,
}: ArtifactFrameProps & {
  isCollection: boolean;
  headerAction: ReactElement | null;
}): ReactElement {
  const count = collection.data?.artifacts.length ?? 0;
  return (
    <>
      <CollapsibleCard
        title="Artifacts"
        icon={<Files className="size-3.5" aria-hidden="true" />}
        summary={count > 0 ? String(count) : null}
        headerAction={headerAction}
      >
        <section ref={sectionRef} aria-label="Task artifacts" className="flex flex-col gap-2">
          {isCollection ? (
            <div className="-mx-2">{body}</div>
          ) : (
            <div
              className={cn(
                "flex flex-col overflow-hidden rounded-lg border border-border",
                content && "h-[min(60dvh,36rem)] min-h-64",
              )}
            >
              {content ?? (
                <>
                  {header}
                  <div className="p-3">{body}</div>
                </>
              )}
            </div>
          )}
          <CollectionNotice collection={collection} />
        </section>
      </CollapsibleCard>
      {dialog}
    </>
  );
}

function AddArtifactButton({
  size,
  onAction,
}: {
  size: "xs" | "sm";
  onAction: (action: ArtifactAction, trigger: HTMLElement) => void;
}): ReactElement {
  return (
    <Button
      variant="ghost"
      size={size}
      onClick={(event) => onAction({ kind: "create" }, event.currentTarget)}
    >
      <Plus aria-hidden="true" />
      Add artifact
    </Button>
  );
}

function CollectionHeader({
  selection,
  canManage,
  onBack,
  onAction,
}: {
  selection: ArtifactSelection;
  canManage: boolean;
  onBack: () => void;
  onAction: (action: ArtifactAction, trigger: HTMLElement) => void;
}): ReactElement {
  const hasSelection = selection.kind !== "collection";
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
      {hasSelection ? <BackButton onClick={onBack} /> : null}
      <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{selectionTitle(selection)}</h2>
      {canManage && !hasSelection ? <AddArtifactButton size="sm" onAction={onAction} /> : null}
    </div>
  );
}

function CollectionNotice({
  collection,
  className,
}: {
  collection: UseQueryResult<TaskArtifactCollection>;
  className?: string;
}): ReactElement | null {
  if (collection.error)
    return (
      <div
        role="alert"
        className={cn("flex shrink-0 items-center gap-2 text-xs text-destructive", className)}
      >
        <p className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          Cannot load artifacts. {collection.error.message}
        </p>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            void collection.refetch();
          }}
        >
          Retry
        </Button>
      </div>
    );
  if (collection.data && !collection.data.canManageFree)
    return (
      <p
        className={cn("flex shrink-0 items-center gap-2 text-xs text-muted-foreground", className)}
      >
        <Lock className="size-3" aria-hidden="true" />
        This task is closed. Free artifacts are read-only.
      </p>
    );
  return null;
}

function CollectionBody({
  collection,
  selection,
  layout,
  onSelect,
}: {
  collection: UseQueryResult<TaskArtifactCollection>;
  selection: ArtifactSelection;
  layout: NonNullable<TaskArtifactsProps["layout"]>;
  onSelect: (id: string) => void;
}): ReactElement | null {
  if (collection.isPending) return <CollectionLoading />;
  if (selection.kind !== "collection")
    return collection.isSuccess ? <UnavailableSelection selection={selection} /> : null;
  if (!collection.data) return null;
  if (collection.data.artifacts.length === 0 && collection.isSuccess) {
    if (layout === "section")
      return (
        <p className="mx-2 rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
          No artifacts yet.
        </p>
      );
    return (
      <div className="flex flex-col items-center gap-3 px-5 py-12 text-center">
        <Files className="size-7 text-muted-foreground" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">No artifacts yet</p>
          <p className="max-w-64 text-xs leading-relaxed text-muted-foreground">
            Keep files and workflow outputs together for this task.
          </p>
        </div>
      </div>
    );
  }
  return (
    <ArtifactList
      artifacts={collection.data.artifacts}
      compact={layout === "section"}
      onSelect={onSelect}
    />
  );
}

function UnavailableSelection({ selection }: { selection: ArtifactSelection }): ReactElement {
  return (
    <p role="status" className="py-3 text-sm text-muted-foreground">
      {selection.kind === "workflow"
        ? `${workflowNames[selection.workflowKind]} has not been created yet.`
        : "This artifact is no longer available. Return to All artifacts to select another item."}
    </p>
  );
}

function ArtifactList({
  artifacts,
  compact,
  onSelect,
}: {
  artifacts: TaskArtifact[];
  compact: boolean;
  onSelect: (id: string) => void;
}): ReactElement {
  const workflowOrder = { spec: 0, plan: 1, qaReport: 2 };
  const groups = [
    {
      name: "Workflow",
      items: artifacts
        .filter((item) => item.classification === "workflow")
        .toSorted((a, b) => workflowOrder[a.workflowKind] - workflowOrder[b.workflowKind]),
    },
    {
      name: "Files",
      items: artifacts
        .filter((item) => item.classification === "free")
        .toSorted((a, b) => a.name.localeCompare(b.name)),
    },
  ];
  return (
    <div className={cn("flex flex-col", compact ? "gap-2" : "gap-5")}>
      {groups.map(({ name, items }) => {
        if (items.length === 0) return null;
        return (
          <div key={name} className="flex flex-col gap-1">
            <h3
              className={cn("px-2 text-xs font-medium text-muted-foreground", !compact && "pb-1")}
            >
              {name}
            </h3>
            <ul className="flex flex-col gap-0.5">
              {items.map((artifact) => (
                <li key={artifact.artifactId}>
                  <Button
                    variant="ghost"
                    data-artifact-id={artifact.artifactId}
                    className={cn(
                      "h-auto w-full min-w-0 justify-start gap-3 px-2 text-left",
                      compact ? "py-1.5" : "py-2.5",
                    )}
                    onClick={() => onSelect(artifact.artifactId)}
                  >
                    <ArtifactIcon artifact={artifact} />
                    <span
                      className={cn("flex min-w-0 flex-1 flex-col", compact ? "gap-0.5" : "gap-1")}
                    >
                      <span className="truncate text-sm font-medium">{artifact.name}</span>
                      <ArtifactMetadata artifact={artifact} />
                    </span>
                    <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

type ArtifactContentProps = Omit<TaskArtifactsProps, "artifactSummary"> & {
  artifactId: string;
  title: string;
  artifact: TaskArtifact | undefined;
  workflowKind: WorkflowTaskArtifact["workflowKind"] | undefined;
  canManage: boolean;
  onBack: () => void;
  onAction: (action: ArtifactAction, trigger: HTMLElement) => void;
};

const ArtifactContent = memo(function ArtifactContent(props: ArtifactContentProps): ReactElement {
  const kind =
    props.artifact?.classification === "workflow"
      ? props.artifact.workflowKind
      : props.workflowKind;
  if (kind) return <WorkflowArtifactContent {...props} workflowKind={kind} />;
  return <FreeArtifactContent {...props} />;
});

function FreeArtifactContent({
  repoPath,
  taskId,
  artifactId,
  title,
  artifact,
  canManage,
  onBack,
  onAction,
}: ArtifactContentProps): ReactElement {
  const queryClient = useQueryClient();
  const content = useQuery(
    taskArtifactContentQueryOptions(queryClient, repoPath, taskId, artifactId),
  );
  const data = content.error ? undefined : content.data;
  const metadata = artifact ?? data?.artifact;
  const name = metadata?.name ?? title;
  const isCurrent = Boolean(data && (!artifact || data.artifact.revision === artifact.revision));
  return (
    <ArtifactContentView
      name={name}
      onBack={onBack}
      error={content.error?.message ?? null}
      onRetry={() => void content.refetch()}
      isCurrent={isCurrent}
      controls={
        metadata?.classification === "free" ? (
          <FreeArtifactControls
            artifact={metadata}
            content={data}
            canManage={canManage}
            onAction={onAction}
          />
        ) : null
      }
      footer={
        <ArtifactContentFooter artifact={metadata} isUpdating={Boolean(data && !isCurrent)} />
      }
    >
      {data ? <TaskArtifactPreview artifact={data.artifact} bytes={data.bytes} /> : null}
    </ArtifactContentView>
  );
}

function WorkflowArtifactContent({
  repoPath,
  taskId,
  workspaceId,
  title,
  artifact,
  workflowKind,
  onBack,
}: ArtifactContentProps & { workflowKind: WorkflowTaskArtifact["workflowKind"] }): ReactElement {
  const queryClient = useQueryClient();
  const content = useQuery(
    taskDocumentQueryOptions(
      queryClient,
      repoPath,
      taskId,
      workflowKind === "qaReport" ? "qa" : workflowKind,
    ),
  );
  const error = content.error?.message ?? content.data?.error ?? null;
  const data = error ? undefined : content.data;
  const isAbsent = data?.markdown === "" && data.updatedAt === null;
  const name = artifact?.name ?? title;
  const isCurrent = Boolean(data && !content.isFetching);
  const taskAssetContext = useMemo<Omit<TaskAssetRenderContext, "assetId"> | undefined>(
    () => (workspaceId ? { workspaceId, taskId, scope: "description" } : undefined),
    [workspaceId, taskId],
  );
  const previewArtifact = useMemo(
    () => ({
      taskId,
      artifactId: workflowArtifactId(taskId, workflowKind),
      name,
      mediaType: "text/markdown",
    }),
    [taskId, workflowKind, name],
  );
  let preview: ReactElement | null = null;
  if (data) {
    if (isAbsent) {
      preview = (
        <p role="status" className="p-4 text-sm text-muted-foreground">
          {workflowNames[workflowKind]} has not been created yet.
        </p>
      );
    } else {
      preview = (
        <TaskArtifactPreview
          artifact={previewArtifact}
          markdown={data.markdown}
          {...(taskAssetContext ? { markdownAssetContext: taskAssetContext } : {})}
        />
      );
    }
  }
  return (
    <ArtifactContentView
      name={name}
      onBack={onBack}
      error={error}
      onRetry={() => void content.refetch()}
      isCurrent={isCurrent}
      controls={
        <WorkflowArtifactControls
          taskId={taskId}
          workflowKind={workflowKind}
          name={name}
          markdown={isAbsent ? undefined : data?.markdown}
          taskAssetContext={taskAssetContext}
        />
      }
      footer={
        <ArtifactContentFooter artifact={artifact} isUpdating={Boolean(data && !isCurrent)} />
      }
    >
      {preview}
    </ArtifactContentView>
  );
}

function ArtifactContentView({
  name,
  onBack,
  controls,
  footer,
  error,
  onRetry,
  isCurrent,
  children,
}: {
  name: string;
  onBack: () => void;
  controls: ReactNode;
  footer: ReactNode;
  error: string | null;
  onRetry: () => void;
  isCurrent: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <BackButton onClick={onBack} />
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{name}</h2>
        <div className="flex shrink-0 items-center gap-1">{controls}</div>
      </div>
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        aria-busy={!error && !isCurrent}
      >
        {error ? (
          <div
            role="alert"
            className="flex min-h-0 flex-1 flex-col items-start gap-3 overflow-auto p-4 text-sm"
          >
            <p className="text-destructive [overflow-wrap:anywhere]">
              Cannot read "{name}". {error}
            </p>
            <Button variant="outline" size="sm" onClick={onRetry}>
              Retry read
            </Button>
          </div>
        ) : null}
        {!children && !error ? (
          <p role="status" className="p-4 text-sm text-muted-foreground">
            Loading artifact...
          </p>
        ) : null}
        {children}
      </div>
      {footer}
    </div>
  );
}

function ArtifactContentFooter({
  artifact,
  isUpdating,
}: {
  artifact: TaskArtifact | undefined;
  isUpdating: boolean;
}): ReactElement {
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-3 py-2">
      {artifact?.classification === "free" ? (
        <span
          className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
          title={artifact.fileName}
        >
          {artifact.fileName}
        </span>
      ) : null}
      {isUpdating ? (
        <span role="status" className="shrink-0 text-xs text-muted-foreground">
          Updating preview...
        </span>
      ) : null}
      {artifact && !isUpdating ? <ArtifactMetadata artifact={artifact} /> : null}
    </div>
  );
}

const workflowNames = { spec: "Specification", plan: "Implementation Plan", qaReport: "QA Report" };

function resolveSelection(
  artifacts: TaskArtifact[] | undefined,
  selection: ArtifactSelection,
  taskId: string,
  summary: TaskArtifactsProps["artifactSummary"],
) {
  const artifact = findArtifact(artifacts, selection);
  if (selection.kind === "workflow" && summary) {
    const exists = summary[selection.workflowKind].has;
    return {
      artifact,
      artifactId: exists ? workflowArtifactId(taskId, selection.workflowKind) : undefined,
      isAbsentWorkflow: !exists,
    };
  }
  return { artifact, artifactId: artifact?.artifactId, isAbsentWorkflow: false };
}

function findArtifact(
  artifacts: TaskArtifact[] | undefined,
  selection: ArtifactSelection,
): TaskArtifact | undefined {
  switch (selection.kind) {
    case "collection":
      return undefined;
    case "artifact":
      return artifacts?.find((item) => item.artifactId === selection.artifactId);
    case "workflow":
      return artifacts?.find(
        (item) =>
          item.classification === "workflow" && item.workflowKind === selection.workflowKind,
      );
  }
}

function selectionTitle(selection: ArtifactSelection): string {
  switch (selection.kind) {
    case "collection":
      return "Artifacts";
    case "artifact":
      return "Artifact unavailable";
    case "workflow":
      return workflowNames[selection.workflowKind];
  }
}

function BackButton({ onClick }: { onClick: () => void }): ReactElement {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-7 shrink-0"
      aria-label="All artifacts"
      onClick={onClick}
    >
      <ArrowLeft aria-hidden="true" />
    </Button>
  );
}

const formats = new Map([
  ["text/markdown", "Markdown"],
  ["text/plain", "Text"],
  ["text/html", "HTML"],
  ["image/png", "PNG"],
  ["image/jpeg", "JPEG"],
  ["image/webp", "WebP"],
  ["image/gif", "GIF"],
  ["image/svg+xml", "SVG"],
  ["application/pdf", "PDF"],
]);
const verdictVariants = {
  approved: "success",
  rejected: "danger",
  not_reviewed: "secondary",
} as const;

function ArtifactMetadata({ artifact }: { artifact: TaskArtifact }): ReactElement {
  const now = useMinuteClock();
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs font-normal text-muted-foreground">
      <span title={artifact.mediaType}>
        {formats.get(artifact.mediaType.toLowerCase()) ?? "File"}
      </span>
      {artifact.classification === "free" ? <span>{formatFileSize(artifact.byteSize)}</span> : null}
      {artifact.updatedAt ? (
        <time dateTime={artifact.updatedAt} title={humanDate(artifact.updatedAt)}>
          {formatElapsedAgo(now - Date.parse(artifact.updatedAt))}
        </time>
      ) : null}
      {artifact.classification === "workflow" && artifact.verdict ? (
        <Badge variant={verdictVariants[artifact.verdict]}>
          {artifact.verdict.replaceAll("_", " ")}
        </Badge>
      ) : null}
    </span>
  );
}

function ArtifactIcon({ artifact }: { artifact: TaskArtifact }): ReactElement {
  const mediaType = artifact.mediaType.toLowerCase();
  if (mediaType.startsWith("image/"))
    return <FileImage className="size-4 text-muted-foreground" aria-hidden="true" />;
  if (["text/html", "application/json"].includes(mediaType))
    return <FileCode2 className="size-4 text-muted-foreground" aria-hidden="true" />;
  return <FileText className="size-4 text-muted-foreground" aria-hidden="true" />;
}

function CollectionLoading(): ReactElement {
  return (
    <div role="status" aria-label="Loading artifacts" className="flex flex-col gap-3 p-2">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-center gap-3">
          <Skeleton className="size-8" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-2.5 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
