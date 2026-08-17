import type { RequestHandler } from 'express';
import {
  platformRoleSchema,
  type PlatformRoleValue,
  type SessionResponse,
} from '@agent-builder/contracts';
import { AppError } from './errors.js';
import { currentRequestPrincipal, type RequestPrincipal } from './request-context.js';

const roleRank: Record<PlatformRoleValue, number> = {
  consumer: 0,
  builder: 1,
  owner: 2,
  admin: 3,
};

const orderedRoles: PlatformRoleValue[] = ['consumer', 'builder', 'owner', 'admin'];

export function effectiveRoles(assigned: readonly PlatformRoleValue[]): PlatformRoleValue[] {
  const maximum = assigned.reduce((rank, role) => Math.max(rank, roleRank[role]), -1);
  return orderedRoles.filter((role) => roleRank[role] <= maximum);
}

export function hasMinimumRole(
  principal: Pick<RequestPrincipal, 'roles'>,
  minimum: PlatformRoleValue,
): boolean {
  return effectiveRoles(principal.roles).includes(minimum);
}

export function requireMinimumRole(minimum: PlatformRoleValue): RequestHandler {
  platformRoleSchema.parse(minimum);
  return (_request, _response, next) => {
    const principal = currentRequestPrincipal();
    if (!hasMinimumRole(principal, minimum)) {
      next(
        new AppError(403, 'AUTHORIZATION_REQUIRED', `This operation requires the ${minimum} role`, {
          requiredRole: minimum,
        }),
      );
      return;
    }
    next();
  };
}

export function sessionForPrincipal(principal: RequestPrincipal): SessionResponse {
  const roles = effectiveRoles(principal.roles);
  const permissions: SessionResponse['permissions'] = [];
  if (roles.includes('consumer')) permissions.push('catalog:read', 'runs:execute');
  if (roles.includes('builder')) permissions.push('builder:author');
  if (roles.includes('owner')) permissions.push('evidence:review', 'release:govern');
  if (roles.includes('admin')) permissions.push('platform:administer');
  return {
    principal,
    effectiveRoles: roles,
    permissions,
    authorizationModel: 'workspace-role-v1',
  };
}
