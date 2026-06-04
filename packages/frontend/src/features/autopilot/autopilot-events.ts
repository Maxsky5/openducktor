import type { AutopilotEventId, TaskCard } from "@openducktor/contracts";
import { AUTOPILOT_EVENT_IDS } from "@openducktor/contracts";
import { isQaRejectedTask } from "@/lib/task-qa";

export type AutopilotObservedEvent = {
  eventId: AutopilotEventId;
  task: TaskCard;
};

export const toTaskMap = (tasks: TaskCard[]): Map<string, TaskCard> => {
  return new Map(tasks.map((task) => [task.id, task]));
};

const detectTaskEvent = (
  previousTask: TaskCard | undefined,
  currentTask: TaskCard,
  eventId: AutopilotEventId,
): boolean => {
  if (!previousTask) {
    return false;
  }

  switch (eventId) {
    case "taskProgressedToSpecReady":
      return previousTask.status !== "spec_ready" && currentTask.status === "spec_ready";
    case "taskProgressedToReadyForDev":
      return previousTask.status !== "ready_for_dev" && currentTask.status === "ready_for_dev";
    case "taskProgressedToAiReview":
      return previousTask.status !== "ai_review" && currentTask.status === "ai_review";
    case "taskRejectedByQa":
      return !isQaRejectedTask(previousTask) && isQaRejectedTask(currentTask);
    case "taskProgressedToHumanReview":
      return previousTask.status !== "human_review" && currentTask.status === "human_review";
  }
};

export const detectAutopilotEvents = (
  previousTasksById: Map<string, TaskCard>,
  tasks: TaskCard[],
): AutopilotObservedEvent[] => {
  const observedEvents: AutopilotObservedEvent[] = [];

  for (const task of tasks) {
    for (const eventId of AUTOPILOT_EVENT_IDS) {
      if (detectTaskEvent(previousTasksById.get(task.id), task, eventId)) {
        observedEvents.push({ eventId, task });
      }
    }
  }

  return observedEvents;
};

export const shouldAdvanceAutopilotBaseline = (params: {
  observedEvents: AutopilotObservedEvent[];
  hasAutopilotSettings: boolean;
}): boolean => {
  return params.hasAutopilotSettings || params.observedEvents.length === 0;
};
