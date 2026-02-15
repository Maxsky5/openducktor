import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, CircleSlash2, ShieldAlert } from "lucide-react";
import type { ReactElement } from "react";

type ExecutionSummaryCardsProps = {
  activeRuns: number;
  blockedRuns: number;
  eventCount: number;
};

export function ExecutionSummaryCards({
  activeRuns,
  blockedRuns,
  eventCount,
}: ExecutionSummaryCardsProps): ReactElement {
  return (
    <section className="grid gap-3 md:grid-cols-3">
      <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50 to-white">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm text-slate-700">
            <Activity className="size-4 text-emerald-600" />
            Active Runs
          </CardTitle>
        </CardHeader>
        <CardContent className="text-2xl font-semibold">{activeRuns}</CardContent>
      </Card>

      <Card className="border-rose-200 bg-gradient-to-br from-rose-50 to-white">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm text-slate-700">
            <ShieldAlert className="size-4 text-rose-600" />
            Blocked
          </CardTitle>
        </CardHeader>
        <CardContent className="text-2xl font-semibold">{blockedRuns}</CardContent>
      </Card>

      <Card className="border-slate-200 bg-gradient-to-br from-slate-50 to-white">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm text-slate-700">
            <CircleSlash2 className="size-4 text-slate-600" />
            Event Entries
          </CardTitle>
        </CardHeader>
        <CardContent className="text-2xl font-semibold">{eventCount}</CardContent>
      </Card>
    </section>
  );
}
