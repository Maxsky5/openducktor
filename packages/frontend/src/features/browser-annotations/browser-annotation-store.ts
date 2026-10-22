import type { BrowserAnnotationCapture } from "@openducktor/contracts";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { createStore, type StoreApi, useStore } from "zustand";
import {
  lockPendingItems,
  restorePendingItem,
  settlePendingItems,
} from "@openducktor/frontend-core/drafts/pending-send-batch";
import { toInlineCommentDraftOwnerKey } from "@openducktor/frontend-core/drafts/inline-comment-draft-store";
import { perConnection } from "@/lib/per-connection";
import type { BrowserAnnotationOwner, BrowserAnnotationStatus } from "./browser-annotation-types";

/** A pending annotation. It stays in memory until a send, a removal, or an app reload. */
export type BrowserAnnotation = {
  id: string;
  number: number;
  comment: string;
  /** False keeps the screenshot out of the message, for example for a model without images. */
  includeScreenshot: boolean;
  page: BrowserAnnotationCapture["page"];
  selectedText: BrowserAnnotationCapture["selectedText"];
  elements: BrowserAnnotationCapture["elements"];
  image: BrowserAnnotationCapture["image"];
  revision: number;
  submissionId: string | null;
  status: BrowserAnnotationStatus;
};

export type BrowserAnnotationSnapshot = Pick<BrowserAnnotation, "id" | "revision">;

export type AddBrowserAnnotationInput = {
  capture: BrowserAnnotationCapture;
  comment: string;
  includeScreenshot: boolean;
};

export type BrowserAnnotationChanges = {
  comment: string;
  includeScreenshot: boolean;
};

export type BrowserAnnotationStore = {
  annotationsByOwner: Record<string, BrowserAnnotation[]>;
  /** Saves a captured selection as the next numbered pending annotation of the owner. */
  addAnnotation: (ownerKey: string, input: AddBrowserAnnotationInput) => BrowserAnnotation;
  updateAnnotation: (ownerKey: string, id: string, changes: BrowserAnnotationChanges) => void;
  removeAnnotation: (ownerKey: string, id: string) => void;
  /** Removes all annotations of an owner that no longer exists. */
  removeOwner: (owner: BrowserAnnotationOwner) => void;
  getPendingAnnotations: (ownerKey: string) => BrowserAnnotation[];
  beginSubmittingAnnotations: (
    ownerKey: string,
    snapshots: BrowserAnnotationSnapshot[],
  ) => string | null;
  restoreSubmittingAnnotations: (submissionId: string) => void;
  completeSubmittingAnnotations: (submissionId: string) => void;
};

/** Creates the pending annotations of one host connection. They stay in memory. */
const createBrowserAnnotationStore = (): StoreApi<BrowserAnnotationStore> => {
  let nextId = 0;
  let nextRevision = 0;
  let nextSubmissionId = 0;
  const generateId = (): string => `annotation-${Date.now()}-${++nextId}`;
  const generateRevision = (): number => ++nextRevision;
  const generateSubmissionId = (): string =>
    `annotation-submission-${Date.now()}-${++nextSubmissionId}`;

  return createStore<BrowserAnnotationStore>()((set, get) => {
    const readOwnerAnnotations = (ownerKey: string): BrowserAnnotation[] =>
      get().annotationsByOwner[ownerKey] ?? EMPTY_ANNOTATIONS;

    const setOwnerAnnotations = (ownerKey: string, annotations: BrowserAnnotation[]): void => {
      set((state) => ({
        annotationsByOwner: { ...state.annotationsByOwner, [ownerKey]: annotations },
      }));
    };

    const requireEditable = (ownerKey: string, id: string, action: "edit" | "remove"): void => {
      const annotation = readOwnerAnnotations(ownerKey).find((candidate) => candidate.id === id);
      if (annotation?.status === "submitting") {
        throw new Error(`Cannot ${action} a browser annotation while it is being sent.`);
      }
    };

    /** Applies `settle` to each annotation of the submission. A null result removes the annotation. */
    const settleSubmission = (
      submissionId: string,
      settle: (annotation: BrowserAnnotation) => BrowserAnnotation | null,
    ): void => {
      const settled = settlePendingItems(get().annotationsByOwner, submissionId, settle);
      if (settled) set({ annotationsByOwner: settled.itemsByOwner });
    };

    return {
      annotationsByOwner: {},

      addAnnotation: (ownerKey, { capture, comment, includeScreenshot }) => {
        const text = requireComment(comment);
        const current = readOwnerAnnotations(ownerKey);
        const annotation: BrowserAnnotation = {
          id: generateId(),
          number: current.reduce((max, entry) => Math.max(max, entry.number), 0) + 1,
          comment: text,
          includeScreenshot,
          page: { url: capture.page.url, title: capture.page.title },
          selectedText: capture.selectedText,
          elements: capture.elements,
          image: capture.image,
          revision: generateRevision(),
          submissionId: null,
          status: "pending",
        };
        setOwnerAnnotations(ownerKey, [...current, annotation]);
        return annotation;
      },

      updateAnnotation: (ownerKey, id, changes) => {
        const comment = requireComment(changes.comment);
        requireEditable(ownerKey, id, "edit");
        setOwnerAnnotations(
          ownerKey,
          readOwnerAnnotations(ownerKey).map((annotation) =>
            annotation.id === id && annotation.status === "pending"
              ? {
                  ...annotation,
                  comment,
                  includeScreenshot: changes.includeScreenshot,
                  revision: generateRevision(),
                  submissionId: null,
                }
              : annotation,
          ),
        );
      },

      removeAnnotation: (ownerKey, id) => {
        requireEditable(ownerKey, id, "remove");
        setOwnerAnnotations(
          ownerKey,
          readOwnerAnnotations(ownerKey).filter((annotation) => annotation.id !== id),
        );
      },

      removeOwner: (owner) => {
        const ownerKey = toBrowserAnnotationOwnerKey(owner);
        if (ownerKey === null) return;
        set((state) => {
          const annotationsByOwner = { ...state.annotationsByOwner };
          delete annotationsByOwner[ownerKey];
          return { annotationsByOwner };
        });
      },

      getPendingAnnotations: (ownerKey) =>
        readOwnerAnnotations(ownerKey).filter((annotation) => annotation.status === "pending"),

      beginSubmittingAnnotations: (ownerKey, snapshots) => {
        const submissionId = generateSubmissionId();
        const next = lockPendingItems(readOwnerAnnotations(ownerKey), snapshots, submissionId);
        if (next === null) return null;
        setOwnerAnnotations(ownerKey, next);
        return submissionId;
      },

      restoreSubmittingAnnotations: (submissionId) => {
        settleSubmission(submissionId, restorePendingItem);
      },

      completeSubmittingAnnotations: (submissionId) => {
        settleSubmission(submissionId, () => null);
      },
    };
  });
};

/** The pending annotations of the host of a client connection. */
export const browserAnnotationStoreOf = perConnection(() => createBrowserAnnotationStore());

/** The annotation store of this host connection. */
export const useBrowserAnnotationStore = (): StoreApi<BrowserAnnotationStore> =>
  browserAnnotationStoreOf(useClientConnection());

/**
 * The annotations of an owner in number order. The list also holds the annotations of a send that
 * did not finish.
 */
export function useBrowserAnnotations(owner: BrowserAnnotationOwner | null) {
  const ownerKey = toBrowserAnnotationOwnerKey(owner);
  const annotations = useStore(useBrowserAnnotationStore(), (store) =>
    ownerKey === null
      ? EMPTY_ANNOTATIONS
      : (store.annotationsByOwner[ownerKey] ?? EMPTY_ANNOTATIONS),
  );
  return { ownerKey, annotations };
}

/**
 * Returns the store key of an owner, or null when the owner is not complete. Annotations and
 * review comments have the same owners, so they use the same keys.
 */
export const toBrowserAnnotationOwnerKey = (owner: BrowserAnnotationOwner | null): string | null =>
  toInlineCommentDraftOwnerKey(owner);

const EMPTY_ANNOTATIONS: BrowserAnnotation[] = [];

const requireComment = (comment: string): string => {
  const text = comment.trim();
  if (text.length === 0) throw new Error("Browser annotations need a comment.");
  return text;
};
