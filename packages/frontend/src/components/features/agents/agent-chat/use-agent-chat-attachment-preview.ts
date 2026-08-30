import type { AgentAttachmentReference } from "@openducktor/core";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { resolveLocalAttachmentPreviewSrc } from "@/lib/local-attachment-files";
import { isPreviewableAttachmentKind } from "./agent-chat-attachments";

export type AgentChatAttachmentPreviewTarget = {
  id: string;
  name: string;
  kind: AgentAttachmentReference["kind"];
  mime?: string;
  path?: string;
  file?: File;
  localPreviewAvailable?: boolean;
};

export type AgentChatAttachmentPreviewState = {
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  resolvedPreviewSrc: string | null;
  previewError: string | null;
  effectiveError: string | null;
  isResolvingPreview: boolean;
  previewable: boolean;
  showResolvedPreview: boolean;
  requestPreviewOpen: () => string | null;
  markPreviewUnavailable: (failingSrc?: string) => void;
};

export const readAttachmentPreviewLoadFailureMessage = (attachmentName: string): string => {
  return `Attachment preview is unavailable because "${attachmentName}" could not be read from its original local path.`;
};

type AttachmentPreviewReducerState = {
  dialogOpen: boolean;
  resolvedPreviewSrc: string | null;
  objectPreviewUrl: string | null;
  previewError: string | null;
  isResolvingPreview: boolean;
};

type AttachmentPreviewAction =
  | { type: "dialogChanged"; open: boolean }
  | { type: "objectPreviewChanged"; url: string | null }
  | { type: "previewUnavailable"; error: string }
  | { type: "previewResolvedFromObject"; url: string | null }
  | { type: "previewMissingPath" }
  | { type: "previewResolveStarted" }
  | { type: "previewResolveSucceeded"; src: string }
  | { type: "previewResolveFailed"; error: string }
  | { type: "previewResolveFinished" };

const attachmentPreviewReducer = (
  state: AttachmentPreviewReducerState,
  action: AttachmentPreviewAction,
): AttachmentPreviewReducerState => {
  switch (action.type) {
    case "dialogChanged":
      return { ...state, dialogOpen: action.open };
    case "objectPreviewChanged":
      return { ...state, objectPreviewUrl: action.url };
    case "previewUnavailable":
      return {
        ...state,
        dialogOpen: false,
        resolvedPreviewSrc: null,
        previewError: action.error,
      };
    case "previewResolvedFromObject":
      return {
        ...state,
        resolvedPreviewSrc: action.url,
        previewError: null,
        isResolvingPreview: false,
      };
    case "previewMissingPath":
      return {
        ...state,
        resolvedPreviewSrc: null,
        previewError: "Attachment preview is unavailable because the local file path is missing.",
        isResolvingPreview: false,
      };
    case "previewResolveStarted":
      return { ...state, isResolvingPreview: true, previewError: null };
    case "previewResolveSucceeded":
      return { ...state, resolvedPreviewSrc: action.src };
    case "previewResolveFailed":
      return { ...state, resolvedPreviewSrc: null, previewError: action.error };
    case "previewResolveFinished":
      return { ...state, isResolvingPreview: false };
  }
};

export const useAgentChatAttachmentPreview = ({
  attachment,
  externalError,
}: {
  attachment: AgentChatAttachmentPreviewTarget;
  externalError?: string | null;
}): AgentChatAttachmentPreviewState => {
  const [state, dispatch] = useReducer(attachmentPreviewReducer, {
    dialogOpen: false,
    resolvedPreviewSrc: null,
    objectPreviewUrl: null,
    previewError: null,
    isResolvingPreview: false,
  });
  const { dialogOpen, resolvedPreviewSrc, objectPreviewUrl, previewError, isResolvingPreview } =
    state;
  const previewable =
    isPreviewableAttachmentKind(attachment.kind) && attachment.localPreviewAvailable !== false;
  const latestPreviewSrcRef = useRef<string | null>(null);
  const setDialogOpen = useCallback((open: boolean): void => {
    dispatch({ type: "dialogChanged", open });
  }, []);

  useEffect(() => {
    if (!attachment.file || !previewable) {
      dispatch({ type: "objectPreviewChanged", url: null });
      return;
    }

    const nextUrl = URL.createObjectURL(attachment.file);
    dispatch({ type: "objectPreviewChanged", url: nextUrl });
    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [attachment.file, previewable]);

  useEffect(() => {
    latestPreviewSrcRef.current = resolvedPreviewSrc ?? objectPreviewUrl;
  }, [objectPreviewUrl, resolvedPreviewSrc]);

  const markPreviewUnavailable: (failingSrc?: string) => void = useCallback(
    (failingSrc?: string) => {
      if (failingSrc && latestPreviewSrcRef.current && failingSrc !== latestPreviewSrcRef.current) {
        return;
      }
      dispatch({
        type: "previewUnavailable",
        error: readAttachmentPreviewLoadFailureMessage(attachment.name),
      });
    },
    [attachment.name],
  );

  useEffect(() => {
    let cancelled = false;
    if (!previewable || objectPreviewUrl) {
      dispatch({ type: "previewResolvedFromObject", url: objectPreviewUrl ?? null });
      return;
    }
    if (!attachment.path) {
      dispatch({ type: "previewMissingPath" });
      return;
    }

    dispatch({ type: "previewResolveStarted" });
    void resolveLocalAttachmentPreviewSrc(attachment.path)
      .then((src) => {
        if (cancelled) {
          return;
        }
        dispatch({ type: "previewResolveSucceeded", src });
      })
      .catch((resolveError) => {
        if (cancelled) {
          return;
        }
        dispatch({
          type: "previewResolveFailed",
          error: resolveError instanceof Error ? resolveError.message : String(resolveError),
        });
      })
      .finally(() => {
        if (!cancelled) {
          dispatch({ type: "previewResolveFinished" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [attachment.path, objectPreviewUrl, previewable]);

  const effectiveError = externalError ?? previewError;
  const canOpenPreview = previewable && Boolean(resolvedPreviewSrc) && !previewError;
  const showResolvedPreview = Boolean(resolvedPreviewSrc) && !previewError;

  const requestPreviewOpen = useCallback((): string | null => {
    if (isResolvingPreview) {
      return null;
    }
    if (canOpenPreview) {
      dispatch({ type: "dialogChanged", open: true });
      return null;
    }

    return (
      previewError ??
      "The attachment preview is not available because the local file could not be resolved."
    );
  }, [canOpenPreview, isResolvingPreview, previewError]);

  return {
    dialogOpen,
    setDialogOpen,
    resolvedPreviewSrc,
    previewError,
    effectiveError,
    isResolvingPreview,
    previewable,
    showResolvedPreview,
    requestPreviewOpen,
    markPreviewUnavailable,
  };
};
