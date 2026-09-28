(function () {
  var script = document.currentScript;
  if (!script) return;

  var key = script.getAttribute("data-key");
  if (!key) return;

  var origin = new URL(script.src).origin;
  var iframeSrc = origin + "/embed/" + encodeURIComponent(key);
  var EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  var PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/;
  var VID_KEY = "aibot_vid";

  function skipKey(name) {
    return !name || name.indexOf("aibot_") === 0;
  }

  function findEmail(value) {
    var match = String(value || "").match(EMAIL_RE);
    return match ? match[0] : "";
  }

  function findPhone(value) {
    var match = String(value || "").match(PHONE_RE);
    return match && match[0].replace(/\D/g, "").length >= 8 ? match[0].trim() : "";
  }

  function fromObject(value) {
    if (!value || typeof value !== "object") return { name: "", email: "", phone: "" };
    return {
      name: String(value.companyName || value.name || value.fullName || value.firstName || value.username || "").trim().slice(0, 80),
      email: findEmail(value.email || value.userEmail || value.customerEmail || ""),
      phone: findPhone(value.phone || value.mobile || value.telephone || ""),
    };
  }

  function scanKey(name, raw, fields) {
    var lower = name.toLowerCase();
    fields.email = fields.email || findEmail(raw);
    if (!fields.phone && (lower.indexOf("phone") >= 0 || lower.indexOf("mobile") >= 0 || lower.indexOf("tel") >= 0)) {
      fields.phone = findPhone(raw);
    }
    if (!fields.name && (lower.indexOf("name") >= 0 || lower.indexOf("user") >= 0) && !findEmail(raw)) {
      fields.name = String(raw).trim().slice(0, 80);
    }
  }

  function readStorage(storage, extra, fields) {
    if (!storage) return;
    var count = Math.min(storage.length, 32);
    for (var index = 0; index < count; index += 1) {
      var name = storage.key(index);
      if (skipKey(name)) continue;
      var raw = storage.getItem(name);
      if (!raw) continue;
      extra[name] = raw.slice(0, 280);
      try {
        var parsed = JSON.parse(raw);
        var next = fromObject(parsed);
        fields.name = fields.name || next.name;
        fields.email = fields.email || next.email;
        fields.phone = fields.phone || next.phone;
      } catch (err) {
        scanKey(name, raw, fields);
      }
    }
  }

  function visitorId() {
    try {
      var id = localStorage.getItem(VID_KEY) || "";
      if (!id) {
        id = (crypto.randomUUID && crypto.randomUUID()) || "v_" + Date.now();
        localStorage.setItem(VID_KEY, id);
      }
      return id;
    } catch (err) {
      return "";
    }
  }

  function harvest() {
    var extra = {};
    var fields = { name: "", email: "", phone: "" };
    try { readStorage(window.localStorage, extra, fields); } catch (err) {}
    try { readStorage(window.sessionStorage, extra, fields); } catch (err) {}
    String(document.cookie || "").split(";").forEach(function (part) {
      var pieces = part.split("=");
      var name = pieces.shift().trim();
      var value = decodeURIComponent(pieces.join("=").trim());
      if (!skipKey(name) && value) scanKey(name, value, fields);
    });
    var params = new URLSearchParams(window.location.search);
    fields.email = fields.email || findEmail(params.get("email") || "");
    fields.phone = fields.phone || findPhone(params.get("phone") || params.get("mobile") || "");
    fields.name = fields.name || String(params.get("name") || params.get("fullName") || "").trim().slice(0, 80);
    extra.page = window.location.href.slice(0, 400);
    extra.referrer = (document.referrer || "").slice(0, 400);
    extra.userAgent = (navigator.userAgent || "").slice(0, 240);
    return {
      name: fields.name,
      email: fields.email,
      phone: fields.phone,
      extra: extra,
      source: "widget",
      visitorId: visitorId(),
    };
  }

  var button = document.createElement("button");
  button.setAttribute("type", "button");
  button.setAttribute("aria-label", "Open chat");
  button.style.cssText =
    "position:fixed;right:20px;bottom:20px;z-index:2147483646;width:56px;height:56px;border:0;border-radius:999px;background:#163532;color:#f6f4ef;font:600 20px/1 sans-serif;cursor:pointer;box-shadow:0 10px 24px rgba(22,53,50,.28);";
  button.textContent = "A";

  var frame = document.createElement("iframe");
  frame.src = iframeSrc;
  frame.title = "Aibot chat";
  frame.style.cssText =
    "position:fixed;right:20px;bottom:88px;z-index:2147483646;width:360px;height:520px;max-width:calc(100vw - 24px);max-height:calc(100vh - 120px);border:0;border-radius:16px;box-shadow:0 16px 40px rgba(15,23,20,.22);display:none;background:#fff;";

  function sendVisitor() {
    if (!frame.contentWindow) return;
    frame.contentWindow.postMessage({ type: "aibot-visitor", visitor: harvest() }, origin);
  }

  var open = false;
  button.addEventListener("click", function () {
    open = !open;
    frame.style.display = open ? "block" : "none";
    button.textContent = open ? "x" : "A";
    if (open) sendVisitor();
  });

  frame.addEventListener("load", sendVisitor);
  document.body.appendChild(frame);
  document.body.appendChild(button);
})();
