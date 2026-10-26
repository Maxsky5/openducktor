import { z } from "zod";

export const LOCAL_ATTACHMENT_UNAVAILABLE_REASON = "attachment_unavailable";
export const LOCAL_ATTACHMENT_UNAVAILABLE_MESSAGE = "This attachment cannot be opened.";
/** The host message for a path outside its staging directory. It has the same reason. */
export const LOCAL_ATTACHMENT_NOT_STAGED_MESSAGE =
  "Attachment path is not a staged local attachment.";

/**
 * The host messages with the `attachment_unavailable` reason. The host invoke failure contract
 * does not carry the reason, so clients match these messages.
 */
export const LOCAL_ATTACHMENT_UNAVAILABLE_MESSAGES: readonly string[] = [
  LOCAL_ATTACHMENT_UNAVAILABLE_MESSAGE,
  LOCAL_ATTACHMENT_NOT_STAGED_MESSAGE,
];

export const localAttachmentUnavailableDetailsSchema = z.object({
  reason: z.literal(LOCAL_ATTACHMENT_UNAVAILABLE_REASON),
});

export type LocalAttachmentUnavailableDetails = z.infer<
  typeof localAttachmentUnavailableDetailsSchema
>;
