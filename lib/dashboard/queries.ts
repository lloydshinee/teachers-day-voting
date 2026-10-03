import "server-only";

import { z } from "zod";

import {
  getElectionLifecycleView,
  type ElectionLifecycleData,
  type ElectionLifecycleDepartmentRow,
  type ElectionLifecycleTotals,
} from "@/lib/election/queries";

/**
 * Election dashboard + department drill-down reads (spec §14 task 14,
 * dashboard structure §9).
 *
 * Consolidated consumption: delegating directly to the deep Election module's
 * `getElectionLifecycleView`. No vote or Token row is read here.
 *
 * Privacy (spec §7): aggregates only, never voter→choice.
 *
 * Glossary (GLOSSARY.md) is used exactly: Tie, Token, Code, Candidate,
 * Finalist, Winner, Election.
 */

const electionIdSchema = z.uuid();
const departmentIdSchema = z.uuid();

export type DashboardDepartmentRow = ElectionLifecycleDepartmentRow;
export type DashboardTotals = ElectionLifecycleTotals;
export type ElectionDashboardData = ElectionLifecycleData;

export type ElectionDashboardResult =
  | { ok: true; dashboard: ElectionDashboardData }
  | {
      ok: false;
      code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "INVALID_INPUT" | "DB_ERROR";
      message: string;
    };

/**
 * Election dashboard for one Election: delegates directly to the deep
 * Election lifecycle read model.
 */
export async function getElectionDashboard(
  electionId: string,
): Promise<ElectionDashboardResult> {
  const result = await getElectionLifecycleView(electionId);
  if (!result.ok) {
    return result;
  }
  return {
    ok: true,
    dashboard: result.data,
  };
}

export interface DepartmentDrilldownData {
  election: ElectionDashboardData["election"];
  policyVersion: string | null;
  row: DashboardDepartmentRow;
}

export type DepartmentDrilldownResult =
  | { ok: true; drilldown: DepartmentDrilldownData }
  | {
      ok: false;
      code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "INVALID_INPUT" | "DB_ERROR";
      message: string;
    };

/**
 * Department drill-down for one (Election, department): faculty count,
 * faculty Codes, faculty votes, student Codes, student votes, and the Top-3
 * / Finalists with Tie banners. Built on the dashboard composition, so the
 * same aggregate-only guarantee holds — no voter-level rows reach this view.
 */
export async function getDepartmentDrilldown(
  electionId: string,
  departmentId: string,
): Promise<DepartmentDrilldownResult> {
  if (
    !electionIdSchema.safeParse(electionId).success ||
    !departmentIdSchema.safeParse(departmentId).success
  ) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Department not found. It may have been deleted already.",
    };
  }

  const dashboard = await getElectionDashboard(electionId);
  if (!dashboard.ok) {
    return dashboard;
  }

  const row = dashboard.dashboard.departments.find(
    (entry) => entry.department.id === departmentId,
  );
  if (!row) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message: "Department not found. It may have been deleted already.",
    };
  }

  return {
    ok: true,
    drilldown: {
      election: dashboard.dashboard.election,
      policyVersion: dashboard.dashboard.policyVersion,
      row,
    },
  };
}
