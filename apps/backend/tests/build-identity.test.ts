import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveBuildIdentity } from '../src/build-identity.js';

describe('build identity', () => {
  it('reads the immutable metadata emitted by the image build', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'paul-os-build-'));
    const metadataPath = path.join(directory, 'identity.json');
    writeFileSync(
      metadataPath,
      JSON.stringify({
        commit: '0ae2bc333745ac739e21b8e8b7ae223671b5c53c',
        buildTimestamp: '2026-08-21T14:30:00.000Z',
      }),
    );

    expect(resolveBuildIdentity({ PAUL_OS_BUILD_METADATA_PATH: metadataPath })).toEqual({
      commit: '0ae2bc333745ac739e21b8e8b7ae223671b5c53c',
      buildTimestamp: '2026-08-21T14:30:00.000Z',
    });
  });

  it('reports unavailable values instead of inferring local build identity', () => {
    expect(resolveBuildIdentity({})).toEqual({ commit: null, buildTimestamp: null });
    expect(
      resolveBuildIdentity({
        REPOSITORY_SOURCE_COMMIT: 'local-latest',
        BUILD_TIMESTAMP: 'today',
      }),
    ).toEqual({ commit: null, buildTimestamp: null });
  });

  it('fails closed when a declared metadata file is malformed', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'paul-os-build-'));
    const metadataPath = path.join(directory, 'identity.json');
    writeFileSync(
      metadataPath,
      JSON.stringify({ commit: 'not-a-commit', buildTimestamp: 'today' }),
    );

    expect(() => resolveBuildIdentity({ PAUL_OS_BUILD_METADATA_PATH: metadataPath })).toThrow(
      /Build metadata failed validation/,
    );
  });
});
