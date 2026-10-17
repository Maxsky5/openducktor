import type { AgentAttachmentReference } from "@openducktor/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";
import { resolveLocalAttachmentPreview } from "@/lib/local-attachment-files";
import { useResourceSource } from "@/lib/use-resource-source";
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

type FileSource = { file: File; src: string };
type PreviewFailure = { id: string; src: string | null; message: string };

export const useAgentChatAttachmentPreview = ({
  attachment,
  externalError,
}: {
  attachment: AgentChatAttachmentPreviewTarget;
  externalError?: string | null;
}): AgentChatAttachmentPreviewState => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [fileSource, setFileSource] = useState<FileSource | null>(null);
  const [failure, setFailure] = useState<PreviewFailure | null>(null);
  const previewable =
    isPreviewableAttachmentKind(attachment.kind) && attachment.localPreviewAvailable !== false;
  const resource = useResourceSource(
    ["attachment-preview", attachment.path ?? ""],
    previewable && !attachment.file && attachment.path
      ? (signal) => resolveLocalAttachmentPreview(attachment.path!, signal)
      : undefined,
  );
  useEffect(() => {
    if (!attachment.file || !previewable) {
      setFileSource(null);
      return;
    }
    const file = attachment.file;
    const src = URL.createObjectURL(file);
    setFileSource({ file, src });
    return () => URL.revokeObjectURL(src);
  }, [attachment.file, previewable]);

  const { src: resolvedPreviewSrc, error: previewError } = previewSource(
    attachment,
    fileSource,
    resource,
    failure,
  );
  const latestPreviewSrc = useRef<string | null>(null);
  useEffect(() => {
    latestPreviewSrc.current = resolvedPreviewSrc;
  }, [resolvedPreviewSrc]);
  const markPreviewUnavailable = useCallback(
    (failingSrc?: string) => {
      if (failingSrc && latestPreviewSrc.current && failingSrc !== latestPreviewSrc.current) return;
      setFailure({
        id: attachment.id,
        src: latestPreviewSrc.current,
        message: readAttachmentPreviewLoadFailureMessage(attachment.name),
      });
      setDialogOpen(false);
    },
    [attachment.id, attachment.name],
  );
  const isResolvingPreview =
    previewable && (attachment.file ? resolvedPreviewSrc === null : resource.isLoading);
  const showResolvedPreview = Boolean(resolvedPreviewSrc) && !previewError;
  const requestPreviewOpen = useCallback((): string | null => {
    if (isResolvingPreview) return null;
    if (showResolvedPreview) {
      setDialogOpen(true);
      return null;
    }
    return (
      previewError ??
      "The attachment preview is not available because the local file could not be resolved."
    );
  }, [isResolvingPreview, showResolvedPreview, previewError]);
  return {
    dialogOpen,
    setDialogOpen,
    resolvedPreviewSrc: previewError ? null : resolvedPreviewSrc,
    previewError,
    effectiveError: externalError ?? previewError,
    isResolvingPreview,
    previewable,
    showResolvedPreview,
    requestPreviewOpen,
    markPreviewUnavailable,
  };
};

export const readAttachmentPreviewLoadFailureMessage = (attachmentName: string): string =>
  `Attachment preview is unavailable because "${attachmentName}" could not be read from its original local path.`;

function previewSource(
  attachment: AgentChatAttachmentPreviewTarget,
  fileSource: FileSource | null,
  resource: Pick<ReturnType<typeof useResourceSource>, "src" | "error">,
  failure: PreviewFailure | null,
) {
  const previewable =
    isPreviewableAttachmentKind(attachment.kind) && attachment.localPreviewAvailable !== false;
  let src = resource.src;
  if (!previewable) src = null;
  else if (attachment.file) src = fileSource?.file === attachment.file ? fileSource.src : null;
  let error = resource.error ? errorMessage(resource.error) : null;
  if (previewable && !attachment.file && !attachment.path)
    error = "Attachment preview is unavailable because the local file path is missing.";
  if (failure?.id === attachment.id && failure.src === src) error = failure.message;
  return { src, error };
}
