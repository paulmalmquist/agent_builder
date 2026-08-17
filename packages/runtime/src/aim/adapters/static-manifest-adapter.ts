import type { AimProgramLoadOptions, AimProgramLoadResult } from '../program-loader.js';
import { loadAimProgram } from '../program-loader.js';

/** Level 0 adapter for a checked-in JSON string or already-decoded fixture. */
export class StaticAimManifestAdapter {
  readonly kind = 'static_manifest';

  constructor(
    private readonly input: unknown,
    private readonly options?: AimProgramLoadOptions,
  ) {}

  load(): AimProgramLoadResult {
    return loadAimProgram(this.input, this.options);
  }
}
