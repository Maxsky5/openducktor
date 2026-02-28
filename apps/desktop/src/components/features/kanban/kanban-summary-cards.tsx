import { Clock3, ShieldAlert } from "lucide-react";
import type { ReactElement } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type KanbanSummaryCardsProps = {
  taskCount: number;
  runningCount: number;
  blockedCount: number;
  doneCount: number;
};

export function KanbanSummaryCards({
  taskCount,
  runningCount,
  blockedCount,
  doneCount,
}: KanbanSummaryCardsProps): ReactElement {
  return (
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <Card className="animate-rise-in border-sky-200 bg-sky-50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-foreground">Total Tasks</CardTitle>
          <CardDescription>All lanes</CardDescription>
        </CardHeader>
        <CardContent className="text-3xl font-semibold tracking-tight text-foreground">
          {taskCount}
        </CardContent>
      </Card>

      <Card className="animate-rise-in border-amber-200 bg-amber-50">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm text-foreground">
            <Clock3 className="size-4 text-amber-600" />
            Active Runs
          </CardTitle>
          <CardDescription>Builder execution in-flight</CardDescription>
        </CardHeader>
        <CardContent className="text-3xl font-semibold tracking-tight text-foreground">
          {runningCount}
        </CardContent>
      </Card>

      <Card className="animate-rise-in border-rose-200 bg-rose-50">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm text-foreground">
            <ShieldAlert className="size-4 text-rose-600" />
            Blocked
          </CardTitle>
          <CardDescription>Needs human decision</CardDescription>
        </CardHeader>
        <CardContent className="text-3xl font-semibold tracking-tight text-foreground">
          {blockedCount}
        </CardContent>
      </Card>

      <Card className="animate-rise-in border-emerald-200 bg-emerald-50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-foreground">Done</CardTitle>
          <CardDescription>Closed successfully</CardDescription>
        </CardHeader>
        <CardContent className="text-3xl font-semibold tracking-tight text-foreground">
          {doneCount}
        </CardContent>
      </Card>
    </section>
  );
}
