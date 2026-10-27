import { describe, expect, test } from "bun:test";
import { qaVerdictPresentation, taskDescriptionForReading } from "./task-document-paint";

describe("taskDescriptionForReading", () => {
  test("hides a valid front matter block and keeps a malformed one", () => {
    expect(taskDescriptionForReading("---\nowner: ana\n---\nBody text")).toBe("Body text");
    expect(taskDescriptionForReading("---\nowner: ana\nBody text")).toBe(
      "---\nowner: ana\nBody text",
    );
    expect(taskDescriptionForReading("Plain body")).toBe("Plain body");
  });
});

describe("qaVerdictPresentation", () => {
  test("names each verdict in text", () => {
    expect(qaVerdictPresentation("approved")).toEqual({ label: "QA approved", tone: "success" });
    expect(qaVerdictPresentation("rejected").label).toBe("QA rejected");
    expect(qaVerdictPresentation(undefined).label).toBe("Not reviewed");
  });
});
