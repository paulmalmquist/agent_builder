import type { PrismaClient, ProjectInstance } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../errors.js';
import { currentRequestPrincipal, type RequestPrincipal } from '../request-context.js';
import { withApiPrincipalTransaction } from '../database/scoped-transaction.js';

const createProjectInstanceSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(120),
    name: z.string().trim().min(2).max(200),
    departmentId: z.string().uuid().nullable(),
  })
  .strict();

export class ProjectInstanceService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(principal: RequestPrincipal = currentRequestPrincipal()): Promise<ProjectInstance[]> {
    return withApiPrincipalTransaction(this.prisma, principal, (transaction) =>
      transaction.projectInstance.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    );
  }

  async create(
    rawInput: z.input<typeof createProjectInstanceSchema>,
    principal: RequestPrincipal = currentRequestPrincipal(),
  ): Promise<ProjectInstance> {
    const input = createProjectInstanceSchema.parse(rawInput);
    const isWorkspaceAdmin = principal.roles.includes('admin');
    if (
      !isWorkspaceAdmin &&
      (principal.departmentId === null || input.departmentId !== principal.departmentId)
    ) {
      throw new AppError(
        403,
        'SCOPE_MISMATCH',
        'Department roles can only create projects in their assigned department',
      );
    }
    return withApiPrincipalTransaction(this.prisma, principal, (transaction) =>
      transaction.projectInstance.create({
        data: {
          workspaceId: principal.workspaceId,
          departmentId: input.departmentId,
          slug: input.slug,
          name: input.name,
          createdBy: principal.actorId,
        },
      }),
    );
  }
}
