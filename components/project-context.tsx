"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { updateProject, useProject } from "@/lib/data/store";
import type { ProjectBundle } from "@/lib/data/types";
import { forecastWeek, type WeeklyForecast } from "@/lib/progress/forecast";

interface ProjectData {
  bundle: ProjectBundle;
  /** This week's forecast (latest update), with every run's finish kept for charts. */
  forecast: WeeklyForecast;
  save: (change: (b: ProjectBundle) => ProjectBundle) => boolean;
}

const Ctx = createContext<ProjectData | null>(null);

export function ProjectProvider({
  id,
  loading,
  missing,
  children,
}: {
  id: string;
  loading: ReactNode;
  missing: ReactNode;
  children: ReactNode;
}) {
  const bundle = useProject(id);
  const forecast = useMemo(
    () => (bundle ? forecastWeek(bundle, undefined, { iterations: 2000, keepFinishes: true }) : null),
    [bundle],
  );
  if (bundle === null) return <>{loading}</>;
  if (bundle === undefined || !forecast) return <>{missing}</>;
  return (
    <Ctx.Provider value={{ bundle, forecast, save: (change) => updateProject(id, change) }}>
      {children}
    </Ctx.Provider>
  );
}

export function useProjectData(): ProjectData {
  const v = useContext(Ctx);
  if (!v) throw new Error("useProjectData outside ProjectProvider");
  return v;
}
