import type { AimProgramLoadOptions, AimProgramLoadResult } from '../program-loader.js';
import { loadAimProgram } from '../program-loader.js';

export interface AimLocalTextFile {
  name: string;
  size: number;
  text(): Promise<string>;
}

const fileError = (code: string, message: string): AimProgramLoadResult => ({
  ok: false,
  manifest: null,
  issues: [{ code, path: [], message }],
});

/** Level 1 browser-compatible loader seam. It performs no network or File System API calls. */
export async function loadAimProgramFile(
  file: AimLocalTextFile,
  options: AimProgramLoadOptions = {},
): Promise<AimProgramLoadResult> {
  if (!file.name.toLowerCase().endsWith('.json')) {
    return fileError('unsupported_file_type', 'AIM manifests must use a .json file');
  }
  const maxBytes = options.maxBytes ?? 2_000_000;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    return fileError('invalid_loader_option', 'maxBytes must be a positive safe integer');
  }
  if (!Number.isSafeInteger(file.size) || file.size < 0) {
    return fileError(
      'invalid_file_size',
      'Local manifest size must be a non-negative safe integer',
    );
  }
  if (file.size > maxBytes) {
    return fileError('manifest_too_large', `Manifest exceeds ${maxBytes} bytes`);
  }
  try {
    return loadAimProgram(await file.text(), options);
  } catch {
    return fileError('file_read_failed', 'The local manifest could not be read');
  }
}
