import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { localImageDataUrl, localImageQueryOptions } from "@/state/queries/local-images";

/** A Markdown image of a host file, such as `![Shot](/tmp/shot.png)` in an agent reply. */
export function MarkdownLocalImage({
  path,
  alt,
  title,
  className,
}: {
  path: string;
  alt?: string | undefined;
  title?: string | undefined;
  className?: string | undefined;
}): ReactElement {
  const image = useQuery(localImageQueryOptions(path));
  if (image.isPending) {
    return <span className="text-sm text-muted-foreground">Loading image…</span>;
  }
  if (image.isError) {
    return (
      <span role="alert" className="text-sm text-destructive">
        Image could not be loaded: {errorMessage(image.error)}
      </span>
    );
  }
  return (
    <img alt={alt ?? ""} title={title} src={localImageDataUrl(image.data)} className={className} />
  );
}
