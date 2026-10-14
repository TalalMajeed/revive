"use client";

import { useSyncExternalStore } from "react";
import type { ProjectBundle } from "./types";

/**
 * Browser store for projects. Until a Supabase project exists, everything
 * lives in this browser's localStorage, one key per project. Swapping in
 * Supabase means reimplementing these functions; the screens only use them.
 */

const PREFIX = "revive:v1:";
const INDEX_KEY = `${PREFIX}projects`;
const projectKey = (id: string) => `${PREFIX}project:${id}`;

let cache: ProjectBundle[] | null = null;
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readAll(): ProjectBundle[] {
  const s = storage();
  if (!s) return [];
  try {
    const ids = JSON.parse(s.getItem(INDEX_KEY) ?? "[]") as string[];
    return ids
      .map((id) => {
        const raw = s.getItem(projectKey(id));
        return raw ? (JSON.parse(raw) as ProjectBundle) : null;
      })
      .filter((b): b is ProjectBundle => b !== null);
  } catch {
    return [];
  }
}

function snapshot(): ProjectBundle[] {
  if (cache === null) cache = readAll();
  return cache;
}

function commit(next: ProjectBundle[]) {
  cache = next;
  const s = storage();
  if (s) {
    try {
      s.setItem(INDEX_KEY, JSON.stringify(next.map((b) => b.project.id)));
    } catch {
      // Storage full or blocked: keep working in memory for this session.
    }
  }
  listeners.forEach((l) => l());
}

function persist(bundle: ProjectBundle): boolean {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(projectKey(bundle.project.id), JSON.stringify(bundle));
    return true;
  } catch {
    return false;
  }
}

export function listProjects(): ProjectBundle[] {
  return snapshot();
}

export function getProject(id: string): ProjectBundle | undefined {
  return snapshot().find((b) => b.project.id === id);
}

/** Inserts or replaces a project. Returns false if the browser refused to store it. */
export function saveProject(bundle: ProjectBundle): boolean {
  const ok = persist(bundle);
  const current = snapshot();
  const i = current.findIndex((b) => b.project.id === bundle.project.id);
  const next = i === -1 ? [...current, bundle] : current.map((b, k) => (k === i ? bundle : b));
  commit(next);
  return ok;
}

export function updateProject(id: string, change: (b: ProjectBundle) => ProjectBundle): boolean {
  const current = getProject(id);
  if (!current) return false;
  return saveProject(change(current));
}

export function deleteProject(id: string) {
  storage()?.removeItem(projectKey(id));
  commit(snapshot().filter((b) => b.project.id !== id));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key?.startsWith(PREFIX)) {
      cache = null;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** All projects, or null while the page is still loading them. */
export function useProjects(): ProjectBundle[] | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

/** One project; null while loading, undefined if it doesn't exist. */
export function useProject(id: string): ProjectBundle | null | undefined {
  const all = useProjects();
  return all === null ? null : all.find((b) => b.project.id === id);
}

export function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
