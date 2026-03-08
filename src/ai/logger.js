const AI_LOG_ENABLED = (process.env.AI_LOG_ENABLED ?? "false").trim().toLowerCase() === "true";
const AI_LOG_PROMPT = (process.env.AI_LOG_PROMPT ?? "false").trim().toLowerCase() === "true";
const AI_LOG_VERBOSE = (process.env.AI_LOG_VERBOSE ?? "false").trim().toLowerCase() === "true";

function clipString(value, max = 1000) {
  if (typeof value !== "string") {
    return value;
  }
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}...<trimmed:${value.length - max}>`;
}

function sanitize(value, depth = 0) {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return clipString(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (depth > 4) {
    return "<max-depth>";
  }
  if (Array.isArray(value)) {
    const capped = value.slice(0, 40).map((item) => sanitize(item, depth + 1));
    if (value.length > 40) {
      capped.push(`<trimmed:${value.length - 40}>`);
    }
    return capped;
  }
  if (typeof value === "object") {
    const out = {};
    const keys = Object.keys(value).slice(0, 80);
    for (const key of keys) {
      if (/key|token|secret|password|authorization/i.test(key)) {
        out[key] = "<redacted>";
        continue;
      }
      out[key] = sanitize(value[key], depth + 1);
    }
    if (Object.keys(value).length > keys.length) {
      out.__trimmed_keys = Object.keys(value).length - keys.length;
    }
    return out;
  }
  return String(value);
}

export function aiLog(event, data = {}) {
  if (!AI_LOG_ENABLED) {
    return;
  }
  const payload = sanitize(data);
  // eslint-disable-next-line no-console
  console.log(`[ai-log] ${event} ${JSON.stringify(payload)}`);
}

export function aiLogPrompt(event, data = {}) {
  if (!AI_LOG_ENABLED || !AI_LOG_PROMPT) {
    return;
  }
  const payload = sanitize(data);
  // eslint-disable-next-line no-console
  console.log(`[ai-log-prompt] ${event} ${JSON.stringify(payload)}`);
}

export function aiLogVerbose(event, data = {}) {
  if (!AI_LOG_ENABLED || !AI_LOG_VERBOSE) {
    return;
  }
  const payload = sanitize(data);
  // eslint-disable-next-line no-console
  console.log(`[ai-log-verbose] ${event} ${JSON.stringify(payload)}`);
}
