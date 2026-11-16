// Pure queue logic for the site's pop-up messages (App.tsx showToast). Tested in tests/unit/toastQueue.test.mjs.
// - unique ids (a counter, never Date.now(): two messages in the same millisecond must not share a React key)
// - an identical message (same text + type) that is already visible is NOT added again: React.StrictMode runs
//   effects twice in development and impatient double clicks repeat calls — the customer must see it once
// - at most MAX_VISIBLE at a time (oldest dropped first)

export type ToastKind = 'success' | 'error' | 'info';
export type QueuedToast = { id: string; message: string; type: ToastKind };

export const MAX_VISIBLE = 3;
let seq = 0;

/** Next queue after showing `message`; returns the same array when nothing changes. */
export function addToast(queue: QueuedToast[], message: string, type: ToastKind): QueuedToast[] {
  const text = String(message ?? '').trim();
  if (!text) return queue;
  if (queue.some((t) => t.message === text && t.type === type)) return queue;
  seq += 1;
  const next = [...queue, { id: `toast-${seq}`, message: text, type }];
  return next.length > MAX_VISIBLE ? next.slice(next.length - MAX_VISIBLE) : next;
}

export function removeToast(queue: QueuedToast[], id: string): QueuedToast[] {
  return queue.some((t) => t.id === id) ? queue.filter((t) => t.id !== id) : queue;
}

/** How long a message stays: errors longer (they usually ask the customer to do something). */
export const toastDurationMs = (type: ToastKind): number => (type === 'error' ? 7000 : 4000);
