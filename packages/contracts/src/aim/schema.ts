import schema from './program.schema.json' with { type: 'json' };

/** Portable Draft 2020-12 schema. Relationship refinements remain enforced by the Zod contract. */
export const aimProgramJsonSchema = schema as Readonly<Record<string, unknown>>;
