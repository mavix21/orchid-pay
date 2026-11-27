import { type SQL, isNull, lt, or } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import * as DateTime from "effect/DateTime";
import { sweepStuckAge } from "../policy";

export const notCheckedSince = (
  checkedAt: PgColumn,
  runStartedAt: DateTime.Utc,
): SQL | undefined =>
  or(isNull(checkedAt), lt(checkedAt, DateTime.toDateUtc(runStartedAt)));

export const stuckSince = (now: DateTime.Utc) =>
  DateTime.toDateUtc(DateTime.subtract(now, { seconds: sweepStuckAge }));
