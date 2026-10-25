import { describe, expect, test } from "bun:test";
import {
  LOCAL_ATTACHMENT_NOT_STAGED_MESSAGE,
  LOCAL_ATTACHMENT_UNAVAILABLE_MESSAGE,
} from "@openducktor/contracts";
import { HostInvokeError } from "@openducktor/host-client";
import { remoteError } from "@openducktor/host-client/remote";
import { AgentMessageSendError } from "../../lib/agent-message-send-error";
import { describeComposerFailure } from "./composer-failure";

const options = { title: "Unable to send message", attachmentNames: ["photo.jpg"] };

describe("describeComposerFailure", () => {
  test("shows Result unknown with the host guidance for a lost result", () => {
    const lost = remoteError(
      "outcome_unknown",
      "The result of agentSessionSubmit was lost.",
      "Read current host state to check the outcome. Do not resend the operation automatically.",
    );

    expect(
      describeComposerFailure(new AgentMessageSendError(lost, "attention-1"), options),
    ).toEqual({
      kind: "result_unknown",
      title: "Result unknown",
      message:
        "The result of agentSessionSubmit was lost. Read current host state to check the outcome. Do not resend the operation automatically. Check the transcript before you send it again.",
    });
  });

  test("names the attachment to attach again", () => {
    const failure = describeComposerFailure(
      new HostInvokeError(LOCAL_ATTACHMENT_UNAVAILABLE_MESSAGE),
      options,
    );

    expect(failure).toEqual({
      kind: "attachment_unavailable",
      title: "Attach the file again",
      message:
        "photo.jpg is no longer on the host. Remove it from the draft and attach the file again.",
    });
    expect(
      describeComposerFailure(new HostInvokeError(LOCAL_ATTACHMENT_UNAVAILABLE_MESSAGE), {
        ...options,
        attachmentNames: ["a.png", "b.png"],
      }).message,
    ).toStartWith("An attachment of this message is no longer on the host.");
  });

  test("treats a path outside the host staging directory as an unavailable attachment", () => {
    expect(
      describeComposerFailure(new HostInvokeError(LOCAL_ATTACHMENT_NOT_STAGED_MESSAGE), options)
        .kind,
    ).toBe("attachment_unavailable");
  });

  test("keeps other failures with their own message", () => {
    expect(describeComposerFailure(new Error("The runtime is busy."), options)).toEqual({
      kind: "failed",
      title: "Unable to send message",
      message: "The runtime is busy.",
    });
  });
});
