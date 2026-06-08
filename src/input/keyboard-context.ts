import { createContext } from 'react';
import type { KeyboardReader } from '../native/keyboard';

export const KeyboardContext = createContext<KeyboardReader | null>(null);
