import { FRAME_BASE_URL, PAGE_BASE_URL } from "@/rich-content/isolated-page/web-view-bases";

const isSameDocument = (url: string, documentUrl: string): boolean =>
  url === documentUrl || url.startsWith(`${documentUrl}#`);

/**
 * The navigation guard of the preview WebView. It allows the first wrapper load and same-document
 * fragment links in the wrapper and its page frame. Every other request, including a reload of the
 * wrapper, stays blocked.
 */
export const allowsHtmlPreviewRequest = (url: string, wrapperStarted: boolean): boolean => {
  if (isSameDocument(url, FRAME_BASE_URL)) return true;
  if (url.startsWith(`${PAGE_BASE_URL}#`)) return true;
  return !wrapperStarted && url === PAGE_BASE_URL;
};
