export type InstallStateDecision = {
  currentIdentity: string;
  previousIdentity?: string;
  setupComplete: boolean;
  preserveSettings: boolean;
  explicitFreshStart: boolean;
};

export function shouldResetLocalState({
  currentIdentity,
  previousIdentity,
  setupComplete,
  preserveSettings,
  explicitFreshStart,
}: InstallStateDecision) {
  if (explicitFreshStart) return true;
  if (preserveSettings) return false;
  if (previousIdentity) return previousIdentity !== currentIdentity;
  return setupComplete;
}
