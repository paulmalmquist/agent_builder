import type { RequestPrincipal } from '../src/request-context.js';
import { aggregateScope, aggregateScopeWhere, isInPrincipalScope } from '../src/scope.js';

const principal = (departmentId: string | null): RequestPrincipal => ({
  actorId: 'human:scope-test',
  workspaceId: '10000000-0000-4000-8000-000000000001',
  departmentId,
  authentication: 'local',
  requestId: 'scope-request',
});

describe('aggregate scope', () => {
  it('stamps writes with the exact principal workspace and department', () => {
    expect(aggregateScope(principal('20000000-0000-4000-8000-000000000002'))).toEqual({
      workspaceId: '10000000-0000-4000-8000-000000000001',
      departmentId: '20000000-0000-4000-8000-000000000002',
    });
  });

  it('lets department principals read workspace-global and own-department records', () => {
    const scopedPrincipal = principal('20000000-0000-4000-8000-000000000002');
    expect(aggregateScopeWhere(scopedPrincipal)).toEqual({
      workspaceId: scopedPrincipal.workspaceId,
      OR: [{ departmentId: null }, { departmentId: scopedPrincipal.departmentId }],
    });
    expect(
      isInPrincipalScope(
        { workspaceId: scopedPrincipal.workspaceId, departmentId: null },
        scopedPrincipal,
      ),
    ).toBe(true);
    expect(
      isInPrincipalScope(
        {
          workspaceId: scopedPrincipal.workspaceId,
          departmentId: scopedPrincipal.departmentId,
        },
        scopedPrincipal,
      ),
    ).toBe(true);
  });

  it('fails closed for sibling departments and other workspaces', () => {
    const scopedPrincipal = principal('20000000-0000-4000-8000-000000000002');
    expect(
      isInPrincipalScope(
        {
          workspaceId: scopedPrincipal.workspaceId,
          departmentId: '30000000-0000-4000-8000-000000000003',
        },
        scopedPrincipal,
      ),
    ).toBe(false);
    expect(
      isInPrincipalScope(
        {
          workspaceId: '40000000-0000-4000-8000-000000000004',
          departmentId: null,
        },
        scopedPrincipal,
      ),
    ).toBe(false);
  });

  it('limits a workspace-level principal to workspace-global records', () => {
    const workspacePrincipal = principal(null);
    expect(aggregateScopeWhere(workspacePrincipal)).toEqual({
      workspaceId: workspacePrincipal.workspaceId,
      departmentId: null,
    });
    expect(
      isInPrincipalScope(
        { workspaceId: workspacePrincipal.workspaceId, departmentId: null },
        workspacePrincipal,
      ),
    ).toBe(true);
    expect(
      isInPrincipalScope(
        {
          workspaceId: workspacePrincipal.workspaceId,
          departmentId: '20000000-0000-4000-8000-000000000002',
        },
        workspacePrincipal,
      ),
    ).toBe(false);
  });
});
