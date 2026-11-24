// Trend grid — a "decile rank over time" chart (engine "trendgrid").
//
// For one target entity, each cell is the target's bucket rank (1 = top) within
// a comparison pool, for one subject × grade × school year, on the NYSED Grades
// 3-8 / Science state-assessment metrics (src_em_*). All parameters live in the
// chart spec's free `params` record and are validated by the schema below.
// Shared by the client (controls/renderer) and the server (ranking query).

import { z } from "zod";

export const TG_SUBJECTS = ["ela", "math", "science"] as const;
export type TgSubject = (typeof TG_SUBJECTS)[number];
export const TG_SUBJECT_LABEL: Record<TgSubject, string> = { ela: "ELA", math: "Math", science: "Science" };

/** Single grades plus the "combined" row (3–8 for ELA/Math, 5–8 for Science). */
export const TG_GRADES = ["3", "4", "5", "6", "7", "8", "all"] as const;
export type TgGrade = (typeof TG_GRADES)[number];
/** Which single grades each subject is tested in. */
export const TG_SUBJECT_GRADES: Record<TgSubject, TgGrade[]> = {
  ela: ["3", "4", "5", "6", "7", "8"],
  math: ["3", "4", "5", "6", "7", "8"],
  science: ["5", "8"],
};

export const TG_MEASURES = ["proficient_pct", "mean_score", "tested_pct"] as const;
export type TgMeasure = (typeof TG_MEASURES)[number];
export const TG_MEASURE_LABEL: Record<TgMeasure, string> = {
  proficient_pct: "Proficiency rate",
  mean_score: "Mean scale score",
  tested_pct: "Participation rate",
};

export const TG_BUCKETS = [10, 5, 4] as const;
export const TG_BUCKET_LABEL: Record<number, string> = { 10: "Deciles", 5: "Quintiles", 4: "Quartiles" };

export const trendGridParamsSchema = z.object({
  /** Entity to rank (district or school). null → the user's home district. */
  targetId: z.number().int().nullish(),
  /** What the target is compared against. Always same-type entities as the target. */
  pool: z
    .object({
      kind: z.enum(["state", "counties", "group"]).default("state"),
      counties: z.array(z.string()).default([]),
      groupId: z.number().int().nullish(),
      groupName: z.string().nullish(),
    })
    .default({ kind: "state", counties: [] }),
  /** School years (columns). Empty → every year that has assessment data. */
  years: z.array(z.string()).default([]),
  subgroup: z.string().default("All Students"),
  subjects: z.array(z.enum(TG_SUBJECTS)).min(1).default(["ela", "math"]),
  grades: z.array(z.enum(TG_GRADES)).min(1).default(["3", "4", "5", "6", "7", "8"]),
  measure: z.enum(TG_MEASURES).default("proficient_pct"),
  buckets: z.union([z.literal(10), z.literal(5), z.literal(4)]).default(10),
  /** Grades 6-8: use NYSED's "combined" results (grade test + Regents takers)
   *  where such a metric exists for the cell; otherwise the plain grade metric. */
  useCombined: z.boolean().default(false),
});
export type TrendGridParams = z.infer<typeof trendGridParamsSchema>;

/** Parse a spec's `params` into trend-grid params, filling defaults (never throws). */
export function parseTrendGridParams(raw: unknown): TrendGridParams {
  const r = trendGridParamsSchema.safeParse(raw ?? {});
  return r.success ? r.data : trendGridParamsSchema.parse({});
}

/** Metric code for a subject/grade/measure, e.g. src_em_ela_proficient_pct_g4. */
export function tgMetricCode(subject: TgSubject, grade: TgGrade, measure: TgMeasure): string {
  const g = grade === "all" ? (subject === "science" ? "5_8" : "3_8") : grade;
  return `src_em_${subject}_${measure}_g${g}`;
}

/** Grades that have a "combined" (grade test + Regents takers) variant. */
export const TG_COMBINED_GRADES: Record<TgSubject, TgGrade[]> = { ela: [], math: ["6", "7", "8"], science: ["8"] };

/** Candidate combined metric code for a cell, or null if the subject/grade has none.
 *  (Whether it exists for the measure is checked against the metrics table.) */
export function tgCombinedCode(subject: TgSubject, grade: TgGrade, measure: TgMeasure): string | null {
  return TG_COMBINED_GRADES[subject].includes(grade) ? `src_em_${subject}_${measure}_g${grade}_combined` : null;
}

/** Row label for a grade in a subject's grid. */
export function tgGradeLabel(subject: TgSubject, grade: TgGrade): string {
  if (grade === "all") return subject === "science" ? "5–8" : "3–8";
  return `G${grade}`;
}

/** Grades (in requested order) that a subject actually has. */
export function tgGradesFor(subject: TgSubject, grades: TgGrade[]): TgGrade[] {
  const ok = new Set<TgGrade>([...TG_SUBJECT_GRADES[subject], "all"]);
  return grades.filter((g) => ok.has(g));
}

/**
 * Bucket for a competition rank (1 = best; ties share the best rank) within a
 * pool of n: 1 + floor(B × share of the pool that scored strictly higher).
 * So with deciles, 1 = fewer than 10% of the pool did better ("better than
 * 90%"), 10 = 90%+ of the pool did better (the lowest tenth).
 */
export function tgBucket(rank: number, n: number, buckets: number): number {
  if (n <= 0) return 1;
  return Math.min(buckets, 1 + Math.floor(((rank - 1) / n) * buckets));
}

export type TrendGridCell = {
  subject: TgSubject;
  grade: TgGrade;
  year: string;
  value: number | null;
  /** Non-numeric value (e.g. "s" = suppressed) when the target has no number. */
  text: string | null;
  rank: number | null;
  /** Pool entities with a reported value for this cell (target included). */
  n: number;
  bucket: number | null;
  /** True when the cell uses the "combined" (incl. Regents takers) metric. */
  combined: boolean;
};

export type TrendGridResult =
  | {
      ok: true;
      target: { id: number; name: string; type: "district" | "school" };
      poolLabel: string;
      /** Entities in the comparison pool (target included), before data filtering. */
      poolSize: number;
      years: string[];
      subjects: { subject: TgSubject; grades: TgGrade[] }[];
      cells: TrendGridCell[];
      params: TrendGridParams;
    }
  | { ok: false; error: string };
