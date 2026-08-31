import type { NotificationOccurrence } from "@openducktor/contracts";

const requiredText = (value: string, maxLength: number): string => value.trim().slice(0, maxLength);

const optionalText = (value: string | undefined, maxLength: number): string | undefined => {
  const result = value?.trim().slice(0, maxLength);
  return result || undefined;
};

export const prepareNotificationOccurrence = (
  occurrence: NotificationOccurrence,
): NotificationOccurrence => {
  const prepared: NotificationOccurrence = {
    ...occurrence,
    repositoryLabel: requiredText(occurrence.repositoryLabel, 120),
  };

  if (occurrence.task) {
    const title = optionalText(occurrence.task.title, 240);
    prepared.task = title ? { ...occurrence.task, title } : { id: occurrence.task.id };
  }

  const sessionLabel = optionalText(occurrence.sessionLabel, 120);
  if (sessionLabel) {
    prepared.sessionLabel = sessionLabel;
  } else {
    delete prepared.sessionLabel;
  }

  return prepared;
};
