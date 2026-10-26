import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import type { ClientFeedback } from "@openducktor/frontend-core/platform/client-feedback";

/** The messages of one copy action. */
export type CopyNotice = {
  /** The success message, such as "Code copied." */
  copied: string;
  /** A second line of the success message, such as the copied path. */
  detail?: string | undefined;
  /** The failure message, such as "The code was not copied." */
  failed: string;
};

/** Android 13 is API level 33. From it on, the system shows a preview of each clipboard copy. */
const SYSTEM_COPY_PREVIEW_API_LEVEL = 33;

/**
 * True when the system confirms each clipboard copy itself: Android 13 and later. Takes the
 * Android API level, or null on iOS.
 */
export const systemConfirmsCopy = (androidApiLevel: number | null): boolean =>
  androidApiLevel !== null && androidApiLevel >= SYSTEM_COPY_PREVIEW_API_LEVEL;

/**
 * Runs a clipboard write and says its result once. A success shows a toast only when the system
 * does not confirm the copy itself. A failure always shows its reason. Resolves to true when the
 * content is on the clipboard.
 */
export const copyWithNotice = async (
  write: () => Promise<void>,
  notice: CopyNotice,
  { feedback, systemConfirms }: { feedback: ClientFeedback; systemConfirms: boolean },
): Promise<boolean> => {
  try {
    await write();
  } catch (cause) {
    feedback.show("error", notice.failed, { description: errorMessage(cause) });
    return false;
  }
  if (systemConfirms) return true;
  if (notice.detail) feedback.show("success", notice.copied, { description: notice.detail });
  else feedback.show("success", notice.copied);
  return true;
};
