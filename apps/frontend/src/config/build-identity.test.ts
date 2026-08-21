import { resolveBuildCommit } from './build-identity';

describe('build identity', () => {
  it('preserves an explicitly declared exact Git commit', () => {
    expect(resolveBuildCommit('0ae2bc333745ac739e21b8e8b7ae223671b5c53c')).toBe(
      '0ae2bc333745ac739e21b8e8b7ae223671b5c53c',
    );
  });

  it.each([undefined, '', '   ', 'local-latest', 'abc123'])(
    'treats %s as unavailable instead of fabricating a commit',
    (value) => {
      expect(resolveBuildCommit(value)).toBeNull();
    },
  );
});
