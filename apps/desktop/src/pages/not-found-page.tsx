import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReactElement } from "react";
import { Link } from "react-router-dom";

export function NotFoundPage(): ReactElement {
  return (
    <div className="flex h-full items-center justify-center">
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Page not found</CardTitle>
          <CardDescription>This route does not exist in OpenDucktor.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link to="/kanban">Go to Kanban</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
