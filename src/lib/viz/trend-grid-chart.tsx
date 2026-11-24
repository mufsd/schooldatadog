"use client";

import { useEffect, useRef, useState } from "react";
import type { View } from "vega";
import type { ChartSpec } from "./spec";
import {
  tgGradeLabel,
  TG_BUCKET_LABEL,
  TG_MEASURE_LABEL,
  TG_SUBJECT_LABEL,
  type TrendGridResult,
} from "./trend-grid-spec";

type OkResult = Extract<TrendGridResult, { ok: true }>;

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const mix = (a: string, b: string, t: number) => {
  const A = hex(a);
  const B = hex(b);
  return toHex(A.map((v, i) => v + (B[i] - v) * t));
};

/** Fill + text colour for bucket 1..B (1 = darkest). */
function bucketColors(theme: ChartSpec["theme"], buckets: number) {
  const [dark, light] = theme === "print" ? ["#111827", "#e5e7eb"] : ["#0b1f4d", "#dbe5f4"];
  return Array.from({ length: buckets }, (_, i) => {
    const t = buckets === 1 ? 0 : i / (buckets - 1);
    return { fill: mix(dark, light, t), text: t <= 0.5 ? "#ffffff" : dark };
  });
}
const EMPTY_FILL = "#f7f1e1"; // year/grade with no data (cream, as on the slide)
const SUPPRESSED_FILL = "#eceff3";

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};
/** "2022-23" → "'23" (the spring of the school year, as on report-card slides). */
const shortYear = (y: string) => {
  const m = /^\d{4}-(\d{2})$/.exec(y);
  return m ? `'${m[1]}` : y;
};

function footnote(r: OkResult): string[] {
  const B = r.params.buckets;
  const step = 100 / B;
  const noun = r.target.type === "district" ? "districts" : "schools";
  const unit = TG_BUCKET_LABEL[B]?.toLowerCase().replace(/s$/, "") ?? "bucket";
  const parts = [
    `1 = ${TG_MEASURE_LABEL[r.params.measure].toLowerCase()} higher than ${100 - step}% of ${noun}`,
    B > 2 ? `2 = higher than ${100 - 2 * step}%` : null,
    "…",
    `${B} = lowest ${step}%`,
  ].filter(Boolean);
  const starred = [
    ...new Set(r.cells.filter((c) => c.combined).map((c) => `${TG_SUBJECT_LABEL[c.subject]} ${tgGradeLabel(c.subject, c.grade)}`)),
  ];
  return [
    `Each cell is ${r.target.name}'s ${unit} rank among ${r.poolLabel} (${r.params.subgroup}) for that grade and year: ${parts.join(", ")}.`,
    `Ranked among ${noun} with a reported value; ties share the higher rank. Blank = no data that year; s = suppressed. Hover a cell for the value and rank.`,
    ...(starred.length
      ? [
          `* ${starred.join(", ")}: NYSED "combined" results, which include students who took a Regents exam instead of the grade-level test (e.g. accelerated 8th graders in Algebra I).`,
        ]
      : []),
  ];
}

/** Build the Vega-Lite spec (exported for scripted checks). */
export function trendGridVegaLite(r: OkResult, spec: ChartSpec, zoom: number, width: number) {
  const B = r.params.buckets;
  const colors = bucketColors(spec.theme, B);
  const unitLabel = TG_BUCKET_LABEL[B]?.replace(/s$/, "") ?? "Bucket";
  const noun = r.target.type === "district" ? "districts" : "schools";
  const pct = r.params.measure !== "mean_score";
  const yearLabels = r.years.map(shortYear);
  const cellW = Math.round(54 * zoom);
  const cellH = Math.round(32 * zoom);
  const fontSize = Math.round(14 * zoom);

  const grids = r.subjects.map(({ subject, grades }) => {
    // Rows: highest grade on top (as on the slide), the combined row last.
    const ordered = [...grades.filter((g) => g !== "all").sort((a, b) => Number(b) - Number(a)), ...grades.filter((g) => g === "all")];
    // Rows on "combined" results (incl. Regents takers) are starred: G8*.
    const starred = new Set(r.cells.filter((c) => c.subject === subject && c.combined).map((c) => c.grade));
    const rowLabel = (g: (typeof ordered)[number]) => `${tgGradeLabel(subject, g)}${starred.has(g) ? "*" : ""}`;
    const gradeLabels = ordered.map(rowLabel);
    const values = r.cells
      .filter((c) => c.subject === subject)
      .map((c) => {
        const col = c.bucket != null ? colors[c.bucket - 1] : null;
        return {
          grade: rowLabel(c.grade),
          yr: shortYear(c.year),
          label: c.bucket != null ? String(c.bucket) : c.text ? c.text : "",
          fill: col ? col.fill : c.text ? SUPPRESSED_FILL : EMPTY_FILL,
          ink: col ? col.text : "#64748b",
          Subject: TG_SUBJECT_LABEL[subject],
          Grade: `${c.grade === "all" ? `Grades ${tgGradeLabel(subject, c.grade)}` : `Grade ${c.grade}`}${c.combined ? " (incl. Regents takers)" : ""}`,
          Year: c.year,
          Value:
            c.value != null
              ? `${Number.isInteger(c.value) ? c.value : c.value.toFixed(1)}${pct ? "%" : ""}`
              : c.text === "s"
                ? "suppressed"
                : (c.text ?? "no data"),
          Rank: c.rank != null ? `${ordinal(c.rank)} of ${c.n}` : "—",
          [unitLabel]: c.bucket != null ? `${c.bucket} of ${B}` : "—",
          Pool: `${c.n} ${noun} reporting (of ${r.poolSize} in pool)`,
        };
      });
    const tooltip = ["Subject", "Grade", "Year", "Value", "Rank", unitLabel, "Pool"].map((f) => ({ field: f, type: "nominal" }));
    return {
      title: { text: TG_SUBJECT_LABEL[subject], fontSize: Math.round(15 * zoom), anchor: "middle" },
      width: cellW * r.years.length,
      height: cellH * ordered.length,
      data: { values },
      encoding: {
        x: {
          field: "yr",
          type: "ordinal",
          sort: yearLabels,
          scale: { domain: yearLabels },
          axis: { orient: "top", title: null, labelAngle: 0, domain: false, ticks: false, labelFontSize: Math.round(12 * zoom) },
        },
        y: {
          field: "grade",
          type: "ordinal",
          sort: gradeLabels,
          scale: { domain: gradeLabels },
          axis: { title: null, domain: false, ticks: false, labelFontSize: Math.round(12 * zoom), labelFontWeight: "bold" },
        },
        tooltip,
      },
      layer: [
        {
          mark: { type: "rect", stroke: "#ffffff", strokeWidth: 2 },
          encoding: { fill: { field: "fill", type: "nominal", scale: null } },
        },
        {
          mark: { type: "text", fontSize, fontWeight: "bold" },
          encoding: {
            text: { field: "label", type: "nominal" },
            color: { field: "ink", type: "nominal", scale: null },
          },
        },
      ],
    };
  });

  // Colour key: 1 … B.
  const key = {
    title: { text: `${TG_BUCKET_LABEL[B]} (1 = top)`, fontSize: Math.round(11 * zoom), anchor: "start", fontWeight: "normal", color: "#475569" },
    width: Math.round(26 * zoom) * B,
    height: Math.round(20 * zoom),
    data: { values: colors.map((c, i) => ({ b: String(i + 1), fill: c.fill, ink: c.text })) },
    encoding: {
      x: { field: "b", type: "ordinal", sort: null, axis: null },
    },
    layer: [
      { mark: { type: "rect", stroke: "#ffffff", strokeWidth: 1 }, encoding: { fill: { field: "fill", type: "nominal", scale: null } } },
      {
        mark: { type: "text", fontSize: Math.round(11 * zoom), fontWeight: "bold" },
        encoding: { text: { field: "b", type: "nominal" }, color: { field: "ink", type: "nominal", scale: null } },
      },
    ],
  };

  // Footnote, word-wrapped to the width of the grids (min 360px).
  const gridsW =
    r.subjects.length * (cellW * r.years.length + Math.round(40 * zoom)) +
    Math.max(0, r.subjects.length - 1) * Math.round(40 * zoom);
  const noteW = Math.max(360, Math.min(gridsW, Math.max(360, width)));
  const noteFont = Math.round(11 * zoom);
  const perLine = Math.max(30, Math.floor(noteW / (noteFont * 0.56)));
  const notes = footnote(r).flatMap((para) => {
    const lines: string[] = [];
    let cur = "";
    for (const w of para.split(" ")) {
      if (cur && (cur + " " + w).length > perLine) {
        lines.push(cur);
        cur = w;
      } else cur = cur ? `${cur} ${w}` : w;
    }
    if (cur) lines.push(cur);
    return lines;
  });
  const lineH = Math.round(noteFont * 1.45);
  const noteView = {
    width: noteW,
    height: lineH * notes.length,
    data: { values: notes.map((t, i) => ({ t, y: i * lineH })) },
    mark: { type: "text", align: "left", baseline: "top", fontSize: noteFont, color: "#475569" },
    encoding: {
      x: { value: 0 },
      y: { field: "y", type: "quantitative", axis: null, scale: null },
      text: { field: "t", type: "nominal" },
    },
  };

  const title =
    spec.title ??
    `${r.params.subjects.map((s) => TG_SUBJECT_LABEL[s]).join("/")} Trend Grid — ${r.target.name} compared to ${r.poolLabel}`;
  const subtitle = `${TG_MEASURE_LABEL[r.params.measure]} · ${r.params.subgroup} · ${TG_BUCKET_LABEL[B]}`;

  return {
    $schema: "https://vega.github.io/schema/vega-lite/v6.json",
    background: "#ffffff",
    padding: 12,
    title: { text: title, subtitle, subtitleColor: "#64748b", subtitleFontSize: 12 },
    vconcat: [{ hconcat: grids, spacing: Math.round(40 * zoom) }, key, noteView],
    spacing: Math.round(18 * zoom),
    config: { view: { stroke: null }, axis: { grid: false } },
  };
}

/** Renders a trend grid result with Vega-Lite (so it shares SVG/PNG export). */
export function TrendGridChart({
  result,
  spec,
  zoom = 1,
  onView,
}: {
  result: OkResult;
  spec: ChartSpec;
  zoom?: number;
  onView?: (view: View | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const onViewRef = useRef(onView);
  useEffect(() => {
    onViewRef.current = onView;
  }, [onView]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWidth((w) => (Math.abs(w - el.clientWidth) > 8 ? Math.floor(el.clientWidth) : w));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (width < 40) return;
    let cancelled = false;
    let finalize: (() => void) | undefined;
    (async () => {
      const el = ref.current;
      if (!el) return;
      setError(null);
      try {
        const embed = (await import("vega-embed")).default;
        if (cancelled) return;
        const res = await embed(el, trendGridVegaLite(result, spec, zoom, width - 40) as never, {
          renderer: "svg",
          actions: false,
          config: { font: "inherit", title: { font: "inherit", color: "#0f172a", fontSize: 16, anchor: "start" } } as never,
        });
        if (cancelled) {
          res.finalize();
          return;
        }
        finalize = res.finalize;
        onViewRef.current?.(res.view);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not render this chart.");
          onViewRef.current?.(null);
        }
      }
    })();
    return () => {
      cancelled = true;
      onViewRef.current?.(null);
      finalize?.();
    };
  }, [result, spec, zoom, width]);

  return (
    <div ref={wrapRef} className="h-full w-full overflow-auto">
      <div ref={ref} />
      {error && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          {error}
        </p>
      )}
    </div>
  );
}
