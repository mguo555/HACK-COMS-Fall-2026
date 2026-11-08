// Small display helpers shared by the photo cards.

// Plant-ish colors that read well with white text in light and dark mode.
const AVATAR_COLORS = ['#5f8f4e', '#c4683f', '#b8892a', '#4f8a83', '#9a6b9c', '#7a6a4f', '#5d7fb0'];

/** The same handle always gets the same color. */
export function handleColor(handle: string): string {
  let hash = 0;
  for (const ch of handle) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/** "just now", "5m ago", "3h ago", or the time of day for anything older than a day. */
export function timeAgo(ms: number, now = Date.now()): string {
  const seconds = Math.max(0, (now - ms) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(ms);
}
