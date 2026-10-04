/** What a key does on a desktop. The hint strip in the corner lists them. */
export type Shortcut = 'search' | 'locate' | 'zoomIn' | 'zoomOut' | 'close';

type KeyPress = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'defaultPrevented' | 'target'>;

function typingIn(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * The shortcut a key press stands for, or null: while typing in a field, with
 * Ctrl, Alt or Cmd held (those belong to the browser), and when something else
 * has already handled the key. Shift is not a modifier here, since "+" needs it.
 */
export function shortcutFor(event: KeyPress): Shortcut | null {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return null;
  if (typingIn(event.target)) return null;
  switch (event.key) {
    case '/': return 'search';
    case 'l':
    case 'L': return 'locate';
    // "=" is "+" without Shift on most keyboards, as "_" is "-" with it.
    case '+':
    case '=': return 'zoomIn';
    case '-':
    case '_':
    case '−': return 'zoomOut';
    case 'Escape': return 'close';
    default: return null;
  }
}
