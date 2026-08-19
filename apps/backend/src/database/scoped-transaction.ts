import { Prisma, type PrismaClient } from '@prisma/client';
import { requestPrincipalSchema } from '@agent-builder/contracts';
import { sessionForPrincipal } from '../authorization.js';
import type { RequestPrincipal } from '../request-context.js';

export type RuntimeDatabaseRole = 'api' | 'worker';

const databaseRoleSql: Record<RuntimeDatabaseRole, string> = {
  api: 'SET LOCAL ROLE paul_os_api',
  worker: 'SET LOCAL ROLE paul_os_worker',
};

/**
 * Opens a transaction with a fixed NOLOGIN group role and transaction-local RLS scope.
 * The role name is selected from a closed allowlist; scope values are bound parameters.
 */
export async function withScopedTransaction<T>(
  prisma: PrismaClient,
  principal: RequestPrincipal,
  databaseRole: RuntimeDatabaseRole,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const validated = requestPrincipalSchema.parse(principal);
  const session = sessionForPrincipal(validated);
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(databaseRoleSql[databaseRole]);
    await transaction.$queryRaw(
      Prisma.sql`SELECT set_config('paul_os.workspace_id', ${validated.workspaceId}, true)`,
    );
    await transaction.$queryRaw(
      Prisma.sql`SELECT set_config('paul_os.department_id', ${validated.departmentId ?? ''}, true)`,
    );
    await transaction.$queryRaw(
      Prisma.sql`SELECT set_config('paul_os.roles', ${JSON.stringify(session.effectiveRoles)}, true)`,
    );
    await transaction.$queryRaw(
      Prisma.sql`SELECT set_config('paul_os.permissions', ${JSON.stringify(session.permissions)}, true)`,
    );
    await transaction.$queryRaw(
      Prisma.sql`SELECT set_config('paul_os.is_workspace_admin', ${String(validated.roles.includes('admin'))}, true)`,
    );
    return operation(transaction);
  });
}

export const withApiPrincipalTransaction = <T>(
  prisma: PrismaClient,
  principal: RequestPrincipal,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
) => withScopedTransaction(prisma, principal, 'api', operation);

export const withWorkerPrincipalTransaction = <T>(
  prisma: PrismaClient,
  principal: RequestPrincipal,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
) => withScopedTransaction(prisma, principal, 'worker', operation);
