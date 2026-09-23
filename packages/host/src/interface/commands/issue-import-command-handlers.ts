import {
  issueItemGetInputSchema,
  issueImageGetInputSchema,
  issueItemsImportInputSchema,
  issueItemsListInputSchema,
} from "@openducktor/contracts";
import { HostValidationError } from "../../effect/host-errors";
import type { createIssueImportService } from "../../application/git/issue-import-service";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";

type IssueImportService = ReturnType<typeof createIssueImportService>;

export const createIssueImportCommandHandlers = (service: IssueImportService) =>
  ({
    issue_image_get: (args) => {
      const parsed = issueImageGetInputSchema.safeParse(args);
      if (!parsed.success)
        throw new HostValidationError({
          field: "issue_image_get",
          message: "Issue image input is invalid. Refresh the Issue and retry.",
        });
      return service.getImage(parsed.data);
    },
    issue_item_get: (args) => {
      const parsed = issueItemGetInputSchema.safeParse(args);
      if (!parsed.success)
        throw new HostValidationError({
          field: "issue_item_get",
          message:
            "Issue refresh input is invalid. Check the repository and source ID, then retry.",
        });
      return service.get(parsed.data);
    },
    issue_items_list: (args) => {
      const parsed = issueItemsListInputSchema.safeParse(args);
      if (!parsed.success)
        throw new HostValidationError({
          field: "issue_items_list",
          message: "Issue list input is invalid. Check the repository and search, then retry.",
        });
      return service.list(parsed.data);
    },
    issue_items_import: (args) => {
      const parsed = issueItemsImportInputSchema.safeParse(args);
      if (!parsed.success)
        throw new HostValidationError({
          field: "issue_items_import",
          message: "Issue import input is invalid. Review the selected items and retry.",
        });
      return service.import(parsed.data);
    },
  }) satisfies HostCommandHandlerDefinitions;
