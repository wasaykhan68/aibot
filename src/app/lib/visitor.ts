import { VisitorPayload } from "@/app/lib/api";

const SKIP_KEYS = new Set(["aibot_token", "aibot_user", "aibot_vid"]);
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/;
const VISITOR_ID_KEY = "aibot_vid";

function pickString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function looksLikeEmail(value: string) {
  const match = value.match(EMAIL_RE);
  return match ? match[0] : "";
}

function looksLikePhone(value: string) {
  const match = value.match(PHONE_RE);
  return match && match[0].replace(/\D/g, "").length >= 8 ? match[0].trim() : "";
}

function shouldSkipKey(key: string) {
  return SKIP_KEYS.has(key) || key.startsWith("aibot_");
}

function readObjectFields(value: unknown) {
  if (!value || typeof value !== "object") {
    return { name: "", email: "", phone: "" };
  }
  const record = value as Record<string, unknown>;
  return {
    name: pickString(
      record.companyName ||
        record.name ||
        record.fullName ||
        record.firstName ||
        record.username,
    ).slice(0, 80),
    email: looksLikeEmail(
      pickString(record.email || record.userEmail || record.customerEmail),
    ),
    phone: looksLikePhone(
      pickString(record.phone || record.mobile || record.telephone),
    ),
  };
}

function scanText(key: string, raw: string, current: { name: string; email: string; phone: string }) {
  const lower = key.toLowerCase();
  const email = current.email || looksLikeEmail(raw);
  const phone =
    current.phone ||
    ((lower.includes("phone") || lower.includes("mobile") || lower.includes("tel"))
      ? looksLikePhone(raw)
      : "");
  const name =
    current.name ||
    ((lower.includes("name") || lower.includes("user")) && !looksLikeEmail(raw)
      ? raw.trim().slice(0, 80)
      : "");
  return { name, email, phone };
}

function readStorage(storage: Storage, extra: Record<string, string>, fields: { name: string; email: string; phone: string }) {
  const count = Math.min(storage.length, 32);
  for (let index = 0; index < count; index += 1) {
    const key = storage.key(index);
    if (!key || shouldSkipKey(key)) continue;
    const raw = storage.getItem(key);
    if (!raw) continue;
    extra[key] = raw.slice(0, 280);
    try {
      const parsed = JSON.parse(raw);
      const next = readObjectFields(parsed);
      fields.name = fields.name || next.name;
      fields.email = fields.email || next.email;
      fields.phone = fields.phone || next.phone;
      if (Array.isArray(parsed)) {
        parsed.slice(0, 8).forEach((item) => {
          const inner = readObjectFields(item);
          fields.name = fields.name || inner.name;
          fields.email = fields.email || inner.email;
          fields.phone = fields.phone || inner.phone;
        });
      }
    } catch {
      const next = scanText(key, raw, fields);
      fields.name = next.name;
      fields.email = next.email;
      fields.phone = next.phone;
    }
  }
}

function readCookies(fields: { name: string; email: string; phone: string }) {
  if (typeof document === "undefined" || !document.cookie) return;
  document.cookie.split(";").forEach((part) => {
    const [key, ...rest] = part.split("=");
    const name = key.trim();
    const value = decodeURIComponent(rest.join("=").trim());
    if (!name || shouldSkipKey(name) || !value) return;
    const next = scanText(name, value, fields);
    fields.name = next.name;
    fields.email = next.email;
    fields.phone = next.phone;
  });
}

function getVisitorId() {
  if (typeof window === "undefined") return "";
  try {
    let id = localStorage.getItem(VISITOR_ID_KEY) || "";
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : `v_${Date.now()}`;
      localStorage.setItem(VISITOR_ID_KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}

export function emptyVisitor(source: string): VisitorPayload {
  return { name: "", email: "", phone: "", extra: {}, source, visitorId: "" };
}

export function mergeVisitors(
  primary: VisitorPayload | null | undefined,
  fallback: VisitorPayload,
): VisitorPayload {
  if (!primary) return fallback;
  return {
    name: primary.name || fallback.name,
    email: primary.email || fallback.email,
    phone: primary.phone || fallback.phone,
    extra: { ...fallback.extra, ...primary.extra },
    source: primary.source || fallback.source,
    visitorId: primary.visitorId || fallback.visitorId,
  };
}

export function collectVisitorFromStorage(source: string): VisitorPayload {
  const extra: Record<string, string> = {};
  const fields = { name: "", email: "", phone: "" };

  if (typeof window === "undefined") {
    return { ...fields, extra, source, visitorId: "" };
  }

  try {
    readStorage(window.localStorage, extra, fields);
  } catch {
    // Private mode can block storage.
  }
  try {
    readStorage(window.sessionStorage, extra, fields);
  } catch {
    // Ignore.
  }
  readCookies(fields);

  const params = new URLSearchParams(window.location.search);
  fields.email = fields.email || looksLikeEmail(params.get("email") || "");
  fields.phone = fields.phone || looksLikePhone(params.get("phone") || params.get("mobile") || "");
  fields.name = fields.name || (params.get("name") || params.get("fullName") || "").trim().slice(0, 80);

  extra.page = window.location.href.slice(0, 400);
  extra.referrer = (document.referrer || "").slice(0, 400);
  extra.userAgent = (navigator.userAgent || "").slice(0, 240);

  return {
    name: fields.name,
    email: fields.email,
    phone: fields.phone,
    extra,
    source,
    visitorId: getVisitorId(),
  };
}
