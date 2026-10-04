/** What a key does on a desktop. The hint strip in the corner lists them. */
export type Shortcut = 'search' | 'locate' | 'zoomIn' | 'zoomOut' | 'close';

type KeyPress = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'defaultPrevented' | 'target'>;

function fieldOf(target: EventTarget | null): 'text' | 'choice' | null {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return null;
  if (target.tagName === 'SELECT') return 'choice';
  return target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(target.tagName) ? 'text' : null;
}

/**
 * The shortcut a key press stands for, or null: while typing in a field, with
 * Ctrl, Alt or Cmd held (those belong to the browser), and when something else
 * has already handled the key. Shift is not a modifier here, since "+" needs it.
 */
export function shortcutFor(event: KeyPress): Shortcut | null {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return null;
  const field = fieldOf(event.target);
  // A list of choices keeps the focus after a choice and takes letters to find
  // an entry, but Escape is not typing: it still closes the card around the list.
  if (field === 'text' || (field === 'choice' && event.key !== 'Escape')) return null;
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
