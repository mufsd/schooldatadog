// Trend grid ranking query. Kept free of auth / "server-only" so it can be
// exercised directly from a script; the server action in ./trend-grid.ts is the
// only app entry point (it does the auth + group ownership checks).

import { sql, type SQL } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import {
  tgBucket,
  tgCombinedCode,
  tgGradesFor,
  tgMetricCode,
  type TgGrade,
  type TgSubject,
  type TrendGridCell,
  type TrendGridParams,
  type TrendGridResult,
} from "./trend-grid-spec";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = PgDatabase<PgQueryResultHKT, any>;

const rowsOf = <T>(res: unknown): T[] =>
  (Array.isArray(res) ? res : ((res as { rows?: T[] })?.rows ?? [])) as T[];

/** School years with Grades 3-8 assessment data, oldest first. */
export async function trendGridYears(db: Db): Promise<string[]> {
  const res = await db.execute(sql`
    select distinct f.school_year as y
    from facts f
    where f.metric_id = (select id from metrics where code = 'src_em_ela_proficient_pct_g3_8')
      and f.value_numeric is not null
    order by 1`);
  return rowsOf<{ y: string }>(res).map((r) => r.y);
}

/** Subgroups reported on the Grades 3-8 assessments. */
export async function trendGridSubgroups(db: Db): Promise<string[]> {
  const res = await db.execute(sql`
    select f.subgroup as s, count(*)::int as c
    from facts f
    where f.metric_id = (select id from metrics where code = 'src_em_ela_proficient_pct_g4')
    group by 1
    order by (f.subgroup = 'All Students') desc, 2 desc, 1`);
  return rowsOf<{ s: string }>(res).map((r) => r.s);
}

/**
 * Rank `p.targetId` against the comparison pool for every requested
 * subject × grade × year. `groupEntityIds` must be the (already ownership-
 * checked) members of `p.pool.groupId` when pool.kind === "group".
 *
 * Pool rules: the pool is always entities of the TARGET's type (districts vs
 * districts, schools vs schools), and the target is always included even if it
 * isn't a member. Within each (metric, year, subgroup) only entities with a
 * numeric value are ranked (suppressed "s" values are dropped from both the
 * pool and the target). Rank is competition rank on value, higher = better
 * (ties share the best rank); see tgBucket for the bucket mapping.
 */
export async function computeTrendGrid(
  db: Db,
  p: TrendGridParams & { targetId: number },
  groupEntityIds: number[] | null,
): Promise<TrendGridResult> {
  const tRes = await db.execute(
    sql`select id, name, type from entities where id = ${p.targetId} and type in ('district','school')`,
  );
  const target = rowsOf<{ id: number; name: string; type: "district" | "school" }>(tRes)[0];
  if (!target) return { ok: false, error: "That district or school wasn't found." };
  const level = target.type;
  const noun = level === "district" ? "districts" : "schools";

  // Comparison pool (same entity type as the target) + its label.
  let poolWhere: SQL;
  let poolLabel: string;
  if (p.pool.kind === "counties" && p.pool.counties.length) {
    poolWhere = sql`type = ${level} and county in ${p.pool.counties}`;
    poolLabel =
      p.pool.counties.length === 1
        ? `${noun} in ${p.pool.counties[0]} County`
        : `${noun} in ${p.pool.counties.length} counties (${p.pool.counties.join(", ")})`;
  } else if (p.pool.kind === "group" && groupEntityIds) {
    const ids = groupEntityIds.length ? groupEntityIds : [-1];
    poolWhere = sql`type = ${level} and id in ${ids}`;
    poolLabel = `${noun} in group “${p.pool.groupName ?? "group"}”`;
  } else {
    poolWhere = sql`type = ${level}`;
    poolLabel = `all ${noun} in NY State`;
  }

  const sizeRes = await db.execute(
    sql`select count(*)::int as n from entities where (${poolWhere}) or id = ${target.id}`,
  );
  const poolSize = rowsOf<{ n: number }>(sizeRes)[0]?.n ?? 0;

  // Years: the requested ones, else every year with assessment data.
  const years = (p.years.length ? [...p.years] : await trendGridYears(db)).sort();
  const subjects = p.subjects
    .map((subject) => ({ subject, grades: tgGradesFor(subject, p.grades) }))
    .filter((s) => s.grades.length > 0);

  // Combined (grade test + Regents takers) codes, used per cell only where the
  // metric actually exists for this measure (e.g. there is no combined mean score).
  let combinedCodes = new Set<string>();
  if (p.useCombined) {
    const cands = subjects.flatMap((s) =>
      s.grades.map((g) => tgCombinedCode(s.subject, g, p.measure)).filter((c): c is string => !!c),
    );
    if (cands.length) {
      const res = await db.execute(sql`select code from metrics where code in ${cands}`);
      combinedCodes = new Set(rowsOf<{ code: string }>(res).map((r) => r.code));
    }
  }

  const codeKey = new Map<string, { subject: TgSubject; grade: TgGrade; combined: boolean }>();
  for (const s of subjects)
    for (const g of s.grades) {
      const cc = tgCombinedCode(s.subject, g, p.measure);
      if (cc && combinedCodes.has(cc)) codeKey.set(cc, { subject: s.subject, grade: g, combined: true });
      else codeKey.set(tgMetricCode(s.subject, g, p.measure), { subject: s.subject, grade: g, combined: false });
    }
  const codes = [...codeKey.keys()];
  if (!codes.length || !years.length) {
    return { ok: true, target, poolLabel, poolSize, years, subjects, cells: [], params: p };
  }

  // Rank every pool member within each (metric, year), then keep the target's
  // row plus the per-cell pool count.
  const rankRes = await db.execute(sql`
    with pool as (
      select id from entities where (${poolWhere}) or id = ${target.id}
    ),
    vals as (
      select m.code, f.school_year, f.entity_id, f.value_numeric as v
      from facts f
      join metrics m on m.id = f.metric_id
      where m.code in ${codes}
        and f.school_year in ${years}
        and f.subgroup = ${p.subgroup}
        and f.value_numeric is not null
        and f.entity_id in (select id from pool)
    ),
    ranked as (
      select code, school_year, entity_id, v,
             rank() over (partition by code, school_year order by v desc) as rnk,
             count(*) over (partition by code, school_year) as n
      from vals
    )
    select code, school_year,
           max(n)::int as n,
           max(rnk) filter (where entity_id = ${target.id})::int as rnk,
           max(v) filter (where entity_id = ${target.id}) as v
    from ranked
    group by code, school_year`);

  // The target's raw facts, to tell a suppressed value ("s") from no data.
  const textRes = await db.execute(sql`
    select m.code, f.school_year, f.value_text
    from facts f join metrics m on m.id = f.metric_id
    where f.entity_id = ${target.id}
      and m.code in ${codes}
      and f.school_year in ${years}
      and f.subgroup = ${p.subgroup}
      and f.value_numeric is null`);

  const key = (code: string, y: string) => `${code}|${y}`;
  const ranked = new Map(
    rowsOf<{ code: string; school_year: string; n: number; rnk: number | null; v: number | null }>(rankRes).map(
      (r) => [key(r.code, r.school_year), r],
    ),
  );
  const texts = new Map(
    rowsOf<{ code: string; school_year: string; value_text: string | null }>(textRes).map((r) => [
      key(r.code, r.school_year),
      r.value_text,
    ]),
  );

  const cells: TrendGridCell[] = [];
  for (const [code, { subject, grade, combined }] of codeKey) {
    for (const year of years) {
      const r = ranked.get(key(code, year));
      const rank = r?.rnk ?? null;
      const n = r?.n ?? 0;
      cells.push({
        subject,
        grade,
        year,
        value: r?.v ?? null,
        text: rank == null ? (texts.get(key(code, year)) ?? null) : null,
        rank,
        n,
        bucket: rank != null ? tgBucket(rank, n, p.buckets) : null,
        combined,
      });
    }
  }
  return { ok: true, target, poolLabel, poolSize, years, subjects, cells, params: p };
}
