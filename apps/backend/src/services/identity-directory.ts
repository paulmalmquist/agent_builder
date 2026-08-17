import { ExternalIdentityProvider, PlatformRole, Prisma, type PrismaClient } from '@prisma/client';
import { requestPrincipalSchema, type PlatformRoleValue } from '@agent-builder/contracts';
import { AppError } from '../errors.js';
import type { ExternalIdentityResolution, IdentityDirectory } from '../identity-auth.js';

const providerMap = {
  fixture_oidc: ExternalIdentityProvider.FIXTURE_OIDC,
  oidc: ExternalIdentityProvider.OIDC,
} as const;

const roleMap: Record<PlatformRole, PlatformRoleValue> = {
  [PlatformRole.CONSUMER]: 'consumer',
  [PlatformRole.BUILDER]: 'builder',
  [PlatformRole.OWNER]: 'owner',
  [PlatformRole.ADMIN]: 'admin',
};

export class PrismaIdentityDirectory implements IdentityDirectory {
  constructor(private readonly prisma: PrismaClient) {}

  async resolveExternal(input: ExternalIdentityResolution) {
    // Token groups are intentionally ignored. Authorization is exclusively persisted RoleBindings.
    void input.identity.groups;
    return this.prisma.$transaction(
      async (transaction) => {
        const mapping = await transaction.externalIdentity.findUnique({
          where: {
            workspaceId_issuer_subject: {
              workspaceId: input.workspaceId,
              issuer: input.identity.issuer,
              subject: input.identity.subject,
            },
          },
          include: {
            principal: {
              include: {
                roleBindings: { where: { revokedAt: null } },
              },
            },
          },
        });
        if (
          mapping === null ||
          mapping.provider !== providerMap[input.provider] ||
          !mapping.principal.active
        ) {
          throw new AppError(
            401,
            'IDENTITY_NOT_MAPPED',
            'The verified external identity is not active in this workspace',
          );
        }

        const homeDepartmentId = mapping.principal.homeDepartmentId;
        const roles = Array.from(
          new Set(
            mapping.principal.roleBindings
              .filter(
                (binding) =>
                  binding.projectInstanceId === null &&
                  (binding.scopeKey === 'workspace' ||
                    (homeDepartmentId !== null && binding.departmentId === homeDepartmentId)),
              )
              .map((binding) => roleMap[binding.role]),
          ),
        );
        if (roles.length === 0) {
          throw new AppError(
            403,
            'AUTHORIZATION_REQUIRED',
            'The verified principal has no active workspace or home-department role',
          );
        }

        await transaction.externalIdentity.update({
          where: { id: mapping.id },
          data: { lastSeenAt: new Date() },
        });
        return requestPrincipalSchema.omit({ requestId: true }).parse({
          principalId: mapping.principal.id,
          actorId: mapping.principal.actorId,
          workspaceId: mapping.principal.workspaceId,
          departmentId: homeDepartmentId,
          authentication: input.authentication,
          roles,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
