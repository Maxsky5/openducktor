import { usageReportReadInputSchema } from "@openducktor/contracts";
import type { UsageReportService } from "../../application/usage/usage-report-service";
import { type HostCommandArgs, parseCommandInput } from "./command-inputs";

export const createUsageCommandHandlers = (usage: Pick<UsageReportService, "read">) => ({
  usage_report_read: (args: HostCommandArgs) =>
    usage.read(parseCommandInput(usageReportReadInputSchema, args, "usage_report_read")),
});
