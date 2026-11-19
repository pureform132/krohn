/* KROHN web shell boot.
 *
 * Loaded as a classic script in <head> BEFORE the dashboard module, so it can:
 *   - install the PTY WebSocket observer used by the Skills/Commands palette;
 *   - default the dashboard language to Spanish on a fresh browser;
 *   - expose the small KROHN_SHELL API consumed by krohn-shell.js.
 *
 * No framework, no build step. */
(function () {
  "use strict";

  var BASE = window.__KROHN_BASE_PATH__ || "";
  var PENDING_KEY = "krohn.pendingInsert";
  var pending = null;
  try { pending = sessionStorage.getItem(PENDING_KEY) || null; } catch (_) {}

  /* ---- default locale (Spanish-primary, never override a user's choice) --- */
  try {
    if (!localStorage.getItem("krohn-locale")) {
      localStorage.setItem("krohn-locale", "es");
    }
    if (!localStorage.getItem("krohn-dashboard-theme")) {
      localStorage.setItem("krohn-dashboard-theme", "default");
    }
    /* Meganote is same-origin; dark paper is the only theme that can use the
       KROHN palette without leaving the 11 allowed colors. */
    if (!localStorage.getItem("takenotes.theme")) {
      localStorage.setItem("takenotes.theme", "dark");
    }
  } catch (_) {}

  /* ---- observe PTY sockets created by the dashboard's ChatPage ----------- */
  var NativeWS = window.WebSocket;
  var ptySockets = new Set();

  function KrohnWebSocket(url, protocols) {
    var ws = arguments.length > 1
      ? new NativeWS(url, protocols)
      : new NativeWS(url);
    try {
      if (String(url).indexOf("/api/pty") !== -1) {
        ptySockets.add(ws);
        ws.addEventListener("open", function () {
          window.dispatchEvent(new CustomEvent("krohn:pty-open", { detail: ws }));
          scheduleFlush();
        });
        ws.addEventListener("close", function () { ptySockets.delete(ws); });
        ws.addEventListener("error", function () { ptySockets.delete(ws); });
      }
    } catch (_) {}
    return ws;
  }
  KrohnWebSocket.prototype = NativeWS.prototype;
  ["CONNECTING", "OPEN", "CLOSING", "CLOSED"].forEach(function (k) {
    try { KrohnWebSocket[k] = NativeWS[k]; } catch (_) {}
  });
  try { window.WebSocket = KrohnWebSocket; } catch (_) {}

  function openPty() {
    var last = null;
    ptySockets.forEach(function (ws) {
      if (ws && ws.readyState === 1) last = ws;
    });
    return last;
  }

  function focusTerminal() {
    var ta = document.querySelector(".xterm-helper-textarea");
    if (ta && typeof ta.focus === "function") {
      try { ta.focus({ preventScroll: true }); } catch (_) { ta.focus(); }
    }
  }

  function toast(text, kind) {
    try {
      window.dispatchEvent(new CustomEvent("krohn:toast", { detail: { text: text, kind: kind || "ok" } }));
    } catch (_) {}
  }

  function flushPending() {
    if (!pending) return;
    var ws = openPty();
    if (!ws) return;
    var text = pending;
    pending = null;
    try { sessionStorage.removeItem(PENDING_KEY); } catch (_) {}
    try {
      ws.send(text);
      focusTerminal();
      toast("Insertado en el chat · pulsa Enter para ejecutar");
    } catch (_) {
      pending = text;
    }
  }

  var flushTimer = null;
  function scheduleFlush() {
    if (!pending) return;
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flushPending, 1400);
  }

  function sendToPty(text) {
    if (!text) return false;
    var ws = openPty();
    if (ws) {
      try {
        ws.send(text);
        focusTerminal();
        toast("Insertado en el chat · pulsa Enter para ejecutar");
        return true;
      } catch (_) {}
    }
    pending = text;
    try { sessionStorage.setItem(PENDING_KEY, text); } catch (_) {}
    var here = location.pathname.replace(/\/+$/, "");
    if (here !== BASE + "/chat" && here !== BASE + "/chat/") {
      toast("Abriendo Chat para insertar…");
      location.assign(BASE + "/chat");
    } else {
      toast("Esperando al terminal…");
      scheduleFlush();
    }
    return true;
  }

  function wsUrl(path) {
    return new Promise(function (resolve, reject) {
      var q = [];
      function done(param, value) {
        q.push(param + "=" + encodeURIComponent(value));
        var proto = location.protocol === "https:" ? "wss:" : "ws:";
        resolve(proto + "//" + location.host + BASE + path + "?" + q.join("&"));
      }
      if (window.__KROHN_AUTH_REQUIRED__) {
        fetch(BASE + "/api/auth/ws-ticket", { method: "POST", credentials: "include" })
          .then(function (r) { if (!r.ok) throw new Error("ws-ticket " + r.status); return r.json(); })
          .then(function (j) { done("ticket", j.ticket); })
          .catch(reject);
      } else {
        done("token", window.__KROHN_SESSION_TOKEN__ || "");
      }
    });
  }

  function api(path, options) {
    var opts = options || {};
    var headers = new Headers(opts.headers || {});
    var token = window.__KROHN_SESSION_TOKEN__ || "";
    if (token && !headers.has("X-KROHN-Session-Token")) headers.set("X-KROHN-Session-Token", token);
    if (opts.body && !(opts.body instanceof FormData) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    return fetch(BASE + path, Object.assign({}, opts, { headers: headers, credentials: "same-origin" }));
  }

  window.KROHN_SHELL = {
    base: BASE,
    api: api,
    wsUrl: wsUrl,
    sendToPty: sendToPty,
    flushPending: flushPending,
    focusTerminal: focusTerminal,
    toast: toast,
    ptyCount: function () { return ptySockets.size; },
    ptyOpen: function () { return !!openPty(); },
    hasPending: function () { return !!pending; }
  };

  window.addEventListener("krohn:pty-open", scheduleFlush);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(scheduleFlush, 1200); });
  } else {
    setTimeout(scheduleFlush, 1200);
  }
})();
