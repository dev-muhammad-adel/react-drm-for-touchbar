export interface KeyStateInjector {
  keyDown(code: number): void;
  keyUp(code: number): void;
}

export function createHeldKeyHandlers(injector: KeyStateInjector, keyCode: number) {
  let held = false;

  const release = () => {
    if (!held) return;
    held = false;
    injector.keyUp(keyCode);
  };

  return {
    onTouchStart: () => {
      if (held) return;
      held = true;
      injector.keyDown(keyCode);
    },
    onTouchEnd: release,
    onTouchCancel: release,
  };
}
