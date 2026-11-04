import {
  gitlabAccountAddTokenInputSchema,
  gitlabAccountsListInputSchema,
  gitlabConnectionStatusInputSchema,
  gitlabSignInPollInputSchema,
} from "@openducktor/contracts";
import type { z } from "zod";
import { HostValidationError } from "../../effect/host-errors";
import type { GitlabConnectionPort } from "../../ports/gitlab-connection-port";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import type { HostCommandArgs } from "./command-inputs";

const parse = <Schema extends z.ZodType>(
  schema: Schema,
  args: HostCommandArgs,
  command: string,
): z.output<Schema> => {
  const result = schema.safeParse(args ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new HostValidationError({
      field: issue?.path.join(".") || command,
      message: issue?.message ?? `${command} input is invalid.`,
    });
  }
  return result.data;
};

export const createGitlabConnectionCommandHandlers = ({
  connection,
}: {
  connection: GitlabConnectionPort;
}) =>
  ({
    gitlab_accounts_list: (args) =>
      connection.listAccounts(
        parse(gitlabAccountsListInputSchema, args, "gitlab_accounts_list").instanceUrl,
      ),
    gitlab_connection_status: (args) =>
      connection.status(parse(gitlabConnectionStatusInputSchema, args, "gitlab_connection_status")),
    gitlab_account_add_token: (args) =>
      connection.addToken(
        parse(gitlabAccountAddTokenInputSchema, args, "gitlab_account_add_token"),
      ),
    gitlab_sign_in_start: () => connection.startSignIn(),
    gitlab_sign_in_poll: (args) =>
      connection.pollSignIn(
        parse(gitlabSignInPollInputSchema, args, "gitlab_sign_in_poll").attemptId,
      ),
  }) satisfies HostCommandHandlerDefinitions;
