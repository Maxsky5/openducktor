import { parseTaskAssetUri } from "@openducktor/contracts";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { useContext, useEffect, useState } from "react";
import { z } from "zod";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/errors";
import { getShellBridge } from "@/lib/shell-bridge";
import { TaskDescriptionImageContext } from "./task-description-image-context";

type TaskDescriptionImageNodeProps = {
  node: {
    attrs: {
      src?: unknown;
      alt?: unknown;
      title?: unknown;
    };
  };
  selected: boolean;
  updateAttributes: ReactNodeViewProps["updateAttributes"];
};

export function TaskDescriptionImageNode({
  node,
  selected,
  updateAttributes,
}: TaskDescriptionImageNodeProps) {
  const { previews, renderContext } = useContext(TaskDescriptionImageContext);
  const sourceResult = z.string().safeParse(node.attrs.src);
  const altResult = z.string().safeParse(node.attrs.alt);
  const titleResult = z.string().safeParse(node.attrs.title);
  const source = sourceResult.success ? sourceResult.data : "";
  const alt = altResult.success ? altResult.data : "";
  const title = titleResult.success ? titleResult.data : undefined;
  const assetId = parseTaskAssetUri(source);
  const preview = assetId ? previews.get(assetId) : undefined;
  const workspaceId = renderContext?.workspaceId ?? null;
  const taskId = renderContext?.taskId ?? null;
  const [resolvedSource, setResolvedSource] = useState<string | null>(preview ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoadError(null);
    if (!assetId) {
      setResolvedSource(source);
      return () => {
        active = false;
      };
    }
    if (preview) {
      setResolvedSource(preview);
      return () => {
        active = false;
      };
    }
    if (!workspaceId || !taskId) {
      setResolvedSource(null);
      setLoadError("This image will be available after the task is saved.");
      return () => {
        active = false;
      };
    }
    setResolvedSource(null);
    void getShellBridge()
      .resolveTaskAssetSrc({ workspaceId, taskId, scope: "description", assetId })
      .then((nextSource) => {
        if (active) setResolvedSource(nextSource);
      })
      .catch((cause: unknown) => {
        if (active) setLoadError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, [assetId, preview, source, taskId, workspaceId]);

  return (
    <NodeViewWrapper className="my-3" data-drag-handle>
      <figure className="overflow-hidden rounded-md border border-border bg-card p-2">
        {resolvedSource ? (
          <img
            src={resolvedSource}
            alt={alt}
            title={title}
            className="mx-auto max-h-96 max-w-full rounded object-contain"
            onError={() => {
              setResolvedSource(null);
              setLoadError("The task asset response failed to load.");
            }}
          />
        ) : (
          <div className="flex min-h-24 items-center justify-center rounded bg-muted/40 px-3 text-sm text-muted-foreground">
            {loadError ?? "Loading image…"}
          </div>
        )}
        {selected ? (
          <figcaption className="mt-2 grid gap-2 sm:grid-cols-2">
            <Input
              value={alt}
              aria-label="Image alt text"
              placeholder="Alt text"
              onChange={(event) => updateAttributes({ alt: event.currentTarget.value })}
            />
            <Input
              value={title ?? ""}
              aria-label="Image title"
              placeholder="Optional title"
              onChange={(event) => updateAttributes({ title: event.currentTarget.value || null })}
            />
          </figcaption>
        ) : null}
      </figure>
    </NodeViewWrapper>
  );
}
