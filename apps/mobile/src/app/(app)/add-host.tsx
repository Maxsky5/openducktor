import { useRouter } from "expo-router";
import type { ReactElement } from "react";
import { AddHostForm } from "@/hosts/add-host-form";
import { routes } from "@/navigation/routes";
import { SheetFrame } from "@/navigation/sheet-frame";

export default function AddHostSheet(): ReactElement {
  const router = useRouter();
  return (
    <SheetFrame title="Add Host" subtitle="Connect to OpenDucktor on your computer.">
      {/* A new host restarts the app tree on that host, which closes this sheet. */}
      <AddHostForm onScan={() => router.push(routes.scanHost())} />
    </SheetFrame>
  );
}
