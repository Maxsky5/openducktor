import type { BrowserAnnotationAnchor, BrowserBox } from "@openducktor/contracts";
import { useEffect, useMemo, useState } from "react";
import type { BrowserAnnotation } from "@/features/browser-annotations";
import type { BrowserChannel } from "./browser-channel";
import { useBrowserChannelStatus } from "./browser-runtime";

const MAX_ANCHORS = 200;

/**
 * Follows the annotated elements of the current page. The host reports their boxes when the page
 * scrolls, resizes, or changes, and a box is null while its element is not on the page.
 */
export const useBrowserAnchors = (
  channel: BrowserChannel,
  tabId: string,
  live: boolean,
  url: string,
  annotations: readonly BrowserAnnotation[],
) => {
  const status = useBrowserChannelStatus(channel);
  const [boxes, setBoxes] = useState<ReadonlyMap<string, BrowserBox | null>>(new Map());
  const anchors = useMemo(() => browserAnnotationAnchors(annotations, url), [annotations, url]);

  useEffect(() => {
    if (status !== "connected" || !live) return;
    channel.send({ type: "anchors", tabId, anchors });
  }, [anchors, channel, live, status, tabId]);

  useEffect(
    () => () => {
      channel.send({ type: "anchors", tabId, anchors: [] });
    },
    [channel, tabId],
  );

  useEffect(
    () =>
      channel.subscribe((message) => {
        if (message.type !== "anchor_boxes" || message.tabId !== tabId) return;
        setBoxes(new Map(message.boxes.map((entry) => [entry.annotationId, entry.box])));
      }),
    [channel, tabId],
  );

  const onPage = useMemo(() => new Set(anchors.map((anchor) => anchor.annotationId)), [anchors]);
  return {
    /** The box of an annotation on this page, or null when its element is not on screen. */
    boxOf: (annotationId: string): BrowserBox | null =>
      onPage.has(annotationId) ? (boxes.get(annotationId) ?? null) : null,
    /** Annotations whose elements are not on the current page. */
    offPageIds: new Set(
      annotations
        .filter((annotation) => !onPage.has(annotation.id) || !boxes.get(annotation.id))
        .map((annotation) => annotation.id),
    ),
    reveal: (annotationId: string) => channel.send({ type: "reveal_anchor", tabId, annotationId }),
  };
};

export type BrowserAnchors = ReturnType<typeof useBrowserAnchors>;

/** The anchors of the annotations that belong to the current page of the tab. */
export const browserAnnotationAnchors = (
  annotations: readonly BrowserAnnotation[],
  url: string,
): BrowserAnnotationAnchor[] =>
  annotations
    .filter((annotation) => pageAddress(annotation.page.url) === pageAddress(url))
    .slice(0, MAX_ANCHORS)
    .map((annotation) => ({
      annotationId: annotation.id,
      selectors: annotation.elements.map((element) => element.selector),
    }));

/** A page address without its fragment, so in-page links keep the anchors of the page. */
const pageAddress = (url: string): string => url.split("#", 1)[0] ?? url;
