import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui";
import { ProjectShell } from "./shell";

// Project data lives in the browser, so nothing under this layout can be
// prerendered for an instant navigation; it renders once the store loads.
export const instant = false;

export default function ProjectLayout({ children, params }: LayoutProps<"/projects/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ProjectShell params={params}>{children}</ProjectShell>
    </Suspense>
  );
}
