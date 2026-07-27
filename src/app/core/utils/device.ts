/** True on touch-first devices (phones/tablets), where backgrounding may silently kill sockets. */
export const isMobile: boolean =
  typeof navigator !== 'undefined' &&
  ((navigator as { maxTouchPoints?: number }).maxTouchPoints ?? 0) > 0 &&
  typeof window !== 'undefined' &&
  !!window.matchMedia &&
  window.matchMedia('(hover: none) and (pointer: coarse)').matches;
