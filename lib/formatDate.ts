/**
 * Legacy portfolio utility — date formatting for chat UI display.
 * Unused by the CV tailoring API path.
 */
export function formatDate(dateString: string) {
  return new Date(`${dateString}T00:00:00Z`).toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
