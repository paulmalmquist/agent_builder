const gitCommitPattern = /^[a-f0-9]{7,64}$/iu;

export function resolveBuildCommit(value: string | undefined) {
  const candidate = value?.trim();
  return candidate && gitCommitPattern.test(candidate) ? candidate : null;
}

export const consoleBuildCommit = resolveBuildCommit(import.meta.env.VITE_PAUL_OS_BUILD_COMMIT);
