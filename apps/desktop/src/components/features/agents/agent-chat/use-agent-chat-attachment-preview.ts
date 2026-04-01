import type { AgentAttachmentReference } from "@openducktor/core";
import { useCallback, useEffect, useMemo, useState } from "react";
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

export const readAttachmentPreviewLoadFailureMessage = (attachmentName: string): string => {
  return `Attachment preview is unavailable because "${attachmentName}" could not be read from its original local path.`;
};

const readObjectPreviewUrlForAttachment = (
  attachment: AgentChatAttachmentPreviewTarget,
): string | null => {
  if (attachment.file && isPreviewableAttachmentKind(attachment.kind)) {
    return URL.createObjectURL(attachment.file);
  }
  return null;
};

export const useAgentChatAttachmentPreview = ({
  attachment,
  externalError,
}: {
  attachment: AgentChatAttachmentPreviewTarget;
  externalError?: string | null;
}) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [resolvedPreviewSrc, setResolvedPreviewSrc] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isResolvingPreview, setIsResolvingPreview] = useState(false);
  const previewable = isPreviewableAttachmentKind(attachment.kind);

  const objectPreviewUrl = useMemo(
    () => readObjectPreviewUrlForAttachment(attachment),
    [attachment],
  );

  const markPreviewUnavailable = useCallback(() => {
    setDialogOpen(false);
    setResolvedPreviewSrc(null);
    setPreviewError(readAttachmentPreviewLoadFailureMessage(attachment.name));
  }, [attachment.name]);

  useEffect(() => {
    return () => {
      if (objectPreviewUrl) {
        URL.revokeObjectURL(objectPreviewUrl);
      }
    };
  }, [objectPreviewUrl]);

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
  const canOpenPreview = previewable && Boolean(resolvedPreviewSrc) && !effectiveError;
  const showResolvedPreview = Boolean(resolvedPreviewSrc) && !previewError;

  const requestPreviewOpen = useCallback((): string | null => {
    if (canOpenPreview) {
      setDialogOpen(true);
      return null;
    }

    return (
      effectiveError ??
      "The attachment preview is not available because the local file could not be resolved."
    );
  }, [canOpenPreview, effectiveError]);

  return {
    dialogOpen,
    setDialogOpen,
    resolvedPreviewSrc,
    effectiveError,
    isResolvingPreview,
    previewable,
    showResolvedPreview,
    requestPreviewOpen,
    markPreviewUnavailable,
  };
};
