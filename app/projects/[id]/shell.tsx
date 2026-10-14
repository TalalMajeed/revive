"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { use, type ReactNode } from "react";
import { ProjectProvider, useProjectData } from "@/components/project-context";
import { Badge, Button, LinkButton, PageSkeleton } from "@/components/ui";
import { deleteProject } from "@/lib/data/store";
import { fmtDate } from "@/lib/format";

const TABS = [
  { href: "", label: "Weekly card" },
  { href: "/schedule", label: "Schedule" },
  { href: "/update", label: "Weekly update" },
  { href: "/causes", label: "Causes & payments" },
  { href: "/recovery", label: "Recovery" },
  { href: "/eot", label: "EOT pack" },
  { href: "/replay", label: "Replay" },
];

export function ProjectShell({ params, children }: { params: Promise<{ id: string }>; children: ReactNode }) {
  const { id } = use(params);
  return (
    <ProjectProvider
      id={decodeURIComponent(id)}
      loading={<PageSkeleton />}
      missing={
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <h1 className="text-xl font-semibold">Project not found</h1>
          <p className="mt-2 max-w-prose text-ink-2">
            Projects are saved in this browser. It may have been set up in another browser, or deleted.
          </p>
          <LinkButton href="/" variant="primary" className="mt-6">
            Back to projects
          </LinkButton>
        </div>
      }
    >
      <Header />
      {children}
    </ProjectProvider>
  );
}

function Header() {
  const { bundle, forecast } = useProjectData();
  const pathname = usePathname();
  const router = useRouter();
  const base = `/projects/${encodeURIComponent(bundle.project.id)}`;
  const p = bundle.project;
  const done = p.status === "completed";
  return (
    <div className="no-print border-b border-rule bg-paper">
      <div className="mx-auto w-full max-w-6xl px-4 pt-6 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-balance sm:text-2xl">{p.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
              {p.code ? <span className="font-mono text-[0.8125rem]">{p.code}</span> : null}
              {p.location ? <span>{p.location}</span> : null}
              <span>
                {done
                  ? `Finished ${fmtDate(p.actualCompletionDate)}`
                  : `Status at ${fmtDate(forecast.status.dataDate)}`}
              </span>
              {p.isDemo ? <Badge>Demo project</Badge> : null}
            </p>
          </div>
          <div className="flex gap-2">
            {!p.isDemo ? (
              <Button
                variant="ghost"
                onClick={() => {
                  if (window.confirm(`Delete "${p.name}" and all its weekly records from this browser?`)) {
                    deleteProject(p.id);
                    router.push("/");
                  }
                }}
              >
                Delete project
              </Button>
            ) : null}
            {!done ? (
              <LinkButton href={`${base}/update`} variant="primary">
                Weekly update
              </LinkButton>
            ) : null}
          </div>
        </div>
        <nav className="-mb-px mt-5 flex gap-1 overflow-x-auto" aria-label="Project sections">
          {TABS.map((t) => {
            const href = `${base}${t.href}`;
            const active = pathname === href;
            return (
              <Link
                key={t.href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`shrink-0 border-b-2 px-3 pb-2.5 pt-1 text-sm no-underline transition-colors duration-150 ${
                  active ? "border-ink font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
