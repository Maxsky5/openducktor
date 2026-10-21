import { EyeOff, ImageIcon, Pencil, Trash2 } from "lucide-react";
import { type ReactElement, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BrowserAnnotationCommentBox } from "./browser-annotation-comment-box";
import { describeBrowserAnnotationElements } from "./browser-annotation-message";
import type { BrowserAnnotation, BrowserAnnotationChanges } from "./browser-annotation-store";

/** Number badge of an annotation. Page markers use the same look. */
export const BROWSER_ANNOTATION_NUMBER_CLASS_NAME =
  "inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-sky-300 text-[11px] font-semibold leading-none text-neutral-950";

export type BrowserAnnotationListProps = {
  annotations: readonly BrowserAnnotation[];
  /** IDs of annotations whose elements are not on the current page. */
  offPageIds: ReadonlySet<string>;
  /** Scrolls the page to the annotated element. */
  onSelect: (annotation: BrowserAnnotation) => void;
  onUpdate: (annotation: BrowserAnnotation, changes: BrowserAnnotationChanges) => void;
  onRemove: (annotation: BrowserAnnotation) => void;
};

/** Pending annotations of a task or Workspace Session, in number order. */
export function BrowserAnnotationList({
  annotations,
  offPageIds,
  onSelect,
  onUpdate,
  onRemove,
}: BrowserAnnotationListProps): ReactElement {
  const [editingId, setEditingId] = useState<string | null>(null);

  if (annotations.length === 0) {
    return (
      <p className="px-3 py-4 text-sm text-muted-foreground">
        No pending annotations. Turn on Annotate and click an element on the page.
      </p>
    );
  }

  return (
    <ul aria-label="Pending annotations" className="flex flex-col gap-2 p-2">
      {annotations.map((annotation) => (
        <BrowserAnnotationListItem
          key={annotation.id}
          annotation={annotation}
          isEditing={editingId === annotation.id}
          isOffPage={offPageIds.has(annotation.id)}
          onSelect={onSelect}
          onStartEditing={() => setEditingId(annotation.id)}
          onStopEditing={() => setEditingId(null)}
          onUpdate={onUpdate}
          onRemove={onRemove}
        />
      ))}
    </ul>
  );
}

function BrowserAnnotationListItem({
  annotation,
  isEditing,
  isOffPage,
  onSelect,
  onStartEditing,
  onStopEditing,
  onUpdate,
  onRemove,
}: {
  annotation: BrowserAnnotation;
  isEditing: boolean;
  isOffPage: boolean;
  onSelect: BrowserAnnotationListProps["onSelect"];
  onStartEditing: () => void;
  onStopEditing: () => void;
  onUpdate: BrowserAnnotationListProps["onUpdate"];
  onRemove: BrowserAnnotationListProps["onRemove"];
}): ReactElement {
  const isSubmitting = annotation.status === "submitting";
  const elementLabel = describeBrowserAnnotationElements(annotation.elements);
  const sendsScreenshot = annotation.includeScreenshot && annotation.image !== null;
  const pageLabel = annotation.page.title.trim() || annotation.page.url;

  return (
    <li
      className="rounded-lg border border-border bg-card p-2"
      data-annotation-id={annotation.id}
      data-testid="browser-annotation-list-item"
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-label={`Show annotation ${annotation.number} on the page`}
          className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 rounded-md p-1 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-default disabled:hover:bg-transparent"
          disabled={isOffPage}
          onClick={() => onSelect(annotation)}
        >
          <span className={BROWSER_ANNOTATION_NUMBER_CLASS_NAME}>{annotation.number}</span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-foreground">
              {annotation.comment}
            </span>
            <span className="truncate text-[11px] text-muted-foreground" title={elementLabel}>
              {elementLabel}
            </span>
            <span
              className="truncate text-[11px] text-muted-foreground"
              title={annotation.page.url}
            >
              {pageLabel}
            </span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={`Edit annotation ${annotation.number}`}
            title="Edit"
            disabled={isSubmitting || isEditing}
            onClick={onStartEditing}
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="destructiveGhost"
            size="icon"
            className="size-7"
            aria-label={`Remove annotation ${annotation.number}`}
            title="Remove"
            disabled={isSubmitting}
            onClick={() => onRemove(annotation)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
      {sendsScreenshot || isSubmitting || isOffPage ? (
        <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-8">
          {sendsScreenshot ? (
            <Badge variant="outline" className="gap-1 px-2 py-0 text-[10px]">
              <ImageIcon className="size-3" />
              Screenshot
            </Badge>
          ) : null}
          {isSubmitting ? (
            <Badge variant="outline" className="px-2 py-0 text-[10px]">
              Sending
            </Badge>
          ) : null}
          {isOffPage ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <EyeOff className="size-3" />
              Not on this page
            </span>
          ) : null}
        </div>
      ) : null}
      {isEditing ? (
        <BrowserAnnotationCommentBox
          className="mt-2 w-full shadow-none"
          mode="edit"
          targetLabel={elementLabel}
          initialComment={annotation.comment}
          initialIncludeScreenshot={annotation.includeScreenshot}
          onCancel={onStopEditing}
          onSave={(changes) => {
            onUpdate(annotation, changes);
            onStopEditing();
          }}
        />
      ) : null}
    </li>
  );
}
