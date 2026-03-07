export type TaskDocumentSectionKey = "spec" | "plan" | "qa";

type SectionLoadState = {
  inFlight: boolean;
  requestVersion: number;
  pendingForcedReload: boolean;
};

export type TaskDocumentLoadController = {
  contextVersion: number;
  sections: Record<TaskDocumentSectionKey, SectionLoadState>;
};

type LoadRequest = {
  accepted: boolean;
  contextVersion: number | null;
  requestVersion: number | null;
};

type LoadSettlement = {
  shouldApply: boolean;
  shouldReplay: boolean;
};

const createInitialSectionLoadState = (): SectionLoadState => ({
  inFlight: false,
  requestVersion: 0,
  pendingForcedReload: false,
});

const createInitialSectionsState = (): Record<TaskDocumentSectionKey, SectionLoadState> => ({
  spec: createInitialSectionLoadState(),
  plan: createInitialSectionLoadState(),
  qa: createInitialSectionLoadState(),
});

export const createTaskDocumentLoadController = (): TaskDocumentLoadController => ({
  contextVersion: 0,
  sections: createInitialSectionsState(),
});

export const resetTaskDocumentLoadController = (controller: TaskDocumentLoadController): void => {
  controller.contextVersion += 1;
  controller.sections = createInitialSectionsState();
};

export const requestTaskDocumentLoad = (
  controller: TaskDocumentLoadController,
  section: TaskDocumentSectionKey,
  force: boolean,
  isLoaded: boolean,
): LoadRequest => {
  const sectionState = controller.sections[section];
  if (sectionState.inFlight) {
    if (force) {
      sectionState.pendingForcedReload = true;
      return {
        accepted: true,
        contextVersion: null,
        requestVersion: null,
      };
    }

    return {
      accepted: false,
      contextVersion: null,
      requestVersion: null,
    };
  }

  if (!force && isLoaded) {
    return {
      accepted: false,
      contextVersion: null,
      requestVersion: null,
    };
  }

  sectionState.inFlight = true;
  sectionState.pendingForcedReload = false;
  sectionState.requestVersion += 1;
  return {
    accepted: true,
    contextVersion: controller.contextVersion,
    requestVersion: sectionState.requestVersion,
  };
};

export const supersedeTaskDocumentLoad = (
  controller: TaskDocumentLoadController,
  section: TaskDocumentSectionKey,
): void => {
  controller.sections[section].requestVersion += 1;
};

export const settleTaskDocumentLoad = (
  controller: TaskDocumentLoadController,
  section: TaskDocumentSectionKey,
  contextVersion: number,
  requestVersion: number,
): LoadSettlement => {
  const sectionState = controller.sections[section];
  sectionState.inFlight = false;
  const shouldReplay =
    controller.contextVersion === contextVersion && sectionState.pendingForcedReload;
  sectionState.pendingForcedReload = false;
  return {
    shouldApply:
      controller.contextVersion === contextVersion &&
      sectionState.requestVersion === requestVersion,
    shouldReplay,
  };
};
