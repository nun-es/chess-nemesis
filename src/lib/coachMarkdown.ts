// Restore only paired, escaped bold spans; other backslashes remain untouched.
export function normalizeCoachMarkdown(value: string): string {
  return value.replace(/\\\*\\\*([^*\n]{1,160})\\\*\\\*/g, '**$1**').replace(/&#x20;/gi, ' ')
}
