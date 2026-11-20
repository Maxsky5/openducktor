import { type ReactElement, useCallback, useMemo } from "react";
import { View } from "react-native";
import { useOptionalIsDemo } from "@/host-session/active-session-context";
import { Callout } from "@/ui/callout";
import { FittedImage } from "../images/fitted-image";
import { HostImage, type HostImageFile, ImagePlaceholder } from "../images/host-image";
import { classifyImageSource } from "../images/image-source";
import { IssueImage } from "../images/issue-image";
import { useImageActions } from "../images/use-image-actions";
import { useInViewport } from "../viewport/use-in-viewport";
import { useMarkdownContext, useMarkdownVisible } from "./markdown-context";

const SHARE_HINT = "Opens the share sheet.";
const BROWSER_HINT = "Opens the image in the browser.";

/**
 * A Markdown image: a task image or a source issue image from the host, a web image, or the reason
 * it does not show. It loads near the list viewport and releases away from it, while its
 * placeholder keeps its height. A tap opens a host image in the share sheet and a web image in the
 * browser.
 */
export function MarkdownImage({ url, alt }: { url: string; alt: string }): ReactElement {
  const { ref: viewportRef, onLayout, inView } = useInViewport(useMarkdownVisible());
  return (
    <View ref={viewportRef} onLayout={onLayout}>
      <MarkdownImageContent url={url} alt={alt} inView={inView} />
    </View>
  );
}

function MarkdownImageContent({
  url,
  alt,
  inView,
}: {
  url: string;
  alt: string;
  inView: boolean;
}): ReactElement {
  const { imageContext, stagedImages } = useMarkdownContext();
  const { action, share } = useImageActions();
  const source = useMemo(() => classifyImageSource(url, imageContext), [imageContext, url]);
  const title = alt.length > 0 ? `Image: ${alt}` : "Image";
  const shareFile = useCallback(
    (file: HostImageFile) => {
      if (action === null) void share(file.uri, alt, file.mediaType);
    },
    [action, alt, share],
  );
  const stagedUri = source.kind === "task_asset" ? stagedImages?.get(source.assetId) : undefined;
  const shareStaged = useCallback(() => {
    if (stagedUri !== undefined && action === null) void share(stagedUri, alt);
  }, [action, alt, share, stagedUri]);
  switch (source.kind) {
    case "task_asset": {
      // A staged image shows from its picked device file until the host saves it.
      if (stagedUri !== undefined) {
        return inView ? (
          <FittedImage
            uri={stagedUri}
            recyclingKey={stagedUri}
            alt={alt}
            cachePolicy="memory"
            onPress={shareStaged}
            accessibilityHint={SHARE_HINT}
          />
        ) : (
          <ImagePlaceholder alt={alt} loading={false} recyclingKey={stagedUri} />
        );
      }
      return imageContext === null ? (
        <Callout tone="info" title={title} message="This task image shows only in its task." />
      ) : (
        <HostImage
          assetId={source.assetId}
          context={imageContext}
          alt={alt}
          visible={inView}
          onPress={shareFile}
          accessibilityHint={SHARE_HINT}
        />
      );
    }
    case "issue_image":
      return imageContext?.issue ? (
        <IssueImage
          url={source.url}
          task={imageContext}
          issue={imageContext.issue}
          alt={alt}
          visible={inView}
          onPress={shareFile}
          accessibilityHint={SHARE_HINT}
        />
      ) : (
        <Callout tone="info" title={title} message="This issue image shows only in its task." />
      );
    case "remote":
      return <RemoteMarkdownImage url={source.url} alt={alt} title={title} inView={inView} />;
    case "unsupported":
      return <Callout tone="warning" title={title} message={source.reason} />;
  }
}

/** A web image. A tap opens it in the browser. The demo sends no network request, so it shows none. */
function RemoteMarkdownImage({
  url,
  alt,
  title,
  inView,
}: {
  url: string;
  alt: string;
  title: string;
  inView: boolean;
}): ReactElement {
  const { openLink } = useMarkdownContext();
  const demo = useOptionalIsDemo();
  const open = useCallback(() => openLink(url), [openLink, url]);
  if (demo)
    return (
      <Callout
        tone="info"
        title={title}
        message="Web images do not load in the demo. Connect to a host to see them."
      />
    );
  return inView ? (
    <FittedImage
      uri={url}
      recyclingKey={url}
      alt={alt}
      cachePolicy="disk"
      onPress={open}
      accessibilityHint={BROWSER_HINT}
    />
  ) : (
    <ImagePlaceholder alt={alt} loading={false} recyclingKey={url} />
  );
}
