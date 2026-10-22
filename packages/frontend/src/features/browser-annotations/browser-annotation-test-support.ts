import type { BrowserAnnotationCapture } from "@openducktor/contracts";
import type { BrowserAnnotation } from "./browser-annotation-store";

export const buildCapture = (
  overrides: Partial<BrowserAnnotationCapture> = {},
): BrowserAnnotationCapture => ({
  page: { url: "http://localhost:5173/settings", title: "Settings" },
  selectedText: null,
  elements: [
    {
      tag: "button",
      text: "Save",
      openingTag: '<button class="save" type="submit">',
      selector: "main > form > button.save",
      componentChain: ["SaveButton", "SettingsPage", "App"],
      source: { path: "/repo/src/settings/save-button.tsx", line: 12, column: 5 },
      accessible: { role: "button", name: "Save" },
    },
  ],
  image: { path: "/staged/annotation-image.png", width: 320, height: 120 },
  ...overrides,
});

export const buildAnnotation = (overrides: Partial<BrowserAnnotation> = {}): BrowserAnnotation => {
  const capture = buildCapture();
  return {
    id: "annotation-1",
    number: 1,
    comment: "Make the save button blue.",
    includeScreenshot: true,
    page: capture.page,
    selectedText: capture.selectedText,
    elements: capture.elements,
    image: capture.image,
    revision: 1,
    submissionId: null,
    status: "pending",
    ...overrides,
  };
};
