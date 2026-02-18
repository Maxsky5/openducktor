import { type ReactElement, useMemo } from "react";
import { Navigate, useSearchParams } from "react-router-dom";

export function BuilderPage(): ReactElement {
  const [searchParams] = useSearchParams();
  const redirect = useMemo(() => {
    const next = new URLSearchParams(searchParams);
    next.set("agent", "build");
    return `/agents?${next.toString()}`;
  }, [searchParams]);

  return <Navigate to={redirect} replace />;
}
