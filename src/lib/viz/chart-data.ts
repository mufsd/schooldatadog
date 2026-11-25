// Compact, model-friendly text of what the chart is actually showing, so Scout
// answers "how many are above us?" from the plotted numbers instead of guessing.
// Ranks and summary stats are computed here — small models miscount when asked
// to sort or compare a column of numbers themselves.

import type { ResolvedColumn, Row } from "./resolve";
import type { TrendGridResult } from "./trend-grid-spec";

const FULL_ROW_LIMIT = 150; // above this, send summaries + extremes + the home district
const EDGE_ROWS = 15;
const MAX_CHARS = 16000;

const fmt = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  return String(v).replace(/[\n,]/g, " ");
};

type Ranked = { rank: number; n: number };

/** Competition rank (1 = highest; ties share the better rank) of each row's
 *  value in `col`, within its school year. */
function rankByYear(rows: Row[], col: string): Map<Row, Ranked> {
  const byYear = new Map<string, Row[]>();
  for (const r of rows) {
    if (typeof r[col] !== "number") continue;
    const y = String(r.year ?? "");
    (byYear.get(y) ?? byYear.set(y, []).get(y)!).push(r);
  }
  const out = new Map<Row, Ranked>();
  for (const list of byYear.values()) {
    const sorted = [...list].sort((a, b) => (b[col] as number) - (a[col] as number));
    let rank = 0;
    sorted.forEach((r, i) => {
      if (i === 0 || (r[col] as number) !== (sorted[i - 1][col] as number)) rank = i + 1;
      out.set(r, { rank, n: sorted.length });
    });
  }
  return out;
}

function stats(vals: number[]) {
  const s = [...vals].sort((a, b) => a - b);
  const n = s.length;
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  return `n=${n}, mean=${fmt(mean)}, median=${fmt(median)}, min=${fmt(s[0])}, max=${fmt(s[n - 1])}`;
}

export function chartDataText(rows: Row[], columns: ResolvedColumn[]): string {
  const valueCols = columns.filter((c) => c.kind === "field");
  if (!rows.length || !valueCols.length) return "(nothing plotted yet)";

  const ranks = new Map(valueCols.map((c) => [c.id, rankByYear(rows, c.id)]));
  const isHome = (r: Row) => r.homeDistrict === "My district";
  const header = ["entity", "county", "year", "my_district", ...valueCols.flatMap((c) => [c.label, `${c.label} rank`])];
  const line = (r: Row) =>
    [
      fmt(r.entityName),
      fmt(r.county),
      fmt(r.year),
      isHome(r) ? "yes" : "",
      ...valueCols.flatMap((c) => {
        const rk = ranks.get(c.id)!.get(r);
        return [fmt(r[c.id]), rk ? `${rk.rank} of ${rk.n}` : ""];
      }),
    ].join(",");

  const parts: string[] = [
    `${rows.length} plotted rows (one per entity per year). Blank value = no data or suppressed. ` +
      `"rank" = position within that year among the plotted entities that have a value (1 = highest; ties share a rank).`,
  ];

  // Summary per value column per year (always included).
  const years = [...new Set(rows.map((r) => String(r.year ?? "")))].sort();
  for (const c of valueCols) {
    for (const y of years) {
      const vals = rows.filter((r) => String(r.year ?? "") === y && typeof r[c.id] === "number").map((r) => r[c.id] as number);
      if (vals.length) parts.push(`Summary — ${c.label}${years.length > 1 ? ` (${y})` : ""}: ${stats(vals)}`);
    }
  }

  if (rows.length <= FULL_ROW_LIMIT) {
    const sorted = [...rows].sort((a, b) => {
      const k = valueCols[0].id;
      const av = typeof a[k] === "number" ? (a[k] as number) : -Infinity;
      const bv = typeof b[k] === "number" ? (b[k] as number) : -Infinity;
      return String(a.year).localeCompare(String(b.year)) || bv - av;
    });
    parts.push("All rows (sorted by year, then by the first value, high → low):", header.join(","), ...sorted.map(line));
  } else {
    const k = valueCols[0].id;
    const withVal = rows.filter((r) => typeof r[k] === "number");
    const desc = [...withVal].sort((a, b) => (b[k] as number) - (a[k] as number));
    parts.push(
      `Too many rows to list; showing the user's district, then the top and bottom ${EDGE_ROWS} by "${valueCols[0].label}" (all years together).`,
      header.join(","),
      "-- my district --",
      ...rows.filter(isHome).map(line),
      `-- top ${EDGE_ROWS} --`,
      ...desc.slice(0, EDGE_ROWS).map(line),
      `-- bottom ${EDGE_ROWS} --`,
      ...desc.slice(-EDGE_ROWS).map(line),
    );
  }

  const text = parts.join("\n");
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n…(truncated)` : text;
}

export function trendGridText(res: TrendGridResult | null): string {
  if (!res) return "(the trend grid is still loading)";
  if (!res.ok) return `(the trend grid could not be computed: ${res.error})`;
  const lines = [
    `Trend grid for ${res.target.name}, compared with ${res.poolLabel} (${res.poolSize} in the pool). ` +
      `bucket 1 = top group. rank is among pool members that reported a value for that grade/year.`,
    "subject,grade,year,value,rank,reporting,bucket,includes_regents_takers",
    ...res.cells.map((c) =>
      [
        c.subject,
        c.grade,
        c.year,
        c.value ?? c.text ?? "",
        c.rank ?? "",
        c.n || "",
        c.bucket ?? "",
        c.combined ? "yes" : "",
      ].join(","),
    ),
  ];
  return lines.join("\n");
}
