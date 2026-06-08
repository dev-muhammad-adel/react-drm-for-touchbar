import { useContext } from 'react';
import { TouchRegistryContext } from './touch-registry';

export function useTouchLock() {
  const registry = useContext(TouchRegistryContext);
  return {
    lock:   () => registry?.setLocked(true),
    unlock: () => registry?.setLocked(false),
  };
}
