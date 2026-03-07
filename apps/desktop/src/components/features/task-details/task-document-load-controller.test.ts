import { describe, expect, test } from "bun:test";
import {
  createTaskDocumentLoadController,
  requestTaskDocumentLoad,
  resetTaskDocumentLoadController,
  settleTaskDocumentLoad,
  supersedeTaskDocumentLoad,
} from "./task-document-load-controller";

describe("task-document-load-controller", () => {
  test("stale in-flight requests stop applying after an optimistic update supersedes them", () => {
    const controller = createTaskDocumentLoadController();
    const initialLoad = requestTaskDocumentLoad(controller, "spec", false, false);

    expect(initialLoad).toEqual({
      accepted: true,
      contextVersion: 0,
      requestVersion: 1,
    });

    supersedeTaskDocumentLoad(controller, "spec");

    expect(settleTaskDocumentLoad(controller, "spec", 0, 1)).toEqual({
      shouldApply: false,
      shouldReplay: false,
    });
  });

  test("forced reload requests queue while a section is still loading", () => {
    const controller = createTaskDocumentLoadController();
    const initialLoad = requestTaskDocumentLoad(controller, "spec", false, false);

    expect(initialLoad).toEqual({
      accepted: true,
      contextVersion: 0,
      requestVersion: 1,
    });
    expect(requestTaskDocumentLoad(controller, "spec", true, false)).toEqual({
      accepted: true,
      contextVersion: null,
      requestVersion: null,
    });

    expect(settleTaskDocumentLoad(controller, "spec", 0, 1)).toEqual({
      shouldApply: true,
      shouldReplay: true,
    });
    expect(requestTaskDocumentLoad(controller, "spec", true, false)).toEqual({
      accepted: true,
      contextVersion: 0,
      requestVersion: 2,
    });
  });

  test("context resets invalidate stale requests and clear queued reloads", () => {
    const controller = createTaskDocumentLoadController();
    const initialLoad = requestTaskDocumentLoad(controller, "spec", false, false);

    expect(initialLoad).toEqual({
      accepted: true,
      contextVersion: 0,
      requestVersion: 1,
    });
    expect(requestTaskDocumentLoad(controller, "spec", true, false)).toEqual({
      accepted: true,
      contextVersion: null,
      requestVersion: null,
    });

    resetTaskDocumentLoadController(controller);

    expect(settleTaskDocumentLoad(controller, "spec", 0, 1)).toEqual({
      shouldApply: false,
      shouldReplay: false,
    });
  });
});
