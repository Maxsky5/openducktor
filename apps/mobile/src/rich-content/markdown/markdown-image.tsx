import { type ReactElement, useCallback, useMemo } from "react";
import { View } from "react-native";
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
  const viewport = useInViewport(useMarkdownVisible());
  return (
    <View ref={viewport.ref} onLayout={viewport.onLayout}>
      <MarkdownImageContent url={url} alt={alt} inView={viewport.inView} />
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
  const { imageContext, stagedImages, openLink } = useMarkdownContext();
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
  const remoteUrl = source.kind === "remote" ? source.url : null;
  const openRemote = useCallback(() => {
    if (remoteUrl !== null) openLink(remoteUrl);
  }, [openLink, remoteUrl]);
  switch (source.kind) {
    case "task_asset": {
      // A staged image shows from its picked device file until the host saves it.
      if (stagedUri !== undefined) {
        return inView ? (
          <FittedImage
            uri={stagedUri}
            recyclingKey={stagedUri}
            alt={alt}
            cachePolicy="none"
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
      return inView ? (
        <FittedImage
          uri={source.url}
          recyclingKey={source.url}
          alt={alt}
          cachePolicy="disk"
          onPress={openRemote}
          accessibilityHint={BROWSER_HINT}
        />
      ) : (
        <ImagePlaceholder alt={alt} loading={false} recyclingKey={source.url} />
      );
    case "unsupported":
      return <Callout tone="warning" title={title} message={source.reason} />;
  }
}
