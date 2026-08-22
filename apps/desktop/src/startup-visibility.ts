export type StartupVisibilityInput = {
  forceVisible: boolean;
  hiddenArgument: boolean;
  wasOpenedAtLogin: boolean;
  wasOpenedAsHidden: boolean;
};

export function shouldLaunchInBackground(input: StartupVisibilityInput) {
  if (input.forceVisible) return false;
  return (
    input.hiddenArgument ||
    input.wasOpenedAtLogin ||
    input.wasOpenedAsHidden
  );
}
