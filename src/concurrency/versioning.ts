// Legacy module name retained for internal utility compatibility.
// v1 does not expose version tokens at the CLI surface.

export function pageVersionFingerprint(pageId: string, lastEditedTime: string): string {
  return `${pageId}:${lastEditedTime}`;
}
