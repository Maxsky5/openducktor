import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { useContext, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/errors";
import { getShellBridge } from "@/lib/shell-bridge";
import { TaskDescriptionImageContext } from "./task-description-image-context";

const ASSET_URI_PATTERN = /^odt-asset:([0-9a-f-]{36})$/i;

export function TaskDescriptionImageNode({ node, selected, updateAttributes }: ReactNodeViewProps) {
  const { previews, renderContext } = useContext(TaskDescriptionImageContext);
  const source = typeof node.attrs.src === "string" ? node.attrs.src : "";
  const assetId = ASSET_URI_PATTERN.exec(source)?.[1] ?? null;
  const preview = assetId ? previews.get(assetId) : undefined;
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
    if (!renderContext) {
      setResolvedSource(null);
      setLoadError("This image will be available after the task is saved.");
      return () => {
        active = false;
      };
    }
    setResolvedSource(null);
    void getShellBridge()
      .resolveTaskAssetSrc({ ...renderContext, assetId })
      .then((nextSource) => {
        if (active) setResolvedSource(nextSource);
      })
      .catch((cause: unknown) => {
        if (active) setLoadError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, [assetId, preview, renderContext, source]);

  return (
    <NodeViewWrapper className="my-3" data-drag-handle>
      <figure className="overflow-hidden rounded-md border border-border bg-card p-2">
        {resolvedSource ? (
          <img
            src={resolvedSource}
            alt={typeof node.attrs.alt === "string" ? node.attrs.alt : ""}
            title={typeof node.attrs.title === "string" ? node.attrs.title : undefined}
            className="mx-auto max-h-96 max-w-full rounded object-contain"
          />
        ) : (
          <div className="flex min-h-24 items-center justify-center rounded bg-muted/40 px-3 text-sm text-muted-foreground">
            {loadError ?? "Loading image…"}
          </div>
        )}
        {selected ? (
          <figcaption className="mt-2 grid gap-2 sm:grid-cols-2">
            <Input
              value={typeof node.attrs.alt === "string" ? node.attrs.alt : ""}
              aria-label="Image alt text"
              placeholder="Alt text"
              onChange={(event) => updateAttributes({ alt: event.currentTarget.value })}
            />
            <Input
              value={typeof node.attrs.title === "string" ? node.attrs.title : ""}
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
