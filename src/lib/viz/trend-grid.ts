"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { entityGroups, users } from "@/db/schema";
import { requireUser } from "@/lib/auth/guards";
import { computeTrendGrid, trendGridSubgroups, trendGridYears } from "./trend-grid-core";
import { trendGridParamsSchema, type TrendGridResult } from "./trend-grid-spec";

/** Years + subgroups available for the trend grid controls. */
export async function getTrendGridOptions(): Promise<{ years: string[]; subgroups: string[] }> {
  await requireUser();
  const [years, subgroups] = await Promise.all([trendGridYears(db), trendGridSubgroups(db)]);
  return { years, subgroups };
}

/**
 * Compute a trend grid (bucket rank of the target vs a comparison pool, per
 * subject × grade × year). Params are the chart spec's `params`; validated here.
 */
export async function getTrendGrid(rawParams: unknown): Promise<TrendGridResult> {
  const user = await requireUser();
  const parsed = trendGridParamsSchema.safeParse(rawParams ?? {});
  if (!parsed.success) return { ok: false, error: "Those trend grid settings aren't valid." };
  const p = parsed.data;

  let targetId = p.targetId ?? null;
  if (targetId == null) {
    const [me] = await db.select({ h: users.homeDistrictId }).from(users).where(eq(users.id, user.id));
    targetId = me?.h ?? null;
  }
  if (targetId == null) return { ok: false, error: "Choose a district (or set your home district) to rank." };

  // A group pool must be one of the user's own groups.
  let groupIds: number[] | null = null;
  if (p.pool.kind === "group") {
    if (p.pool.groupId == null) return { ok: false, error: "Choose a saved group to compare against." };
    const [g] = await db
      .select({ ids: entityGroups.entityIds, name: entityGroups.name })
      .from(entityGroups)
      .where(and(eq(entityGroups.id, p.pool.groupId), eq(entityGroups.userId, user.id)));
    if (!g) return { ok: false, error: "That saved group wasn't found." };
    groupIds = (g.ids ?? []).filter((n) => Number.isInteger(n));
    p.pool.groupName = g.name;
  }
  if (p.pool.kind === "counties" && p.pool.counties.length === 0) {
    return { ok: false, error: "Choose at least one county to compare against." };
  }

  try {
    return await computeTrendGrid(db, { ...p, targetId }, groupIds);
  } catch (e) {
    console.error("trend grid query failed", e);
    return { ok: false, error: "Couldn't compute the trend grid." };
  }
}
