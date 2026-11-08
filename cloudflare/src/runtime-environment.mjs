// Default to staging for existing fixtures and legacy staging deployments.
// Production receives different coordinator names even when IDs match.
export function runtimeEnvironment(env) {
  return env?.SHARIKA_ENV === 'production' ? 'production' : 'staging';
}

export function presenceCoordinatorName(env) {
  return `sharika:presence:${runtimeEnvironment(env)}`;
}

export function musicLibraryCoordinatorName(env) {
  return `sharika:music-library:${runtimeEnvironment(env)}`;
}
