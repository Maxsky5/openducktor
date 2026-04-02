import type { AgentAttachmentReference } from "@openducktor/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { resolveLocalAttachmentPreviewSrc } from "@/lib/local-attachment-files";
import { isPreviewableAttachmentKind } from "./agent-chat-attachments";

export type AgentChatAttachmentPreviewTarget = {
  id: string;
  name: string;
  kind: AgentAttachmentReference["kind"];
  mime?: string;
  path?: string;
  file?: File;
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

export const useAgentChatAttachmentPreview = ({
  attachment,
  externalError,
}: {
  attachment: AgentChatAttachmentPreviewTarget;
  externalError?: string | null;
}): AgentChatAttachmentPreviewState => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [resolvedPreviewSrc, setResolvedPreviewSrc] = useState<string | null>(null);
  const [objectPreviewUrl, setObjectPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isResolvingPreview, setIsResolvingPreview] = useState(false);
  const previewable = isPreviewableAttachmentKind(attachment.kind);
  const latestPreviewSrcRef = useRef<string | null>(null);

  useEffect(() => {
    if (!attachment.file || !previewable) {
      setObjectPreviewUrl(null);
      return;
    }

    const nextUrl = URL.createObjectURL(attachment.file);
    setObjectPreviewUrl(nextUrl);
    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [attachment.file, previewable]);

  latestPreviewSrcRef.current = resolvedPreviewSrc ?? objectPreviewUrl;

  const markPreviewUnavailable: (failingSrc?: string) => void = useCallback(
    (failingSrc?: string) => {
      if (failingSrc && latestPreviewSrcRef.current && failingSrc !== latestPreviewSrcRef.current) {
        return;
      }
      setDialogOpen(false);
      setResolvedPreviewSrc(null);
      setPreviewError(readAttachmentPreviewLoadFailureMessage(attachment.name));
    },
    [attachment.name],
  );

  useEffect(() => {
    let cancelled = false;
    if (!previewable || objectPreviewUrl) {
      setResolvedPreviewSrc(objectPreviewUrl ?? null);
      setPreviewError(null);
      setIsResolvingPreview(false);
      return;
    }
    if (!attachment.path) {
      setResolvedPreviewSrc(null);
      setPreviewError("Attachment preview is unavailable because the local file path is missing.");
      setIsResolvingPreview(false);
      return;
    }

    setIsResolvingPreview(true);
    setPreviewError(null);
    void resolveLocalAttachmentPreviewSrc(attachment.path)
      .then((src) => {
        if (cancelled) {
          return;
        }
        setResolvedPreviewSrc(src);
      })
      .catch((resolveError) => {
        if (cancelled) {
          return;
        }
        setResolvedPreviewSrc(null);
        setPreviewError(
          resolveError instanceof Error ? resolveError.message : String(resolveError),
        );
      })
      .finally(() => {
        if (!cancelled) {
          setIsResolvingPreview(false);
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
    if (canOpenPreview) {
      setDialogOpen(true);
      return null;
    }

    return (
      previewError ??
      "The attachment preview is not available because the local file could not be resolved."
    );
  }, [canOpenPreview, previewError]);

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
