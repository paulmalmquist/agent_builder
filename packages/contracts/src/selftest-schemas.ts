import { z } from 'zod';

export const SELFTEST_SCHEMA_VERSION = 'paul-os.selftest/v1' as const;

export const selfTestStatusSchema = z.enum(['PASS', 'FAIL', 'SKIPPED']);
export type SelfTestStatus = z.infer<typeof selfTestStatusSchema>;

export const selfTestResultSchema = z
  .object({
    id: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$/)
      .max(120),
    width: z.number().int().positive().max(10_000),
    status: selfTestStatusSchema,
    description: z.string().trim().min(1).max(500),
    expected: z.string().trim().min(1).max(2_000),
    actual: z.string().trim().min(1).max(4_000),
    route: z.string().trim().startsWith('/').max(1_000),
  })
  .strict();
export type SelfTestResult = z.infer<typeof selfTestResultSchema>;

export const selfTestSummarySchema = z
  .object({
    pass: z.number().int().nonnegative(),
    fail: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  })
  .strict();
export type SelfTestSummary = z.infer<typeof selfTestSummarySchema>;

export const selfTestReportSchema = z
  .object({
    schemaVersion: z.literal(SELFTEST_SCHEMA_VERSION),
    commit: z
      .string()
      .trim()
      .regex(/^[a-f0-9]{7,64}$/i)
      .nullable(),
    generatedAt: z.string().datetime({ offset: true }),
    widths: z.array(z.number().int().positive().max(10_000)).min(1).max(10),
    summary: selfTestSummarySchema,
    results: z.array(selfTestResultSchema).max(1_000),
  })
  .strict()
  .superRefine((report, context) => {
    const expectedSummary: SelfTestSummary = { pass: 0, fail: 0, skipped: 0 };
    for (const result of report.results) {
      expectedSummary[result.status.toLowerCase() as keyof SelfTestSummary] += 1;
      if (!report.widths.includes(result.width)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Every result width must be declared in the report width matrix.',
          path: ['results'],
        });
        break;
      }
    }
    for (const key of ['pass', 'fail', 'skipped'] as const) {
      if (report.summary[key] !== expectedSummary[key]) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Summary ${key} count must match the result rows.`,
          path: ['summary', key],
        });
      }
    }
    if (new Set(report.widths).size !== report.widths.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Report widths must be unique.',
        path: ['widths'],
      });
    }
  });
export type SelfTestReport = z.infer<typeof selfTestReportSchema>;

export function summarizeSelfTestResults(
  results: ReadonlyArray<Pick<SelfTestResult, 'status'>>,
): SelfTestSummary {
  const summary: SelfTestSummary = { pass: 0, fail: 0, skipped: 0 };
  for (const result of results) {
    summary[result.status.toLowerCase() as keyof SelfTestSummary] += 1;
  }
  return summary;
}
