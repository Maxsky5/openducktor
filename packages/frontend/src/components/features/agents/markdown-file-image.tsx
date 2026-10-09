import { normalizePathSeparators, resolveAgainstWorkingDirectory } from "@openducktor/path-support";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { MarkdownImageProps } from "../task-description-editor/task-description-image-context";
import { errorMessage } from "@/lib/errors";
import {
  resolvedPathQueryOptions,
  workspaceImageFileQueryOptions,
} from "@/state/queries/filesystem";
import { parseChatFileLink, resolveChatFileLink } from "./agent-chat/agent-chat-file-link";
import type { TaskExecutionSelectedFile } from "./task-execution-file-explorer-model";

export function MarkdownFileImage({
  file,
  ...image
}: MarkdownImageProps & { file: TaskExecutionSelectedFile }) {
  const destination = parseChatFileLink(image.src);
  if (destination.kind !== "path") {
    return (
      <ImageState
        message={
          destination.kind === "invalid"
            ? destination.message
            : "The image path does not name a local file."
        }
      />
    );
  }
  const filePath = normalizePathSeparators(
    resolveAgainstWorkingDirectory(file.rootPath, file.relativePath),
  );
  const directory = filePath.slice(0, filePath.lastIndexOf("/") + 1);
  const path = resolveAgainstWorkingDirectory(directory, destination.path);
  return <LocalImage key={path} path={path} image={image} />;
}

function LocalImage({ path, image }: { path: string; image: MarkdownImageProps }) {
  const resolved = useQuery(resolvedPathQueryOptions(path));
  if (resolved.isError) return <ImageState message={errorMessage(resolved.error)} />;
  if (resolved.isPending) return <ImageState message="Loading image..." />;
  if (resolved.data === null) return <ImageState message={`Image file does not exist: ${path}`} />;
  const link = resolveChatFileLink({ kind: "path", path: resolved.data, absolute: true }, null);
  if (link.kind !== "file")
    return <ImageState message="The image path does not name a local file." />;
  return <ReadImage key={resolved.data} file={link.file} image={image} />;
}

function ReadImage({
  file,
  image,
}: {
  file: TaskExecutionSelectedFile;
  image: MarkdownImageProps;
}) {
  const result = useQuery(
    workspaceImageFileQueryOptions(file.rootPath, file.relativePath, file.access),
  );
  const [failedSource, setFailedSource] = useState<string | null>(null);
  if (result.isError) return <ImageState message={errorMessage(result.error)} />;
  if (result.isPending) return <ImageState message="Loading image..." />;
  if (result.data.kind !== "image")
    return (
      <ImageState
        message={
          result.data.kind === "unsupported"
            ? result.data.message
            : "The linked file is not a supported image."
        }
      />
    );
  const src = `data:${result.data.mime};base64,${result.data.base64}`;
  if (failedSource === src)
    return (
      <ImageState message="The image could not be displayed. Check that the file is a supported image." />
    );
  return <img {...image} src={src} onError={() => setFailedSource(src)} />;
}

function ImageState({ message }: { message: string }) {
  return (
    <div
      className="flex min-h-24 items-center justify-center rounded bg-muted/40 px-3 text-sm text-muted-foreground"
      role="status"
    >
      {message}
    </div>
  );
}
