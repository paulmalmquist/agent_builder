import type { RequestPrincipal } from './request-context.js';
import { currentRequestPrincipal } from './request-context.js';

export interface AggregateScope {
  workspaceId: string;
  departmentId: string | null;
}

export type AggregateScopeWhere =
  | { workspaceId: string; departmentId: null }
  | {
      workspaceId: string;
      OR: [{ departmentId: null }, { departmentId: string }];
    };

export function aggregateScope(
  principal: RequestPrincipal = currentRequestPrincipal(),
): AggregateScope {
  return {
    workspaceId: principal.workspaceId,
    departmentId: principal.departmentId,
  };
}

/**
 * Department-scoped actors may read workspace-global records and records belonging to
 * their own department. A workspace-level actor may read workspace-global records only.
 */
export function aggregateScopeWhere(
  principal: RequestPrincipal = currentRequestPrincipal(),
): AggregateScopeWhere {
  if (principal.departmentId === null) {
    return { workspaceId: principal.workspaceId, departmentId: null };
  }
  return {
    workspaceId: principal.workspaceId,
    OR: [{ departmentId: null }, { departmentId: principal.departmentId }],
  };
}

export function isInPrincipalScope(
  record: AggregateScope,
  principal: RequestPrincipal = currentRequestPrincipal(),
): boolean {
  return (
    record.workspaceId === principal.workspaceId &&
    (record.departmentId === null || record.departmentId === principal.departmentId)
  );
}
