import { readFileSync } from 'node:fs';
import { z } from 'zod';

const commitSchema = z
  .string()
  .trim()
  .regex(/^[a-f0-9]{7,64}$/i);
const timestampSchema = z.string().datetime({ offset: true });
const buildIdentitySchema = z
  .object({
    commit: commitSchema.nullable(),
    buildTimestamp: timestampSchema,
  })
  .strict();

export interface BuildIdentity {
  commit: string | null;
  buildTimestamp: string | null;
}

function environmentIdentity(environment: NodeJS.ProcessEnv): BuildIdentity {
  const commit = commitSchema.safeParse(environment['REPOSITORY_SOURCE_COMMIT']?.trim());
  const timestamp = timestampSchema.safeParse(environment['BUILD_TIMESTAMP']?.trim());
  return {
    commit: commit.success ? commit.data : null,
    buildTimestamp: timestamp.success ? timestamp.data : null,
  };
}

/**
 * Resolve identity declared when the executable was built. Container builds point at a generated
 * immutable JSON file; local development may declare the same two values explicitly. Missing
 * values remain null and are never inferred from the working tree or process start time.
 */
export function resolveBuildIdentity(environment: NodeJS.ProcessEnv = process.env): BuildIdentity {
  const metadataPath = environment['PAUL_OS_BUILD_METADATA_PATH']?.trim();
  if (metadataPath === undefined || metadataPath.length === 0) {
    return environmentIdentity(environment);
  }

  const parsed = buildIdentitySchema.safeParse(
    JSON.parse(readFileSync(metadataPath, 'utf8')) as unknown,
  );
  if (!parsed.success) {
    throw new Error(`Build metadata failed validation: ${parsed.error.message}`);
  }
  return parsed.data;
}
