/**
 * Generates a unique action id for idempotent move submissions.
 *
 * The backend uses this id to detect and safely replay duplicate requests
 * (e.g., caused by network retries or double-clicks).  Each call to
 * `generateActionId` must return a fresh, globally unique string.
 */
export function generateActionId(): string {
  // crypto.randomUUID is available in all modern browsers and Node.js ≥ 14.17.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for environments that do not support crypto.randomUUID.
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
