"use client";

import { useMemo, useState } from "react";
import { MultiSelect } from "@/components/multi-select";
import type { GroupLite } from "@/lib/groups/queries";
import type { WorkshopEntity } from "@/lib/workshop/queries";
import {
  TG_BUCKETS,
  TG_BUCKET_LABEL,
  TG_MEASURES,
  TG_MEASURE_LABEL,
  TG_SUBJECTS,
  TG_SUBJECT_LABEL,
  type TgGrade,
  type TrendGridParams,
} from "@/lib/viz/trend-grid-spec";

const SINGLE_GRADES: TgGrade[] = ["3", "4", "5", "6", "7", "8"];

/** Right-pane controls for the "Trend grid" visualization type. */
export function TrendGridControls({
  params: p,
  onChange,
  entities,
  entitiesById,
  counties,
  groups,
  years,
  subgroups,
  homeDistrictId,
  input,
}: {
  params: TrendGridParams;
  onChange: (next: TrendGridParams) => void;
  entities: WorkshopEntity[];
  entitiesById: Map<number, WorkshopEntity>;
  counties: string[];
  groups: GroupLite[];
  years: string[];
  subgroups: string[];
  homeDistrictId: number | null;
  input: string;
}) {
  const set = (patch: Partial<TrendGridParams>) => onChange({ ...p, ...patch });
  const targetId = p.targetId ?? homeDistrictId;
  const target = targetId != null ? entitiesById.get(targetId) : undefined;
  const level = target?.type ?? "district";
  const noun = level === "district" ? "districts" : "schools";

  // Target picker: type-to-search over districts (and schools).
  const [q, setQ] = useState("");
  const [withSchools, setWithSchools] = useState(level === "school");
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return entities
      .filter((e) => (withSchools || e.type === "district") && e.name.toLowerCase().includes(needle))
      .slice(0, 50);
  }, [entities, q, withSchools]);

  const activeYears = p.years.length ? p.years : years;
  const toggleYear = (y: string) => {
    const on = new Set(activeYears);
    if (on.has(y)) {
      if (on.size === 1) return; // keep at least one
      on.delete(y);
    } else on.add(y);
    const next = years.filter((x) => on.has(x));
    set({ years: next.length === years.length ? [] : next });
  };
  const toggleGrade = (g: TgGrade) => {
    const on = new Set(p.grades);
    if (on.has(g)) {
      if (on.size === 1) return;
      on.delete(g);
    } else on.add(g);
    set({ grades: [...SINGLE_GRADES, "all" as TgGrade].filter((x) => on.has(x)) });
  };
  const toggleSubject = (s: (typeof TG_SUBJECTS)[number]) => {
    const on = new Set(p.subjects);
    if (on.has(s)) {
      if (on.size === 1) return;
      on.delete(s);
    } else on.add(s);
    set({ subjects: TG_SUBJECTS.filter((x) => on.has(x)) });
  };

  const chip = (on: boolean) =>
    `rounded px-1.5 py-0.5 text-[11px] ${on ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500 dark:bg-slate-800"}`;
  const lbl = "font-medium text-slate-600 dark:text-slate-300";
  const hint = "text-[11px] text-slate-400";

  return (
    <>
      <p className="text-[11px] text-slate-400">
        Ranks one district (or school) against a comparison group on the Grades 3–8 / Science state tests, by grade
        and year. 1 = top.
      </p>

      {/* Target */}
      <div className="flex flex-col gap-1 text-sm">
        <span className={lbl}>Rank this {level}</span>
        <div className="rounded-lg border border-slate-200 px-2 py-1.5 text-slate-700 dark:border-slate-800 dark:text-slate-200">
          {target ? target.name : <span className="text-slate-400">Choose a district…</span>}
          {targetId != null && targetId === homeDistrictId && <span className="ml-1 text-[11px] text-indigo-500">(my district)</span>}
        </div>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={withSchools ? "Search districts & schools…" : "Search districts…"}
          className={`${input} w-full`}
        />
        {matches.length > 0 && (
          <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
            {matches.map((e) => (
              <button
                key={e.id}
                onClick={() => {
                  set({ targetId: e.id });
                  setQ("");
                }}
                className="block w-full truncate px-2 py-1 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {e.name}
                {e.type === "school" && <span className="ml-1 text-[10px] text-slate-400">school</span>}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-3 text-xs">
          <label className="flex items-center gap-1 text-slate-500">
            <input type="checkbox" checked={withSchools} onChange={(e) => setWithSchools(e.target.checked)} />
            Allow schools
          </label>
          {homeDistrictId != null && targetId !== homeDistrictId && (
            <button onClick={() => set({ targetId: homeDistrictId })} className="text-indigo-600 hover:underline">
              Use my district
            </button>
          )}
        </div>
      </div>

      {/* Comparison pool */}
      <label className="flex flex-col gap-1 text-sm">
        <span className={lbl}>Compared to</span>
        <select
          value={p.pool.kind}
          onChange={(e) => set({ pool: { ...p.pool, kind: e.target.value as TrendGridParams["pool"]["kind"] } })}
          className={`${input} w-full`}
        >
          <option value="state">All {noun} in NY State</option>
          <option value="counties">{noun[0].toUpperCase() + noun.slice(1)} in selected counties</option>
          <option value="group" disabled={groups.length === 0}>
            A saved group{groups.length === 0 ? " (none saved)" : ""}
          </option>
        </select>
      </label>
      {p.pool.kind === "counties" && (
        <MultiSelect
          options={counties}
          selected={p.pool.counties}
          onChange={(next) => set({ pool: { ...p.pool, counties: next } })}
          allLabel="Choose counties…"
          pluralNoun="counties"
          searchPlaceholder="Search counties…"
          title="Counties whose districts make up the comparison group"
          className={`${input} w-full text-left`}
        />
      )}
      {p.pool.kind === "group" && (
        <select
          value={p.pool.groupId ?? ""}
          onChange={(e) => {
            const g = groups.find((x) => String(x.id) === e.target.value);
            set({ pool: { ...p.pool, groupId: g?.id ?? null, groupName: g?.name ?? null } });
          }}
          className={`${input} w-full`}
        >
          <option value="">Choose a group…</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name} ({g.entityIds.length})
            </option>
          ))}
        </select>
      )}
      <span className={hint}>
        Only {noun} are compared (the {level} itself is always included). Groups use their {noun} only.
      </span>

      {/* Measure + subgroup */}
      <label className="flex flex-col gap-1 text-sm">
        <span className={lbl}>Measure</span>
        <select value={p.measure} onChange={(e) => set({ measure: e.target.value as TrendGridParams["measure"] })} className={`${input} w-full`}>
          {TG_MEASURES.map((m) => (
            <option key={m} value={m}>{TG_MEASURE_LABEL[m]}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className={lbl}>Student group</span>
        <select value={p.subgroup} onChange={(e) => set({ subgroup: e.target.value })} className={`${input} w-full`}>
          {(subgroups.includes(p.subgroup) ? subgroups : [p.subgroup, ...subgroups]).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <span className={hint}>Ranked within this group across the comparison {noun}.</span>
      </label>

      {/* Subjects */}
      <div className="flex flex-col gap-1 text-sm">
        <span className={lbl}>Subjects</span>
        <div className="flex flex-wrap gap-1">
          {TG_SUBJECTS.map((s) => (
            <button key={s} onClick={() => toggleSubject(s)} className={chip(p.subjects.includes(s))}>
              {TG_SUBJECT_LABEL[s]}
            </button>
          ))}
        </div>
        {p.subjects.includes("science") && <span className={hint}>Science is tested in grades 5 and 8 only.</span>}
      </div>

      {/* Grades */}
      <div className="flex flex-col gap-1 text-sm">
        <span className={lbl}>Grades</span>
        <div className="flex flex-wrap gap-1">
          {SINGLE_GRADES.map((g) => (
            <button key={g} onClick={() => toggleGrade(g)} className={chip(p.grades.includes(g))}>
              {g}
            </button>
          ))}
          <button onClick={() => toggleGrade("all")} className={chip(p.grades.includes("all"))} title="ELA/Math grades 3–8 combined; Science 5–8 combined">
            All grades combined
          </button>
        </div>
      </div>

      {/* Regents takers ("combined" results) */}
      {(p.subjects.includes("math") || p.subjects.includes("science")) && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={p.useCombined}
            onChange={(e) => set({ useCombined: e.target.checked })}
          />
          <span className="flex flex-col">
            <span className="text-slate-600 dark:text-slate-300">
              Grades 6–8: include students who took a Regents exam instead
            </span>
            <span className={hint}>
              Uses the state&rsquo;s &ldquo;combined&rdquo; results (Math 6–8, Science 8); those rows are starred.
              {p.useCombined && p.measure === "mean_score" && " Not available for mean scale score, so plain grade results are shown."}
            </span>
          </span>
        </label>
      )}

      {/* Years */}
      <div className="flex flex-col gap-1 text-sm">
        <span className={lbl}>School years</span>
        <div className="flex flex-wrap gap-1">
          {years.map((y) => (
            <button key={y} onClick={() => toggleYear(y)} className={chip(activeYears.includes(y))}>
              {y}
            </button>
          ))}
        </div>
      </div>

      {/* Buckets */}
      <label className="flex flex-col gap-1 text-sm">
        <span className={lbl}>Rank buckets</span>
        <select value={p.buckets} onChange={(e) => set({ buckets: Number(e.target.value) as TrendGridParams["buckets"] })} className={`${input} w-full`}>
          {TG_BUCKETS.map((b) => (
            <option key={b} value={b}>{TG_BUCKET_LABEL[b]} (1–{b})</option>
          ))}
        </select>
      </label>
    </>
  );
}
