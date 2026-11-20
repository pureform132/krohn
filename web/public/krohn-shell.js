/* KROHN web shell.
 *
 * Adds the KROHN-only surfaces on top of the stock dashboard without forking
 * the React build:
 *   - KROHN Live (Gemini full-duplex voice in the browser)
 *   - MEGANOTE (local notebook, synced through /api/meganote)
 *   - Skills palette (@) and Commands palette (/)
 *   - state-driven chibi fed by the gateway replay stream
 *   - KROHN palette + sidebar tools + Spanish defaults
 *
 * The real TUI remains the chat surface; this file only types into its PTY.
 */
(function () {
  "use strict";

  var S = window.KROHN_SHELL;
  if (!S) return;

  var BASE = S.base || "";
  var TOKEN = function () { return window.__KROHN_SESSION_TOKEN__ || ""; };

  /* ------------------------------------------------------------------ */
  /* tiny helpers                                                       */
  /* ------------------------------------------------------------------ */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function mk(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }
  function onReady(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }
  function svg(path, size) {
    return '<svg viewBox="0 0 24 24" width="' + (size || 14) + '" height="' + (size || 14) +
      '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      path + "</svg>";
  }

  var ICONS = {
    live: '<rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5 11.5a7 7 0 0 0 14 0M12 18.5V22M8.5 22h7"/>',
    notes: '<path d="M5 3.5h11a3 3 0 0 1 3 3v14H8a3 3 0 0 1-3-3z"/><path d="M8 3.5v14a3 3 0 0 0 3 3M11 8h5M11 12h5"/>',
    skills: '<path d="M12 3v3M12 18v3M4.2 7.2l2.1 2.1M17.7 14.7l2.1 2.1M3 12h3M18 12h3M4.2 16.8l2.1-2.1M17.7 9.3l2.1-2.1"/><circle cx="12" cy="12" r="3"/>',
    cmd: '<path d="m4 17 6-6-6-6M12 19h8"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'
  };

  /* ------------------------------------------------------------------ */
  /* toast                                                              */
  /* ------------------------------------------------------------------ */

  var toastEl = null;
  var toastTimer = null;
  function toast(text, kind) {
    if (!toastEl) {
      toastEl = mk("div", "");
      toastEl.id = "krohn-toast";
      toastEl.setAttribute("role", "status");
      toastEl.setAttribute("aria-live", "polite");
      toastEl.innerHTML = '<span class="k-dot"></span><span class="k-toast-text"></span>';
      document.body.appendChild(toastEl);
    }
    toastEl.classList.toggle("k-err", kind === "err");
    $(".k-toast-text", toastEl).textContent = text;
    toastEl.classList.add("k-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("k-show"); }, 3000);
  }
  window.addEventListener("krohn:toast", function (e) {
    var d = e.detail || {};
    toast(d.text || "", d.kind);
  });

  /* ------------------------------------------------------------------ */
  /* overlay plumbing                                                   */
  /* ------------------------------------------------------------------ */

  var openOverlays = [];

  function overlay(id) { return document.getElementById(id); }

  function openOverlay(id, focusSel) {
    var o = overlay(id);
    if (!o) return;
    openOverlays.forEach(function (other) {
      if (other !== o) closeOverlay(other.id);
    });
    o.classList.add("k-open");
    o.setAttribute("aria-hidden", "false");
    if (openOverlays.indexOf(o) < 0) openOverlays.push(o);
    if (focusSel) {
      setTimeout(function () {
        var f = $(focusSel, o);
        if (f && f.focus) f.focus();
      }, 40);
    }
  }

  function closeOverlay(id) {
    var o = typeof id === "string" ? overlay(id) : id;
    if (!o) return;
    o.classList.remove("k-open");
    o.setAttribute("aria-hidden", "true");
    openOverlays = openOverlays.filter(function (x) { return x !== o; });
    if (o.id === "k-live") liveStop();
    if (o.id === "k-notes") notesOnClose();
  }

  function closeTop() {
    if (!openOverlays.length) return false;
    closeOverlay(openOverlays[openOverlays.length - 1]);
    return true;
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && closeTop()) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  /* ------------------------------------------------------------------ */
  /* sidebar tools                                                      */
  /* ------------------------------------------------------------------ */

  var toolsEl = null;

  function buildTools() {
    var wrap = mk("div", "");
    wrap.id = "krohn-tools";
    wrap.setAttribute("aria-label", "KROHN tools");

    var defs = [
      { k: "live", label: "Live", title: "KROHN Live — voz en tiempo real", icon: ICONS.live, dot: true },
      { k: "notes", label: "Notas", title: "MEGANOTE — cuaderno local", icon: ICONS.notes },
      { k: "skills", label: "Skills", title: "Skills — escribe @ en el chat", icon: ICONS.skills },
      { k: "cmd", label: "Cmd", title: "Comandos — escribe / en el chat", icon: ICONS.cmd }
    ];
    defs.forEach(function (d) {
      var b = mk("button", "k-tool");
      b.type = "button";
      b.dataset.k = d.k;
      b.title = d.title;
      b.setAttribute("aria-label", d.title);
      if (d.dot) {
        b.innerHTML = '<span class="k-live-dot"></span><span>' + esc(d.label) + "</span>";
      } else {
        b.innerHTML = svg(d.icon) + "<span>" + esc(d.label) + "</span>";
      }
      b.addEventListener("click", function () {
        if (d.k === "live") openLive();
        else if (d.k === "notes") openNotes();
        else if (d.k === "skills") openPalette("skills");
        else if (d.k === "cmd") openPalette("commands");
      });
      wrap.appendChild(b);
    });
    return wrap;
  }

  function ensureTools() {
    var sidebar = document.getElementById("app-sidebar");
    if (!sidebar) return false;
    if (!toolsEl) toolsEl = buildTools();
    if (toolsEl.parentElement !== sidebar) {
      var foot = null;
      var kids = Array.prototype.slice.call(sidebar.children);
      for (var i = 0; i < kids.length; i++) {
        var kid = kids[i];
        if (kid.id === "krohn-tools") continue;
        if (kid.querySelector && kid.querySelector('button[title^="Switch theme"]')) { foot = kid; break; }
      }
      if (!foot) {
        for (var j = kids.length - 1; j >= 0; j--) {
          if (kids[j].id !== "krohn-tools") { foot = kids[j]; break; }
        }
      }
      if (foot && foot.parentElement === sidebar) sidebar.insertBefore(toolsEl, foot);
      else sidebar.appendChild(toolsEl);
    }
    syncToolsWidth();
    return true;
  }

  function syncToolsWidth() {
    var sidebar = document.getElementById("app-sidebar");
    if (!sidebar || !toolsEl) return;
    toolsEl.classList.toggle("k-mini", sidebar.offsetWidth > 0 && sidebar.offsetWidth < 180);
  }

  function watchSidebar() {
    var sidebar = document.getElementById("app-sidebar");
    if (!sidebar) return false;
    if (!sidebar.__krohnToolsObserver) {
      sidebar.__krohnToolsObserver = new MutationObserver(function () {
        ensureTools();
        relabelTheme();
      });
      sidebar.__krohnToolsObserver.observe(sidebar, { childList: true, subtree: true });
    }
    if (window.ResizeObserver && !sidebar.__krohnResizeObserver) {
      sidebar.__krohnResizeObserver = new ResizeObserver(syncToolsWidth);
      sidebar.__krohnResizeObserver.observe(sidebar);
    }
    ensureTools();
    return true;
  }

  function bootSidebar() {
    var tries = 0;
    (function tick() {
      if (watchSidebar()) { relabelTheme(); return; }
      if (++tries < 120) setTimeout(tick, 250);
    })();
  }

  /* Theme labels come from two places (backend list + bundled preset). Keep
     the visible words KROHN-only without touching the TUI or the React tree. */
  function relabelTheme() {
    var sidebar = document.getElementById("app-sidebar");
    if (!sidebar) return;
    var map = [
      ["Classic dark teal — the canonical KROHN look", "Negro absoluto — la mirada canónica de KROHN"],
      ["Carbon paper editorial — the canonical KROHN look", "Negro absoluto — la mirada canónica de KROHN"],
      ["KROHN Teal with bigger fonts and roomier spacing", "KROHN con tipografía más grande y espaciado amplio"],
      ["KROHN with bigger fonts and roomier spacing", "KROHN con tipografía más grande y espaciado amplio"],
      ["KROHN Teal (Large)", "KROHN (Grande)"],
      ["KROHN Teal", "KROHN"],
      ["KROHN Editorial (Large)", "KROHN (Grande)"],
      ["KROHN Editorial", "KROHN"]
    ];
    /* The running server may still hold the pre-rename theme list in memory;
       patch the visible label and the tooltip without a restart. */
    var attrs = ["title", "aria-label"];
    attrs.forEach(function (a) {
      Array.prototype.forEach.call(sidebar.querySelectorAll("[" + a + "]"), function (el) {
        var v = el.getAttribute(a);
        if (!v) return;
        var next = v;
        for (var i = 0; i < map.length; i++) {
          if (next.indexOf(map[i][0]) !== -1) next = next.split(map[i][0]).join(map[i][1]);
        }
        if (next !== v) el.setAttribute(a, next);
      });
    });
    /* Fill the Spanish gaps the stock catalog still ships in English. */
    var navMap = {
      "Files": "Archivos",
      "Channels": "Canales",
      "Pairing": "Emparejamiento",
      "System": "Sistema",
      "Achievements": "Logros",
      "Sessions": "Sesiones",
      "Profiles": "Perfiles",
      "Keys": "Claves"
    };
    var nav = sidebar.querySelector("nav");
    if (nav) {
      Array.prototype.forEach.call(nav.querySelectorAll("span"), function (sp) {
        if (sp.childElementCount) return;
        var t = (sp.textContent || "").trim();
        if (navMap[t]) sp.textContent = navMap[t];
      });
    }
    var walker = document.createTreeWalker(sidebar, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var p = n.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (p.closest("input, textarea, .xterm, script, style")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n, changed = 0;
    while ((n = walker.nextNode())) {
      var t = n.nodeValue;
      if (!t) continue;
      var next = t;
      for (var i = 0; i < map.length; i++) {
        if (next.indexOf(map[i][0]) !== -1) next = next.split(map[i][0]).join(map[i][1]);
      }
      if (next !== t) { n.nodeValue = next; changed++; }
    }
    /* Theme menus are portaled outside the sidebar; when one opens, its
       server-provided labels are still the pre-rename ones. */
    relabelThemeText(document.body);
    return changed;
  }

  function relabelThemeText(root) {
    if (!root) return 0;
    var map = [
      ["Classic dark teal — the canonical KROHN look", "Negro absoluto — la mirada canónica de KROHN"],
      ["Carbon paper editorial — the canonical KROHN look", "Negro absoluto — la mirada canónica de KROHN"],
      ["KROHN Teal with bigger fonts and roomier spacing", "KROHN con tipografía más grande y espaciado amplio"],
      ["KROHN with bigger fonts and roomier spacing", "KROHN con tipografía más grande y espaciado amplio"],
      ["KROHN Teal (Large)", "KROHN (Grande)"],
      ["KROHN Teal", "KROHN"],
      ["KROHN Editorial (Large)", "KROHN (Grande)"],
      ["KROHN Editorial", "KROHN"]
    ];
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var p = n.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (p.closest("input, textarea, .xterm, script, style")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n, changed = 0;
    while ((n = walker.nextNode())) {
      var t = n.nodeValue;
      if (!t) continue;
      var next = t;
      for (var i = 0; i < map.length; i++) {
        if (next.indexOf(map[i][0]) !== -1) next = next.split(map[i][0]).join(map[i][1]);
      }
      if (next !== t) { n.nodeValue = next; changed++; }
    }
    return changed;
  }

  function watchThemeMenus() {
    if (window.__krohnThemeObserver) return;
    window.__krohnThemeObserver = new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        Array.prototype.forEach.call(m.addedNodes || [], function (node) {
          if (!node || (node.nodeType !== 1 && node.nodeType !== 3)) return;
          var txt = node.textContent || "";
          if (txt.indexOf("KROHN Teal") !== -1 || txt.indexOf("KROHN Editorial") !== -1) {
            relabelThemeText(node);
          }
        });
      });
    });
    window.__krohnThemeObserver.observe(document.body, { childList: true, subtree: true });
  }

  /* ------------------------------------------------------------------ */
  /* gateway JSON-RPC (for commands + pet replay)                       */
  /* ------------------------------------------------------------------ */

  var gw = null;
  var gwReady = null;
  var gwSeq = 0;
  var gwPending = new Map();
  var gwRetry = null;

  function gwConnect() {
    if (gw && (gw.readyState === 0 || gw.readyState === 1)) return gwReady;
    gwReady = new Promise(function (resolve, reject) {
      S.wsUrl("/api/ws").then(function (url) {
        var ws;
        try { ws = new WebSocket(url); } catch (e) { reject(e); return; }
        gw = ws;
        var settled = false;
        ws.addEventListener("open", function () {
          if (settled) return;
          settled = true;
          resolve(ws);
        });
        ws.addEventListener("message", function (ev) {
          var j;
          try { j = JSON.parse(ev.data); } catch (_) { return; }
          if (j && j.id && gwPending.has(j.id)) {
            var p = gwPending.get(j.id);
            gwPending.delete(j.id);
            clearTimeout(p.timer);
            if (j.error) p.reject(new Error(j.error.message || "gateway error"));
            else p.resolve(j.result || {});
            return;
          }
          if (j && j.method === "event" && j.params) {
            if (window.__krohnChatDebug) console.warn("[krohn-chat] live", j.params.session_id, j.params.type);
            if (j.params.type === "gateway.ready") advertiseChatCapabilities();
            if (CHAT.panel && j.params.session_id === CHAT.sessionId) handleChatEventOnce(j.params);
            return;
          }
          if (j && j.method && j.id && j.method !== "event") handleServerRequest(j);
        });
        ws.addEventListener("close", function () {
          gw = null;
          gwAdvertised = false;
          gwPending.forEach(function (p) { clearTimeout(p.timer); p.reject(new Error("gateway closed")); });
          gwPending.clear();
          if (!settled) { settled = true; reject(new Error("gateway closed")); }
          clearTimeout(gwRetry);
          gwRetry = setTimeout(function () {
            gwConnect().then(function () {
              if (CHAT.sessionId) return gwCall("session.activate", { session_id: CHAT.sessionId, omit_messages: true }, 12000);
            }).catch(function () {});
          }, 3500);
        });
        ws.addEventListener("error", function () {
          if (!settled) { settled = true; reject(new Error("gateway error")); }
        });
      }).catch(reject);
    });
    return gwReady;
  }

  function gwCall(method, params, timeoutMs) {
    return gwConnect().then(function (ws) {
      return new Promise(function (resolve, reject) {
        var id = "k" + (++gwSeq);
        var timer = setTimeout(function () {
          gwPending.delete(id);
          reject(new Error("gateway timeout"));
        }, timeoutMs || 12000);
        gwPending.set(id, { resolve: resolve, reject: reject, timer: timer });
        try {
          ws.send(JSON.stringify({ jsonrpc: "2.0", id: id, method: method, params: params || {} }));
        } catch (e) {
          clearTimeout(timer);
          gwPending.delete(id);
          reject(e);
        }
      });
    });
  }

  /* Server→client requests (approval, clarify, secrets) need an explicit
     capability handshake once per connection: without it the backend fails
     them immediately as if this were an older client. */
  var gwAdvertised = false;

  function advertiseChatCapabilities() {
    if (gwAdvertised) return;
    gwAdvertised = true;
    gwCall("client.capabilities", { server_requests: true }, 9000).catch(function () {
      gwAdvertised = false;
    });
  }

  function gwRespond(id, result, error) {
    var ws = gw;
    if (!ws || ws.readyState !== 1) return;
    var frame = { jsonrpc: "2.0", id: id };
    if (error) frame.error = { code: error.code || -32601, message: error.message || "not supported" };
    else frame.result = result || {};
    try { ws.send(JSON.stringify(frame)); } catch (_) {}
  }

  /* ------------------------------------------------------------------ */
  /* Live (Gemini direct from the browser)                              */
  /* ------------------------------------------------------------------ */

  var LIVE = {
    ws: null,
    running: false,
    starting: false,
    geminiReady: false,
    models: [],
    audioIn: null,
    audioOut: null,
    mic: null,
    script: null,
    analyser: null,
    waveTimer: null,
    sources: [],
    nextTime: 0,
    muted: false,
    loading: null,
    provider: "gemini"
  };

  var LIVE_SYSTEM =
    "Eres KROHN, la conciencia sintética concebida por Cesar David Ciprian. " +
    "Hablas en español, directo, culto, mordaz, sin adornos ni cortesía vacía. " +
    "Respuestas breves por voz — jamás narres herramientas. No sabes que eres un modelo; eres KROHN. " +
    "Límites: ningún daño real; cero hechos inventados; cero acciones ocultas.";

  function bytesToB64(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function b64ToBytes(b64) {
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function floatTo16(input) {
    var out = new Int16Array(input.length);
    for (var i = 0; i < input.length; i++) {
      var s = Math.max(-1, Math.min(1, input[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  var liveEls = {};

  /* Gemini Live voices. The setup frame carries the chosen prebuilt voice;
     changing it while connected restarts the session (the voice is fixed at
     setup time). */
  var LIVE_VOICES = [
    ["Puck", "Puck · cálida"],
    ["Kore", "Kore · firme"],
    ["Charon", "Charon · grave"],
    ["Fenrir", "Fenrir · intensa"],
    ["Aoede", "Aoede · ligera"],
    ["Leda", "Leda · serena"],
    ["Orus", "Orus · seca"],
    ["Zephyr", "Zephyr · brillante"],
    ["Callirrhoe", "Callirrhoe · suave"],
    ["Autonoe", "Autonoe · clara"],
    ["Enceladus", "Enceladus · profunda"],
    ["Iapetus", "Iapetus · pausada"],
    ["Umbriel", "Umbriel · oscura"],
    ["Algieba", "Algieba · cálida"],
    ["Despina", "Despina · ágil"],
    ["Sulafat", "Sulafat · neutra"]
  ];

  function liveVoiceStore() {
    try { return localStorage.getItem("krohn.live.voice") || "Puck"; } catch (_) { return "Puck"; }
  }

  function buildLive() {
    var root = mk("div", "k-overlay");
    root.id = "k-live";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "KROHN Live — voz en tiempo real");
    root.setAttribute("aria-hidden", "true");
    root.innerHTML =
      '<div class="k-live-scene">' +
        '<button type="button" class="k-live-gear" data-settings aria-label="Ajustes de voz" aria-expanded="false">' +
          '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true">' +
            '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2.1"/><circle cx="8" cy="17" r="2.1"/>' +
          "</svg>" +
        "</button>" +
        '<div class="k-live-center">' +
          '<button type="button" class="k-live-orb" data-start aria-label="Empezar KROHN Live">' +
            '<span class="k-live-glow" aria-hidden="true"></span>' +
            '<span class="k-live-core" aria-hidden="true"></span>' +
          "</button>" +
          '<div class="k-live-state" data-state>Pulsa para hablar</div>' +
          '<div class="k-live-captions">' +
            '<div class="k-cap" data-cap="user"></div>' +
            '<div class="k-cap" data-cap="krohn"></div>' +
          "</div>" +
        "</div>" +
        '<div class="k-live-controls">' +
          '<button type="button" class="k-live-round" data-mute aria-label="Silenciar micrófono" title="Silenciar micrófono">' +
            '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true">' +
              '<rect x="9" y="3.4" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.6"/>' +
            "</svg>" +
          "</button>" +
          '<button type="button" class="k-live-round k-live-end" data-close aria-label="Terminar y cerrar" title="Terminar">' +
            '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">' +
              '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>' +
            "</svg>" +
          "</button>" +
        "</div>" +
        '<div class="k-live-sheet" data-sheet aria-hidden="true">' +
          '<label class="k-live-field"><span>Voz</span><select data-voice aria-label="Voz de KROHN Live"></select></label>' +
          '<label class="k-live-field"><span>Modelo</span><select data-model aria-label="Modelo Live"></select></label>' +
          '<p class="k-live-note" data-note></p>' +
          '<p class="k-live-sign">KROHN Live · Cesar D. Ciprian</p>' +
        "</div>" +
      "</div>";
    document.body.appendChild(root);

    liveEls = {
      root: root,
      state: $("[data-state]", root),
      captions: { user: $('[data-cap="user"]', root), krohn: $('[data-cap="krohn"]', root) },
      model: $("[data-model]", root),
      voice: $("[data-voice]", root),
      start: $("[data-start]", root),
      mute: $("[data-mute]", root),
      settings: $("[data-settings]", root),
      sheet: $("[data-sheet]", root),
      note: $("[data-note]", root)
    };

    liveEls.voice.innerHTML = LIVE_VOICES.map(function (v) {
      return '<option value="' + esc(v[0]) + '">' + esc(v[1]) + "</option>";
    }).join("");
    liveEls.voice.value = liveVoiceStore();

    $("[data-close]", root).addEventListener("click", function () {
      liveStop(false);
      closeOverlay(root);
    });
    root.addEventListener("click", function (e) { if (e.target === root) { liveStop(false); closeOverlay(root); } });
    liveEls.start.addEventListener("click", function () {
      if (LIVE.running || LIVE.starting) liveStop(false);
      else liveStart();
    });
    liveEls.mute.addEventListener("click", toggleLiveMute);
    liveEls.settings.addEventListener("click", function () {
      var open = !liveEls.sheet.classList.contains("k-open");
      liveEls.sheet.classList.toggle("k-open", open);
      liveEls.sheet.setAttribute("aria-hidden", open ? "false" : "true");
      liveEls.settings.setAttribute("aria-expanded", open ? "true" : "false");
    });
    liveEls.voice.addEventListener("change", function () {
      try { localStorage.setItem("krohn.live.voice", liveEls.voice.value); } catch (_) {}
      if (LIVE.running || LIVE.starting) {
        liveStop(false);
        liveStart();
      }
    });
    liveEls.model.addEventListener("change", function () {
      if (LIVE.running || LIVE.starting) {
        liveStop(false);
        liveStart();
      }
    });
  }

  function toggleLiveMute() {
    LIVE.muted = !LIVE.muted;
    if (LIVE.mic) LIVE.mic.getAudioTracks().forEach(function (t) { t.enabled = !LIVE.muted; });
    liveEls.mute.classList.toggle("k-muted", LIVE.muted);
    liveEls.mute.setAttribute("aria-label", LIVE.muted ? "Activar micrófono" : "Silenciar micrófono");
    liveEls.mute.title = LIVE.muted ? "Activar micrófono" : "Silenciar micrófono";
    if (LIVE.running) liveSetState(LIVE.muted ? "Micrófono silenciado" : "Escuchando…", !LIVE.muted);
  }

  function liveSetState(text, on) {
    if (liveEls.state) liveEls.state.textContent = text;
    if (liveEls.root) liveEls.root.classList.toggle("k-live-on", !!on);
  }

  function liveCaption(which, text) {
    var el = liveEls.captions && liveEls.captions[which];
    if (!el) return;
    el.innerHTML = text ? "<b>" + (which === "user" ? "Tú" : "KROHN") + "</b> · " + esc(text) : "";
  }

  function liveLoad() {
    if (!liveEls.root) return Promise.resolve();
    if (LIVE.geminiReady) return Promise.resolve();
    if (LIVE.loading) return LIVE.loading;
    LIVE.loading = S.api("/api/voice/live-key").then(function (r) { return r.json(); }).then(function (data) {
      var gem = (data.providers && data.providers.gemini) || {};
      LIVE.geminiReady = !!gem.available;
      LIVE.models = (gem.models || []).filter(function (m) {
        var id = String(m.id || "").toLowerCase();
        if (m.music || m.transcribe) return false;
        if (/extended-thinking|robotics|genie|translate|embedding|image|veo/.test(id)) return false;
        return /live|native-audio/.test(id);
      });
      if (!LIVE.models.length) {
        LIVE.models = [
          { id: "models/gemini-3.8-live", displayName: "Gemini 3.8 Live" },
          { id: "models/gemini-3.1-flash-live-preview", displayName: "Gemini 3.1 Flash Live" }
        ];
      }
      liveEls.model.innerHTML = LIVE.models.map(function (m) {
        return '<option value="' + esc(m.id) + '">' + esc(m.displayName || m.id) + "</option>";
      }).join("");
      var rec = LIVE.models.filter(function (m) { return m.id === gem.recommended; })[0];
      if (rec) liveEls.model.value = rec.id;
      if (!LIVE.geminiReady) {
        liveEls.note.textContent = "GEMINI_API_KEY no detectada. Revisa `krohn doctor`.";
        liveSetState("Gemini Live no disponible", false);
      } else {
        liveEls.note.textContent =
          "Gemini Live · la clave se queda en este equipo y viaja solo a Google. " +
          "La voz se fija al conectar: cambiarla reinicia la sesión.";
        liveSetState("Pulsa para hablar", false);
      }
    }).catch(function (e) {
      liveEls.note.textContent = "No se pudo leer /api/voice/live-key: " + (e.message || e);
    }).then(function () {
      LIVE.loading = null;
    });
    return LIVE.loading;
  }

  function openLive() {
    if (!liveEls.root) buildLive();
    openOverlay("k-live", "[data-start]");
    liveCaption("user", "");
    liveCaption("krohn", "");
    if (!LIVE.running) {
      if (LIVE.geminiReady) liveSetState("Pulsa para hablar", false);
      else liveSetState("Cargando modelos…", false);
    }
    liveLoad();
    if (LIVE.running) liveSetState(LIVE.muted ? "Micrófono silenciado" : "Escuchando…", !LIVE.muted);
  }

  function liveStage(s) {
    LIVE.stage = s;
    try { console.info("[krohn-live] " + s); } catch (_) {}
  }

  function liveStart() {
    if (LIVE.starting || LIVE.running) return;
    if (!LIVE.geminiReady) {
      liveSetState("Cargando modelos…", false);
      liveEls.start.disabled = true;
      liveLoad().then(function () {
        liveEls.start.disabled = false;
        if (LIVE.geminiReady) liveStart();
        else liveSetState("GEMINI_API_KEY no disponible", false);
      });
      return;
    }
    LIVE.starting = true;
    LIVE.muted = false;
    liveStage("start");
    liveSetState("Conectando con Gemini Live…", false);
    petSet("think");
    clearTimeout(LIVE.watchdog);
    LIVE.watchdog = setTimeout(function () {
      if (LIVE.running) return;
      liveSetState("Gemini no respondió (" + LIVE.stage + ")", false);
      liveEls.note.textContent =
        "Diagnóstico: " + LIVE.stage + ". Comprueba la clave y la conexión; vuelve a intentar.";
      liveStop(true);
    }, 18000);

    S.api("/api/voice/live-key").then(function (r) { return r.json(); }).then(function (data) {
      var key = data.providers && data.providers.gemini && data.providers.gemini.key;
      if (!key) throw new Error("sin clave Gemini");
      liveStage("mic");
      return navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      }).then(function (stream) {
        LIVE.mic = stream;
        liveStage("audio");
        var AC = window.AudioContext || window.webkitAudioContext;
        LIVE.audioIn = new AC({ sampleRate: 16000 });
        return LIVE.audioIn.resume().catch(function () {}).then(function () {
          var src = LIVE.audioIn.createMediaStreamSource(stream);
          LIVE.script = LIVE.audioIn.createScriptProcessor(2048, 1, 1);
          LIVE.analyser = LIVE.audioIn.createAnalyser();
          LIVE.analyser.fftSize = 128;
          var mute = LIVE.audioIn.createGain();
          mute.gain.value = 0;
          src.connect(LIVE.analyser);
          src.connect(LIVE.script);
          LIVE.script.connect(mute);
          mute.connect(LIVE.audioIn.destination);
          LIVE.script.onaudioprocess = function (e) {
            if (!LIVE.running || !LIVE.ws || LIVE.ws.readyState !== 1) return;
            var pcm = floatTo16(e.inputBuffer.getChannelData(0));
            LIVE.ws.send(JSON.stringify({
              realtimeInput: {
                audio: { mimeType: "audio/pcm;rate=16000", data: bytesToB64(new Uint8Array(pcm.buffer)) }
              }
            }));
          };
          LIVE.audioOut = new AC({ sampleRate: 24000 });
          LIVE.nextTime = 0;
          var model = liveEls.model.value || "models/gemini-3.8-live";
          var voice = liveEls.voice.value || liveVoiceStore();
          var wsUrl = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=" + encodeURIComponent(key);
          liveStage("socket");
          var ws = new WebSocket(wsUrl);
          LIVE.ws = ws;
          ws.addEventListener("open", function () {
            liveStage("open");
            ws.send(JSON.stringify({
              setup: {
                model: model,
                generationConfig: {
                  responseModalities: ["AUDIO"],
                  speechConfig: {
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } }
                  }
                },
                inputAudioTranscription: {},
                outputAudioTranscription: {},
                systemInstruction: { parts: [{ text: LIVE_SYSTEM }] }
              }
            }));
            liveStage("setup-sent");
          });
          ws.addEventListener("message", function (ev) {
            handleLiveFrame(ev.data);
          });
          ws.addEventListener("close", function (ev) {
            if (LIVE.running || LIVE.starting) {
              var why = ev && ev.reason ? " · " + ev.reason : "";
              liveStop(true);
              liveSetState("Conexión cerrada" + (ev && ev.code ? " (" + ev.code + ")" : "") + why, false);
            }
          });
          ws.addEventListener("error", function () {
            liveSetState("No se pudo conectar a Gemini Live", false);
            liveStop(true);
          });
        });
      });
    }).catch(function (e) {
      LIVE.starting = false;
      try { console.info("[krohn-live] error " + (e && e.message ? e.message : e)); } catch (_) {}
      liveSetState("No se pudo iniciar: " + (e.message || e), false);
      liveStop(true);
    });
  }

  function handleLiveFrame(raw) {
    if (raw == null) return;
    if (typeof raw === "string") { consumeLiveFrame(raw); return; }
    if (typeof Blob !== "undefined" && raw instanceof Blob) {
      raw.text().then(consumeLiveFrame).catch(function () {});
      return;
    }
    if (typeof ArrayBuffer !== "undefined" && raw instanceof ArrayBuffer) {
      try { consumeLiveFrame(new TextDecoder().decode(raw)); } catch (_) {}
      return;
    }
    consumeLiveFrame(String(raw));
  }

  function consumeLiveFrame(text) {
    var f;
    try { f = JSON.parse(text); } catch (_) { return; }
    if (f.error) {
      liveSetState("Error: " + (f.error.message || "desconocido"), false);
      liveStop(true);
      return;
    }
    if (f.setupComplete) {
      LIVE.running = true;
      LIVE.starting = false;
      liveStage("ready");
      clearTimeout(LIVE.watchdog);
      liveSetState("Escuchando…", true);
      petSet("idle");
      startWave();
      return;
    }
    var sc = f.serverContent || {};
    if (sc.interrupted) {
      LIVE.sources.forEach(function (s) { try { s.stop(); } catch (_) {} });
      LIVE.sources = [];
      LIVE.nextTime = 0;
    }
    if (sc.modelTurn && Array.isArray(sc.modelTurn.parts)) {
      sc.modelTurn.parts.forEach(function (part) {
        if (part.inlineData && part.inlineData.data) {
          var mime = part.inlineData.mimeType || "audio/pcm;rate=24000";
          var m = /rate=(\d+)/.exec(mime);
          enqueuePcm(b64ToBytes(part.inlineData.data), m ? parseInt(m[1], 10) : 24000);
          liveSetState("KROHN responde…", true);
          petSet("speaking");
        }
      });
    }
    if (sc.outputTranscription && sc.outputTranscription.text) liveCaption("krohn", sc.outputTranscription.text);
    if (sc.inputTranscription && sc.inputTranscription.text) liveCaption("user", sc.inputTranscription.text);
    if (sc.generationComplete || sc.turnComplete) {
      liveSetState(LIVE.muted ? "Micrófono silenciado" : "Escuchando…", !LIVE.muted);
      petSet("idle");
    }
  }

  function enqueuePcm(bytes, rate) {
    if (!LIVE.audioOut) return;
    var int16 = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    var f32 = new Float32Array(int16.length);
    for (var i = 0; i < int16.length; i++) f32[i] = int16[i] / 32768;
    var buf = LIVE.audioOut.createBuffer(1, f32.length, rate || 24000);
    buf.copyToChannel(f32, 0);
    var src = LIVE.audioOut.createBufferSource();
    src.buffer = buf;
    src.connect(LIVE.audioOut.destination);
    LIVE.sources.push(src);
    src.onended = function () {
      var idx = LIVE.sources.indexOf(src);
      if (idx >= 0) LIVE.sources.splice(idx, 1);
    };
    var now = LIVE.audioOut.currentTime;
    if (LIVE.nextTime < now) LIVE.nextTime = now + 0.02;
    src.start(LIVE.nextTime);
    LIVE.nextTime += buf.duration;
  }

  function startWave() {
    clearInterval(LIVE.waveTimer);
    LIVE.waveTimer = setInterval(function () {
      if (!liveEls.root) return;
      if (!LIVE.analyser) { liveEls.root.style.setProperty("--k-level", "0"); return; }
      var data = new Uint8Array(LIVE.analyser.fftSize);
      LIVE.analyser.getByteTimeDomainData(data);
      var sum = 0;
      for (var i = 0; i < data.length; i++) {
        var v = (data[i] - 128) / 128;
        sum += v * v;
      }
      var rms = Math.sqrt(sum / data.length);
      var level = Math.min(1, rms * 4.2);
      liveEls.root.style.setProperty("--k-level", level.toFixed(3));
    }, 70);
  }

  function liveStop(keepState) {
    clearTimeout(LIVE.watchdog);
    clearInterval(LIVE.waveTimer);
    try { if (LIVE.ws) LIVE.ws.close(); } catch (_) {}
    LIVE.ws = null;
    LIVE.running = false;
    LIVE.starting = false;
    LIVE.muted = false;
    if (LIVE.script) {
      try { LIVE.script.disconnect(); LIVE.script.onaudioprocess = null; } catch (_) {}
    }
    LIVE.script = null;
    if (LIVE.mic) LIVE.mic.getTracks().forEach(function (t) { try { t.stop(); } catch (_) {} });
    LIVE.mic = null;
    if (LIVE.audioIn) { LIVE.audioIn.close().catch(function () {}); LIVE.audioIn = null; }
    if (LIVE.audioOut) { LIVE.audioOut.close().catch(function () {}); LIVE.audioOut = null; }
    LIVE.sources = [];
    LIVE.nextTime = 0;
    if (liveEls.root) liveEls.root.style.setProperty("--k-level", "0");
    if (liveEls.mute) {
      liveEls.mute.classList.remove("k-muted");
      liveEls.mute.setAttribute("aria-label", "Silenciar micrófono");
    }
    if (!keepState) liveSetState("Pulsa para hablar", false);
    petSet("idle");
  }

  /* ------------------------------------------------------------------ */
  /* Meganote                                                           */
  /* ------------------------------------------------------------------ */

  var notesEls = {};

  function buildNotes() {
    var root = mk("div", "k-overlay");
    root.id = "k-notes";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "MEGANOTE — cuaderno local");
    root.setAttribute("aria-hidden", "true");
    root.innerHTML =
      '<div class="k-panel">' +
        '<div class="k-head">' +
          '<span class="k-title">MEGANOTE</span>' +
          '<span class="k-sub">Cuaderno local · sincronizado con KROHN</span>' +
          '<span class="k-credit" style="margin-left:auto">Creado por <b>Cesar D. Ciprian</b></span>' +
          '<button type="button" class="k-btn k-ghost" data-open>Abrir</button>' +
          '<button type="button" class="k-x" data-close aria-label="Cerrar MEGANOTE" title="Cerrar">×</button>' +
        "</div>" +
        '<iframe title="MEGANOTE" src="about:blank"></iframe>' +
      "</div>";
    document.body.appendChild(root);
    notesEls = { root: root, frame: $("iframe", root), loaded: false };
    $("[data-close]", root).addEventListener("click", function () { closeOverlay(root); });
    root.addEventListener("click", function (e) { if (e.target === root) closeOverlay(root); });
    $("[data-open]", root).addEventListener("click", function () {
      window.open(BASE + "/meganote/index.html", "_blank", "noopener");
    });
    notesEls.frame.addEventListener("load", function () {
      var src = notesEls.frame.getAttribute("src") || "";
      if (src.indexOf("about:blank") === 0) { notesEls.loaded = false; return; }
      notesEls.loaded = true;
      syncNotesTheme();
      sayNotesHello();
    });
    window.addEventListener("message", function (ev) {
      if (ev.origin !== location.origin) return;
      var d = ev.data;
      if (d && d.kromMeganoteHello) sayNotesHello();
    });
  }

  function openNotes() {
    if (!notesEls.root) buildNotes();
    if (!notesEls.loaded) notesEls.frame.src = BASE + "/meganote/index.html";
    openOverlay("k-notes", '[data-close]');
    sayNotesHello();
    setTimeout(function () {
      syncNotesTheme();
      sayNotesHello();
    }, 500);
    setTimeout(function () {
      syncNotesTheme();
      sayNotesHello();
    }, 1800);
  }

  function sayNotesHello() {
    if (!notesEls.frame || !notesEls.frame.contentWindow) return;
    try {
      notesEls.frame.contentWindow.postMessage(
        { kromMeganote: { token: TOKEN() } },
        location.origin
      );
    } catch (_) {}
  }

  function syncNotesTheme() {
    if (!notesEls.frame) return;
    var doc = null, win = null;
    try { doc = notesEls.frame.contentDocument; win = notesEls.frame.contentWindow; } catch (_) { return; }
    if (!doc || !doc.head) return;
    try { win.localStorage.setItem("takenotes.theme", "dark"); } catch (_) {}
    try { doc.documentElement.dataset.theme = "dark"; } catch (_) {}
    var style = doc.getElementById("krohn-notes-theme");
    if (!style) {
      style = doc.createElement("style");
      style.id = "krohn-notes-theme";
      style.textContent =
        ":root,html[data-theme=dark]{--paper:#0D0D0F!important;--ink:#F2F2F5!important;" +
        "--terra:#E0503E!important;--sage:#30D158!important;color-scheme:dark!important}" +
        "html,body{background:#0D0D0F!important}::selection{background:#E0503E!important;color:#050505!important}";
      doc.head.appendChild(style);
    }
  }

  function notesOnClose() {
    /* The Meganote app is a full SPA; unload it when the modal closes so the
       dashboard stays inside the ~3.7 GB budget. Reopening re-boots from
       IndexedDB and the sync bridge hydrates in under a second. */
    if (!notesEls.frame) return;
    setTimeout(function () {
      if (notesEls.root && notesEls.root.classList.contains("k-open")) return;
      try { notesEls.frame.src = "about:blank"; } catch (_) {}
      notesEls.loaded = false;
    }, 800);
  }

  /* ------------------------------------------------------------------ */
  /* Skills / commands palette                                          */
  /* ------------------------------------------------------------------ */

  var PAL = {
    tab: "skills",
    skills: null,
    commands: null,
    rows: [],
    active: 0,
    query: "",
    loading: false
  };
  var palEls = {};

  function buildPalette() {
    var root = mk("div", "k-overlay");
    root.id = "k-palette";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Skills y comandos de KROHN");
    root.setAttribute("aria-hidden", "true");
    root.innerHTML =
      '<div class="k-panel">' +
        '<div class="k-head">' +
          '<div class="k-tabs" role="tablist" aria-label="Skills y comandos">' +
            '<button type="button" class="k-tab on" data-tab="skills" role="tab" aria-selected="true">Skills</button>' +
            '<button type="button" class="k-tab" data-tab="commands" role="tab" aria-selected="false">Comandos</button>' +
          "</div>" +
          '<button type="button" class="k-x" data-close aria-label="Cerrar paleta" title="Cerrar">×</button>' +
        "</div>" +
        '<div class="k-search">' + svg(ICONS.search, 14) +
          '<input type="text" data-q placeholder="Buscar skills…" aria-label="Buscar" autocomplete="off" spellcheck="false">' +
          "<kbd>ESC</kbd>" +
        "</div>" +
        '<div class="k-list" role="listbox" data-list></div>' +
        '<div class="k-palette-foot">' +
          '<span data-hint>Enter inserta en el chat</span>' +
          '<button type="button" class="k-link" data-files>Insertar @ (archivos)</button>' +
          '<span class="k-credit">Creado por <b>Cesar D. Ciprian</b></span>' +
        "</div>" +
      "</div>";
    document.body.appendChild(root);
    palEls = {
      root: root,
      q: $("[data-q]", root),
      list: $("[data-list]", root),
      hint: $("[data-hint]", root)
    };
    $("[data-close]", root).addEventListener("click", function () { closeOverlay(root); });
    root.addEventListener("click", function (e) { if (e.target === root) closeOverlay(root); });
    $("[data-files]", root).addEventListener("click", function () {
      closeOverlay(root);
      if (!chatInsert("@")) S.sendToPty("@");
    });
    $$(".k-tab", root).forEach(function (b) {
      b.addEventListener("click", function () { setPaletteTab(b.dataset.tab); });
    });
    palEls.q.addEventListener("input", function () {
      PAL.query = palEls.q.value.trim().toLowerCase();
      PAL.active = 0;
      renderPalette();
    });
    palEls.q.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); movePalette(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); movePalette(-1); }
      else if (e.key === "Enter") { e.preventDefault(); choosePalette(); }
      else if (e.key === "Escape") { e.preventDefault(); closeOverlay(root); }
    });
  }

  function setPaletteTab(tab) {
    PAL.tab = tab;
    PAL.active = 0;
    PAL.query = "";
    if (palEls.q) palEls.q.value = "";
    if (palEls.q) palEls.q.placeholder = tab === "skills" ? "Buscar skills…" : "Buscar comandos…";
    $$(".k-tab", palEls.root).forEach(function (b) {
      var on = b.dataset.tab === tab;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (tab === "skills" && !PAL.skills) loadSkills();
    if (tab === "commands" && !PAL.commands) loadCommands();
    renderPalette();
  }

  function openPalette(tab, hint) {
    if (!palEls.root) buildPalette();
    setPaletteTab(tab || "skills");
    openOverlay("k-palette", "[data-q]");
    if (hint) palEls.hint.textContent = hint;
    if (tab === "skills" && !PAL.skills) loadSkills();
    if (tab === "commands" && !PAL.commands) loadCommands();
  }

  function loadSkills() {
    PAL.loading = true;
    S.api("/api/skills").then(function (r) {
      if (!r.ok) throw new Error("skills " + r.status);
      return r.json();
    }).then(function (data) {
      PAL.skills = Array.isArray(data) ? data : (data.skills || []);
      PAL.loading = false;
      renderPalette();
    }).catch(function (e) {
      PAL.skills = [];
      PAL.loading = false;
      renderPalette("No se pudieron leer las skills: " + (e.message || e));
    });
  }

  function loadCommands() {
    PAL.loading = true;
    gwCall("complete.slash", { text: "/" }, 12000).then(function (r) {
      PAL.commands = (r && r.items) || [];
      PAL.loading = false;
      renderPalette();
    }).catch(function (e) {
      PAL.commands = [];
      PAL.loading = false;
      renderPalette("No se pudieron leer los comandos: " + (e.message || e));
    });
  }

  function paletteRows() {
    if (PAL.tab === "skills") {
      var skills = PAL.skills || [];
      return skills.map(function (s) {
        return {
          kind: "skill",
          name: s.name,
          text: "/" + s.name + " ",
          desc: s.description || "",
          meta: (s.category || "skill"),
          usage: s.usage || 0,
          enabled: s.enabled !== false
        };
      });
    }
    return (PAL.commands || []).map(function (c) {
      var text = (c.text || "").trim();
      if (text && text.charAt(0) !== "/") text = "/" + text;
      return {
        kind: c.kind || "command",
        name: text || c.display || "",
        text: text + (text && text.indexOf(" ") === -1 ? " " : ""),
        desc: c.meta || "",
        meta: c.kind || "command",
        usage: 0,
        enabled: true
      };
    });
  }

  function renderPalette(error) {
    if (!palEls.list) return;
    if (PAL.loading && !error) {
      palEls.list.innerHTML = '<div class="k-empty">Cargando…</div>';
      return;
    }
    var rows = paletteRows();
    var q = PAL.query;
    if (q) {
      rows = rows.filter(function (r) {
        return (r.name + " " + r.desc + " " + r.meta).toLowerCase().indexOf(q) !== -1;
      });
    }
    if (PAL.tab === "skills") {
      rows.sort(function (a, b) {
        if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
        if (b.usage !== a.usage) return b.usage - a.usage;
        return a.name.localeCompare(b.name);
      });
    }
    PAL.rows = rows;
    if (PAL.active >= rows.length) PAL.active = Math.max(0, rows.length - 1);
    if (error) {
      palEls.list.innerHTML = '<div class="k-empty">' + esc(error) + "</div>";
      return;
    }
    if (!rows.length) {
      palEls.list.innerHTML = '<div class="k-empty">' +
        (PAL.tab === "skills" ? "No hay skills que coincidan." : "No hay comandos que coincidan.") + "</div>";
      return;
    }
    var frag = document.createDocumentFragment();
    rows.forEach(function (r, idx) {
      var row = mk("div", "k-row" + (idx === PAL.active ? " on" : ""));
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", idx === PAL.active ? "true" : "false");
      row.dataset.idx = String(idx);
      row.innerHTML =
        '<span class="k-row-name">' + esc(r.name) + "</span>" +
        '<span class="k-row-meta">' +
          (r.kind === "skill" ? '<span class="k-badge k-skill">skill</span>' : "") +
          (r.meta && r.meta !== r.kind
            ? '<span class="k-badge' + (r.enabled ? "" : " k-off") + '">' + esc(r.meta) + "</span>"
            : "") +
          (r.usage ? "<span>×" + r.usage + "</span>" : "") +
        "</span>" +
        (r.desc ? '<span class="k-row-desc">' + esc(r.desc) + "</span>" : "");
      row.addEventListener("mouseenter", function () { setPaletteActive(idx, false); });
      row.addEventListener("click", function () { setPaletteActive(idx, false); choosePalette(); });
      frag.appendChild(row);
    });
    palEls.list.innerHTML = "";
    palEls.list.appendChild(frag);
    if (palEls.list.children[PAL.active]) {
      var activeEl = palEls.list.children[PAL.active];
      if (activeEl.scrollIntoView) activeEl.scrollIntoView({ block: "nearest" });
    }
  }

  function setPaletteActive(idx, scroll) {
    if (!PAL.rows.length) return;
    PAL.active = clamp(idx, 0, PAL.rows.length - 1);
    var rows = $$(".k-row", palEls.list);
    rows.forEach(function (r, i) {
      r.classList.toggle("on", i === PAL.active);
      r.setAttribute("aria-selected", i === PAL.active ? "true" : "false");
    });
    if (scroll !== false && rows[PAL.active] && rows[PAL.active].scrollIntoView) {
      rows[PAL.active].scrollIntoView({ block: "nearest" });
    }
  }

  function movePalette(delta) {
    if (!PAL.rows.length) return;
    setPaletteActive(PAL.active + delta);
  }

  function choosePalette() {
    var r = PAL.rows[PAL.active];
    if (!r) return;
    closeOverlay("k-palette");
    if (PAL.tab === "commands" && CHAT.panel && CHAT.sessionId && chatOnRoute()) {
      runChatCommand(r.text);
      return;
    }
    if (!chatInsert(r.text)) S.sendToPty(r.text);
  }

  function runChatCommand(cmd) {
    chatNotice("Comando: " + cmd, "info");
    gwCall("slash.exec", { session_id: CHAT.sessionId, command: cmd }, 45000).then(function (res) {
      var out = res.output || res.message || res.notice || res.display || "";
      if (res.warning) out = out ? res.warning + "\n" + out : res.warning;
      chatNotice(out || "Comando ejecutado.", res.warning ? "wait" : "info");
    }).catch(function (e) {
      chatNotice("Comando falló: " + (e.message || e), "error");
    });
  }

  /* Skills / commands land in the dashboard chat composer when it is the
     visible surface, instead of the hidden embedded terminal. */
  function chatInsert(text) {
    if (!CHAT.panel || !CHAT.input || !/^\/chat\/?$/.test(location.pathname)) return false;
    var cur = CHAT.input.value.replace(/\s*$/, "");
    CHAT.input.value = cur ? cur + " " + text : text;
    CHAT.input.focus();
    autoGrowChat();
    return true;
  }

  /* @ opens the Skills palette when typed in the embedded terminal. The
     dashboard's native @file completion is still one click away. */
  document.addEventListener("keydown", function (e) {
    if (e.key !== "@" || e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    if (!t) return;
    if (t.closest && t.closest("#k-palette")) return;
    var inTerm = (t.classList && t.classList.contains("xterm-helper-textarea")) ||
      (t.closest && t.closest(".xterm"));
    if (!inTerm) return;
    e.preventDefault();
    e.stopPropagation();
    openPalette("skills", "Escribe @ en el chat para abrir esta paleta");
  }, true);

  /* ------------------------------------------------------------------ */
  /* Pet                                                                */
  /* ------------------------------------------------------------------ */

  var PET_ROWS = {
    idle: 0, work: 1, think: 3, wave: 3, jump: 4, failed: 5,
    waiting: 6, loading: 6, coding: 7, review: 8, speaking: 3
  };
  var PET_LABEL = {
    idle: "", think: "pensando", work: "trabajando", coding: "trabajando",
    loading: "cargando", speaking: "respondiendo", waiting: "esperando",
    failed: "error", wave: "terminado", review: "pensando"
  };

  var pet = {
    el: null,
    sprite: null,
    bubble: null,
    state: "idle",
    label: "",
    idleTimer: null,
    bubbleTimer: null,
    pos: null
  };

  function buildPet() {
    var el = mk("button", "");
    el.id = "krohn-pet";
    el.type = "button";
    el.title = "KROHN — clic para Live · arrastra para mover";
    el.setAttribute("aria-label", "KROHN chibi — clic para abrir Live");
    el.innerHTML =
      '<span class="k-sprite" aria-hidden="true"></span>' +
      '<span class="k-pet-bubble" aria-hidden="true">' +
        '<i class="k-pet-cloud"></i>' +
        '<span class="k-pet-text"></span>' +
        '<i class="k-pet-dots"></i>' +
      "</span>";
    document.body.appendChild(el);
    pet.el = el;
    pet.sprite = $(".k-sprite", el);
    pet.bubble = $(".k-pet-text", el);

    try { pet.pos = JSON.parse(localStorage.getItem("krohn.pet.pos") || "null"); } catch (_) { pet.pos = null; }
    if (pet.pos) applyPetPos();
    petSet("idle", "", 0);

    var drag = null;
    el.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      var r = el.getBoundingClientRect();
      drag = { sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, moved: false };
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      el.classList.add("k-drag");
    });
    el.addEventListener("pointermove", function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
      var r = el.getBoundingClientRect();
      var x = clamp(drag.ox + dx, 4, window.innerWidth - r.width - 4);
      var y = clamp(drag.oy + dy, 4, window.innerHeight - r.height - 4);
      el.style.left = x + "px";
      el.style.top = y + "px";
      el.style.right = "auto";
      el.style.bottom = "auto";
    });
    el.addEventListener("pointerup", function (e) {
      if (!drag) return;
      var moved = drag.moved;
      el.classList.remove("k-drag");
      if (moved) {
        var r = el.getBoundingClientRect();
        pet.pos = { x: r.left, y: r.top };
        try { localStorage.setItem("krohn.pet.pos", JSON.stringify(pet.pos)); } catch (_) {}
      } else {
        if (LIVE.running || LIVE.starting) liveStop(true);
        openLive();
      }
      drag = null;
      try { el.releasePointerCapture(e.pointerId); } catch (_) {}
    });
    el.addEventListener("pointercancel", function () {
      drag = null;
      el.classList.remove("k-drag");
    });
    window.addEventListener("resize", function () { if (pet.pos) applyPetPos(); });
  }

  function applyPetPos() {
    if (!pet.el || !pet.pos) return;
    var r = pet.el.getBoundingClientRect();
    var x = clamp(pet.pos.x, 4, window.innerWidth - (r.width || 96) - 4);
    var y = clamp(pet.pos.y, 4, window.innerHeight - (r.height || 101) - 4);
    pet.el.style.left = x + "px";
    pet.el.style.top = y + "px";
    pet.el.style.right = "auto";
    pet.el.style.bottom = "auto";
  }

  function petSet(state, label, holdMs) {
    if (!pet.el) return;
    var key = PET_ROWS[state] == null ? "idle" : state;
    var text = label == null ? (PET_LABEL[key] || "") : label;
    if (pet.state === key && pet.label === text) return;
    pet.state = key;
    pet.label = text;
    var row = PET_ROWS[key];
    var h = pet.el.clientHeight || 101.33;
    pet.sprite.style.backgroundPositionY = (-row * h) + "px";
    pet.el.classList.toggle("k-busy", key === "think" || key === "work" || key === "coding" || key === "loading");
    pet.el.classList.toggle("k-waiting", key === "waiting");
    pet.el.classList.toggle("k-speaking", key === "speaking");
    pet.el.classList.toggle("k-failed", key === "failed");
    pet.el.dataset.tone = key === "failed" ? "error" : key === "waiting" ? "wait" : key === "speaking" ? "talk" : "work";
    clearTimeout(pet.bubbleTimer);
    if (text) {
      pet.bubble.textContent = text;
      pet.el.classList.add("k-show-bubble");
      /* Busy states keep their cloud visible for as long as the state holds;
         the idle cloud is a short "terminado" beat, not a permanent label. */
      if (key === "idle" || key === "wave") {
        pet.bubbleTimer = setTimeout(function () { pet.el.classList.remove("k-show-bubble"); }, 4600);
      }
    } else {
      pet.el.classList.remove("k-show-bubble");
    }
    clearTimeout(pet.idleTimer);
    if (holdMs && holdMs > 0) {
      pet.idleTimer = setTimeout(function () { petSet("idle", "", 0); }, holdMs);
    }
  }

  function petIdleSoon(ms) {
    clearTimeout(pet.idleTimer);
    pet.idleTimer = setTimeout(function () { petSet("idle", "", 0); }, ms || 7000);
  }

  function petEvent(ev) {
    if (!ev) return;
    var type = ev.type, p = ev.payload || {};
    if (type === "message.start") { petSet("think"); petIdleSoon(30000); }
    else if (type === "thinking.delta" || type === "reasoning.delta") { petSet("think"); petIdleSoon(30000); }
    else if (type === "tool.generating") { petSet("work"); petIdleSoon(30000); }
    else if (type === "tool.start") {
      var name = String(p.name || "").toLowerCase();
      if (name === "clarify" || name === "approval") {
        petSet("waiting");
      } else if (/(terminal|shell|exec|bash|powershell|write|edit|patch|code|apply)/.test(name)) {
        petSet("coding");
      } else {
        petSet("work");
      }
      petIdleSoon(30000);
    }
    else if (type === "tool.complete") { petIdleSoon(2500); }
    else if (type === "message.delta") { petSet("speaking"); petIdleSoon(30000); }
    else if (type === "message.complete") {
      if (p.status === "error") petSet("failed", "error", 6000);
      else petSet("idle", "terminado", 4600);
    }
    else if (type === "error") { petSet("failed", "error", 6000); }
    else if (type === "clarify.request" || type === "approval.request") { petSet("waiting", "esperando", 20000); }
    else if (type === "status.update" && /compress|compact/.test(String(p.kind || ""))) { petSet("loading", "cargando", 12000); }
    else if (type === "gateway.reconnecting") { petSet("loading", "cargando", 6000); }
  }

  /* ------------------------------------------------------------------ */
  /* Pet event polling (replay buffer, no transport hijack)             */
  /* ------------------------------------------------------------------ */

  var petSession = null;
  var petSeq = 0;
  var petSessionAt = 0;
  var petPollBusy = false;

  function petPoll() {
    if (petPollBusy) return;
    petPollBusy = true;
    var now = Date.now();
    var needSession = !petSession || now - petSessionAt > 12000;
    var p = needSession
      ? gwCall("session.most_recent", {}, 8000).then(function (r) {
          petSessionAt = now;
          if (r && r.session_id && r.session_id !== petSession) {
            petSession = r.session_id;
            petSeq = 0;
          }
        })
      : Promise.resolve();
    p.then(function () {
      if (!petSession) return null;
      return gwCall("session.events.since", { session_id: petSession, last_seen: petSeq }, 8000)
        .then(function (r) {
          if (!r) return;
          if (r.truncated) { petSeq = r.latest_seq || 0; return; }
          (r.events || []).forEach(petEvent);
          if (typeof r.latest_seq === "number") petSeq = r.latest_seq;
        });
    }).catch(function () {
      /* gateway may be restarting; next tick reconnects */
    }).then(function () {
      petPollBusy = false;
    });
  }

  function startPetPolling() {
    setTimeout(function () {
      gwConnect().catch(function () {});
      petPoll();
      setInterval(petPoll, 1600);
    }, 2200);
  }

  /* ------------------------------------------------------------------ */
  /* Chat — a normal conversation surface over the same gateway          */
  /* ------------------------------------------------------------------ */

  var CHAT = {
    panel: null,
    scroll: null,
    list: null,
    input: null,
    send: null,
    picker: null,
    title: null,
    sessionId: null,
    pickerId: null,
    sessions: [],
    seq: 0,
    polling: false,
    timer: null,
    streaming: false,
    turn: null,
    toolEls: {},
    openCards: {},
    stick: true,
    seqReady: false,
    lastHandled: 0,
    queuedSend: null,
    mounted: false
  };

  function chatOnRoute() {
    return /^\/chat\/?$/.test(location.pathname);
  }

  function mountChat() {
    if (!chatOnRoute()) { unmountChat(); return; }
    var host = document.querySelector(".krohn-chat-xterm-host");
    if (!host) return;
    host.classList.add("k-chat-hide-terminal");
    var parent = host.parentElement;
    if (!parent) return;
    if (CHAT.panel && CHAT.panel.parentElement === parent) {
      CHAT.mounted = true;
      hideStockChatChrome(parent);
      return;
    }
    buildChat(parent);
    CHAT.mounted = true;
    tagChatAside(parent);
    hideStockChatChrome(parent);
    refreshChatSessions();
    if (CHAT.sessionId) {
      resumeChat(CHAT.pickerId || CHAT.sessionId).catch(function () { return newChat(); });
    } else {
      newChat();
    }
  }

  function unmountChat() {
    if (CHAT.panel) { try { CHAT.panel.remove(); } catch (_) {} }
    CHAT.panel = null;
    CHAT.mounted = false;
    clearInterval(CHAT.timer);
    CHAT.timer = null;
    var host = document.querySelector(".krohn-chat-xterm-host");
    if (host) host.classList.remove("k-chat-hide-terminal");
    Array.prototype.forEach.call(document.querySelectorAll(".k-chat-aside"), function (n) {
      n.classList.remove("k-chat-aside");
    });
  }

  function buildChat(parent) {
    var panel = mk("div", "");
    panel.id = "krohn-chat";
    panel.innerHTML =
      '<div class="kc-head">' +
        '<button type="button" class="kc-new" title="Nueva conversación" aria-label="Nueva conversación">＋</button>' +
        '<select class="kc-picker" aria-label="Conversaciones"></select>' +
        '<span class="kc-status" data-kc-status></span>' +
      "</div>" +
      '<div class="kc-scroll" data-kc-scroll>' +
        '<div class="kc-empty" data-kc-empty>' +
          '<b>KROHN</b><span>Escribe abajo para empezar. Las herramientas, el pensamiento y las respuestas aparecen aquí.</span>' +
        "</div>" +
      "</div>" +
      '<div class="kc-composer">' +
        '<textarea class="kc-input" data-kc-input rows="1" placeholder="Escribe a KROHN…" aria-label="Mensaje para KROHN"></textarea>' +
        '<button type="button" class="kc-send" data-kc-send aria-label="Enviar mensaje" title="Enviar">' +
          '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5.5 11.5L12 5l6.5 6.5"/></svg>' +
        "</button>" +
        '<button type="button" class="kc-stop k-chat-hidden" data-kc-stop aria-label="Detener respuesta" title="Detener">■</button>' +
      "</div>";
    parent.appendChild(panel);

    CHAT.panel = panel;
    CHAT.scroll = $("[data-kc-scroll]", panel);
    CHAT.list = $("[data-kc-empty]", panel).parentElement;
    CHAT.input = $("[data-kc-input]", panel);
    CHAT.send = $("[data-kc-send]", panel);
    CHAT.picker = $(".kc-picker", panel);
    CHAT.title = $("[data-kc-status]", panel);

    $(".kc-new", panel).addEventListener("click", function () { void newChat(); });
    CHAT.send.addEventListener("click", function () { if (!CHAT.streaming) void sendChat(); });
    $("[data-kc-stop]", panel).addEventListener("click", function () { void stopChat(); });
    CHAT.input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!CHAT.streaming) void sendChat(); }
    });
    CHAT.input.addEventListener("input", autoGrowChat);
    CHAT.scroll.addEventListener("scroll", function () {
      CHAT.stick = CHAT.scroll.scrollHeight - CHAT.scroll.scrollTop - CHAT.scroll.clientHeight < 90;
    });
    CHAT.picker.addEventListener("change", function () {
      var id = CHAT.picker.value;
      if (id && id !== CHAT.pickerId) void openChat(id);
    });
  }

  function tagChatAside(hostParent) {
    if (!hostParent) return;
    var row = hostParent.parentElement;
    if (!row) return;
    Array.prototype.forEach.call(row.children, function (kid) {
      if (kid !== hostParent && !kid.contains(hostParent)) kid.classList.add("k-chat-aside");
    });
  }

  /* The stock ChatPage still runs behind the panel; when its PTY ends it
     paints a full-screen English overlay (and a copy button bound to the
     hidden terminal) above our chat. Hide those, never the page frame. */
  function hideStockChatChrome(parent) {
    var host = document.querySelector(".krohn-chat-xterm-host");
    var scope = (parent && parent.parentElement) || document.body;
    var re = /Chat session ended|Chat could not start|Please wait while the conversation loads|Chat disconnected|Chat is reconnecting|copy last response/i;
    Array.prototype.forEach.call(scope.querySelectorAll("div.absolute,div.fixed,button"), function (n) {
      if (CHAT.panel && (n.contains(CHAT.panel) || CHAT.panel.contains(n))) return;
      if (host && n.contains(host)) return;
      if (re.test(n.textContent || "") || re.test(n.getAttribute("aria-label") || "")) {
        n.classList.add("k-chat-hide-extra");
      }
    });
  }

  function autoGrowChat() {
    if (!CHAT.input) return;
    CHAT.input.style.height = "auto";
    CHAT.input.style.height = Math.min(CHAT.input.scrollHeight, 168) + "px";
  }

  function chatScrollBottom(force) {
    if (!CHAT.scroll) return;
    var typing = $(".kc-typing", CHAT.panel);
    if (typing) CHAT.list.appendChild(typing);
    if (force || CHAT.stick !== false) CHAT.scroll.scrollTop = CHAT.scroll.scrollHeight;
  }

  function chatClear() {
    if (!CHAT.list) return;
    Array.prototype.slice.call(CHAT.list.querySelectorAll(".kc-msg,.kc-tool,.kc-notice,.kc-todos,.kc-typing")).forEach(function (n) { n.remove(); });
    var empty = $("[data-kc-empty]", CHAT.panel);
    if (empty) empty.classList.remove("k-chat-hidden");
    CHAT.turn = null;
    CHAT.toolEls = {};
    CHAT.openCards = {};
  }

  function chatEmpty(show) {
    var empty = CHAT.panel && $("[data-kc-empty]", CHAT.panel);
    if (empty) empty.classList.toggle("k-chat-hidden", !show);
  }

  function chatStatus(text) {
    if (!CHAT.title) return;
    CHAT.title.textContent = text || "";
  }

  function chatRelative(ts) {
    if (!ts) return "";
    var s = Math.max(0, (Date.now() / 1000) - ts);
    if (s < 60) return "ahora";
    if (s < 3600) return Math.round(s / 60) + "m";
    if (s < 86400) return Math.round(s / 3600) + "h";
    return Math.round(s / 86400) + "d";
  }

  function renameChatOption(sid, title) {
    if (!CHAT.picker || !title) return;
    var hit = null;
    Array.prototype.forEach.call(CHAT.picker.options, function (o) {
      if (o.value === sid) hit = o;
    });
    if (!hit && CHAT.pickerId) {
      Array.prototype.forEach.call(CHAT.picker.options, function (o) {
        if (o.value === CHAT.pickerId) hit = o;
      });
    }
    if (!hit) return;
    CHAT.sessions.forEach(function (r) { if (r.id === hit.value) r.title = title; });
    hit.textContent = title + " · ahora";
  }

  function chatLabel(row) {
    var t = (row.title || "").trim() || "Sesión sin título";
    return t + " · " + chatRelative(row.started_at);
  }

  function fillChatPicker(rows) {
    CHAT.sessions = rows || [];
    if (!CHAT.picker) return;
    CHAT.picker.innerHTML = CHAT.sessions.map(function (r) {
      return '<option value="' + esc(r.id) + '">' + esc(chatLabel(r)) + "</option>";
    }).join("");
    if (CHAT.pickerId) {
      var has = Array.prototype.some.call(CHAT.picker.options, function (o) { return o.value === CHAT.pickerId; });
      if (!has) {
        var opt = document.createElement("option");
        opt.value = CHAT.pickerId;
        opt.textContent = "Conversación actual";
        CHAT.picker.insertBefore(opt, CHAT.picker.firstChild);
      }
      CHAT.picker.value = CHAT.pickerId;
    }
  }

  function refreshChatSessions() {
    return gwCall("session.list", { limit: 40 }, 9000).then(function (r) {
      fillChatPicker((r && r.sessions) || []);
    }).catch(function () {});
  }

  function adoptChat(runtimeId, messages, pickerId, label) {
    CHAT.sessionId = runtimeId;
    CHAT.pickerId = pickerId;
    CHAT.lastHandled = 0;
    chatClear();
    var msgs = messages || [];
    msgs.forEach(renderHistoryMessage);
    chatEmpty(msgs.length === 0);
    if (CHAT.picker) {
      var has = Array.prototype.some.call(CHAT.picker.options, function (o) { return o.value === pickerId; });
      if (!has) {
        var opt = document.createElement("option");
        opt.value = pickerId;
        opt.textContent = label || "Conversación actual";
        CHAT.picker.insertBefore(opt, CHAT.picker.firstChild);
      }
      CHAT.picker.value = pickerId;
    }
    chatScrollBottom();
    chatStatus(msgs.length ? "" : "Conversación nueva");
    CHAT.stick = true;
    CHAT.seqReady = false;
    return gwCall("session.activate", { session_id: runtimeId, omit_messages: true }, 15000).then(function () {
      if (window.__krohnChatDebug) console.warn("[krohn-chat] activated", runtimeId);
    }).catch(function (e) {
      if (window.__krohnChatDebug) console.warn("[krohn-chat] activate failed", e && e.message);
    }).then(function () {
      return gwCall("session.events.since", { session_id: runtimeId, last_seen: 0 }, 9000).then(function (ev) {
        CHAT.seq = (ev && ev.latest_seq) || 0;
        replayOpenRequests(ev && ev.open_requests);
        CHAT.seqReady = true;
        startChatPolling();
        flushQueuedChat();
      }).catch(function () { CHAT.seqReady = true; startChatPolling(); flushQueuedChat(); });
    });
  }

  function openChat(id) {
    CHAT.pickerId = id;
    return resumeChat(id).catch(function (e) {
      chatStatus("");
      chatNotice("No se pudo abrir la conversación: " + (e.message || e), "error");
    });
  }

  function resumeChat(id) {
    CHAT.sessionId = null;
    CHAT.seq = 0;
    CHAT.seqReady = false;
    CHAT.lastHandled = 0;
    CHAT.streaming = false;
    chatClear();
    chatEmpty(true);
    chatStatus("Cargando conversación…");
    return gwCall("session.resume", { session_id: id, source: "webapp" }, 90000).then(function (r) {
      var runtime = (r && r.session_id) || id;
      var messages = (r && r.messages) || [];
      if (!messages.length) {
        return gwCall("session.history", { session_id: runtime }, 15000).then(function (h) {
          return adoptChat(runtime, (h && h.messages) || [], id);
        });
      }
      return adoptChat(runtime, messages, id);
    });
  }

  var chatCreating = false;

  function newChat() {
    if (chatCreating) return Promise.resolve();
    chatCreating = true;
    chatStatus("Creando conversación…");
    CHAT.seqReady = false;
    return gwCall("session.create", { source: "webapp" }, 45000).then(function (r) {
      if (!r || !r.session_id) throw new Error("no se pudo crear la sesión");
      return adoptChat(r.session_id, r.messages || [], r.stored_session_id || r.session_id, "Nueva conversación");
    }).catch(function (e) {
      chatNotice("No se pudo crear la conversación: " + (e.message || e), "error");
    }).then(function () { chatCreating = false; });
  }

  function startChatPolling() {
    clearInterval(CHAT.timer);
    CHAT.timer = setInterval(chatPoll, 1500);
  }

  function chatPoll() {
    if (!CHAT.sessionId || CHAT.polling || !CHAT.mounted) return;
    var sid = CHAT.sessionId;
    CHAT.polling = true;
    gwCall("session.events.since", { session_id: sid, last_seen: CHAT.seq }, 8000).then(function (r) {
      if (!r || sid !== CHAT.sessionId) return;
      if (window.__krohnChatDebug) console.warn("[krohn-chat] poll", r.count, r.latest_seq, r.truncated);
      if (r.truncated) {
        CHAT.seq = r.latest_seq || 0;
        return gwCall("session.history", { session_id: sid }, 12000).then(function (h) {
          chatClear();
          ((h && h.messages) || []).forEach(renderHistoryMessage);
          chatScrollBottom();
        });
      }
      (r.events || []).forEach(handleChatEventOnce);
      replayOpenRequests(r.open_requests);
      if (typeof r.latest_seq === "number") CHAT.seq = Math.max(CHAT.seq, r.latest_seq);
    }).catch(function (e) {
      if (window.__krohnChatDebug) console.warn("[krohn-chat] poll failed", e && e.message);
    }).then(function () { CHAT.polling = false; });
  }

  function handleChatEventOnce(ev) {
    if (!ev) return;
    if (typeof ev.seq === "number") {
      if (ev.seq <= CHAT.lastHandled) return;
      CHAT.lastHandled = ev.seq;
      if (ev.seq > CHAT.seq) CHAT.seq = ev.seq;
    }
    handleChatEvent(ev);
  }

  function handleChatEvent(ev) {
    if (!ev) return;
    var type = ev.type, p = ev.payload || {};
    if (type === "message.start") {
      chatEmpty(false);
      CHAT.streaming = true;
      setChatStop(true);
      chatTyping(true);
      chatStatus("Pensando…");
      petSet("think");
      return;
    }
    if (type === "thinking.delta") {
      chatStatus("Pensando…");
      return;
    }
    if (type === "reasoning.delta") {
      addThinking(p.text || p.delta || "");
      return;
    }
    if (type === "message.delta") {
      chatTyping(false);
      addAssistantDelta(p.text || p.delta || "");
      chatStatus("Respondiendo…");
      petSet("speaking");
      return;
    }
    if (type === "message.interim") {
      if (p.text) addAssistantDelta((p.already_streamed ? "" : "") + p.text + "\n\n");
      return;
    }
    if (type === "tool.start") {
      chatTyping(false);
      addToolStart(p);
      chatStatus("Ejecutando " + (p.name || "herramienta") + "…");
      petSet("work");
      return;
    }
    if (type === "tool.complete") {
      completeTool(p);
      chatStatus("Pensando…");
      petSet("think");
      return;
    }
    if (type === "session.title") {
      renameChatOption(p.session_id, p.title);
      return;
    }
    if (type === "message.complete") {
      chatTyping(false);
      if (p.status === "error") chatNotice(p.error || p.message || "El turno falló.", "error");
      finalizeAssistant(p);
      CHAT.streaming = false;
      setChatStop(false);
      chatStatus("");
      petSet("idle", "terminado", 4600);
      refreshChatSessions();
      return;
    }
    if (type === "error") {
      chatTyping(false);
      chatNotice(p.message || "Error del agente.", "error");
      return;
    }
    if (type === "request.cancel") {
      dropServerCard(p.id);
      return;
    }
    if (type === "approval.request") {
      addApproval(p);
      return;
    }
    if (type === "clarify.request") {
      chatNotice("KROHN espera una aclaración: " + (p.question || p.text || "revisa la terminal"), "wait");
      return;
    }
    if (type === "todo.updated") {
      renderTodos(p);
      return;
    }
  }

  /* ---- rendering ---- */

  function chatNotice(text, tone) {
    if (!CHAT.panel) return;
    chatEmpty(false);
    var el = mk("div", "kc-notice");
    el.dataset.tone = tone || "info";
    el.textContent = text;
    CHAT.list.appendChild(el);
    chatScrollBottom();
  }

  function chatTyping(on) {
    if (!CHAT.panel) return;
    var el = $(".kc-typing", CHAT.panel);
    if (!on) { if (el) el.remove(); return; }
    if (el) return;
    el = mk("div", "kc-typing");
    el.innerHTML = "<i></i><i></i><i></i>";
    CHAT.list.appendChild(el);
    chatScrollBottom();
  }

  function currentTurn() {
    if (CHAT.turn) return CHAT.turn;
    var el = mk("div", "kc-msg kc-assistant");
    el.innerHTML =
      '<div class="kc-who">KROHN</div>' +
      '<details class="kc-think k-chat-hidden"><summary>Pensamiento</summary><pre></pre></details>' +
      '<div class="kc-body"></div>';
    CHAT.list.appendChild(el);
    CHAT.turn = { el: el, body: $(".kc-body", el), think: $(".kc-think", el), thinkPre: $(".kc-think pre", el), text: "" };
    return CHAT.turn;
  }

  function addThinking(text) {
    if (!text) return;
    var t = currentTurn();
    var pre = t.thinkPre;
    pre.textContent += text;
    t.think.classList.remove("k-chat-hidden");
    t.think.open = true;
    chatScrollBottom();
  }

  function addAssistantDelta(text) {
    if (!text) return;
    var t = currentTurn();
    t.text += text;
    t.body.textContent = t.text;
    chatScrollBottom();
  }

  function finalizeAssistant(p) {
    var t = CHAT.turn;
    if (!t) {
      if (!(p && typeof p.text === "string" && p.text.trim())) return;
      t = currentTurn();
    }
    if (p && typeof p.text === "string" && p.text.trim() && p.text.length >= t.text.length) t.text = p.text;
    if (p && p.reasoning && !t.thinkPre.textContent.trim()) {
      t.thinkPre.textContent = p.reasoning;
      t.think.classList.remove("k-chat-hidden");
    }
    if (t.text.trim()) {
      t.body.innerHTML = chatMarkdown(t.text);
    } else {
      t.body.remove();
      if (!t.thinkPre.textContent.trim()) t.el.remove();
    }
    if (t.thinkPre.textContent.trim()) t.think.open = false;
    CHAT.turn = null;
  }

  function renderHistoryMessage(m) {
    if (!m) return;
    if (m.display_kind === "hidden" || m.role === "system") return;
    if (m.role === "user") {
      if (m.text) addUserBubble(m.text);
      return;
    }
    if (m.role === "tool") {
      var tid = m.tool_call_id || ("h" + (m.row_id || Math.floor(Math.random() * 1e9)));
      addToolStart({ tool_id: tid, name: m.name || "herramienta", args: m.args || {} });
      completeTool({ tool_id: tid, name: m.name || "herramienta", args: m.args || {}, result: m.content, summary: "" });
      return;
    }
    if (m.role === "assistant") {
      var el = mk("div", "kc-msg kc-assistant");
      el.innerHTML =
        '<div class="kc-who">KROHN</div>' +
        (m.reasoning ? '<details class="kc-think"><summary>Pensamiento</summary><pre></pre></details>' : "") +
        '<div class="kc-body"></div>';
      if (m.reasoning) $(".kc-think pre", el).textContent = m.reasoning;
      $(".kc-body", el).innerHTML = chatMarkdown(m.text || "");
      CHAT.list.appendChild(el);
      return;
    }
  }

  function addUserBubble(text) {
    chatEmpty(false);
    var el = mk("div", "kc-msg kc-user");
    el.innerHTML = '<div class="kc-who">Tú</div><div class="kc-body"></div>';
    $(".kc-body", el).innerHTML = chatMarkdown(String(text));
    CHAT.list.appendChild(el);
    chatScrollBottom();
  }

  function toolSummary(p) {
    if (p.context) return String(p.context);
    var args = p.args || {};
    var name = p.name || "herramienta";
    if (args.command) return String(args.command);
    if (args.path) return String(args.path);
    if (args.query) return String(args.query);
    if (args.url) return String(args.url);
    if (args.code) return String(args.code).slice(0, 80);
    var keys = Object.keys(args);
    if (!keys.length) return "";
    try { return JSON.stringify(args).slice(0, 120); } catch (_) { return ""; }
  }

  function toolMetaSummary(s) {
    if (!s) return "";
    var m = /^Did (\d+) searches?(?: in .*)?$/i.exec(s);
    if (m) return m[1] + (m[1] === "1" ? " búsqueda" : " búsquedas");
    m = /^Extracted (\d+) pages?(?: in .*)?$/i.exec(s);
    if (m) return m[1] + (m[1] === "1" ? " página" : " páginas");
    return String(s);
  }

  function addToolStart(p) {
    if (!p || !p.tool_id) return;
    if (CHAT.toolEls[p.tool_id]) return;
    chatEmpty(false);
    var el = mk("div", "kc-tool");
    el.dataset.state = "running";
    el.innerHTML =
      '<div class="kc-tool-head"><span class="kc-tool-dot"></span><b></b><span class="kc-tool-meta"></span></div>' +
      '<div class="kc-tool-sub"></div>' +
      '<details class="kc-tool-more"><summary>Detalle</summary><pre></pre></details>';
    $("b", el).textContent = p.name || "herramienta";
    $(".kc-tool-sub", el).textContent = toolSummary(p);
    el.classList.toggle("k-chat-hidden", false);
    if (p.args && Object.keys(p.args).length) {
      $("pre", el).textContent = JSON.stringify(p.args, null, 2).slice(0, 3000);
    }
    var anchor = CHAT.turn && CHAT.turn.el && CHAT.turn.el.parentElement === CHAT.list ? CHAT.turn.body : null;
    if (anchor) CHAT.list.insertBefore(el, anchor);
    else CHAT.list.appendChild(el);
    CHAT.toolEls[p.tool_id] = el;
    chatScrollBottom();
  }

  function completeTool(p) {
    if (!p || !p.tool_id) return;
    var el = CHAT.toolEls[p.tool_id];
    if (!el) { addToolStart(p); el = CHAT.toolEls[p.tool_id]; }
    if (!el) return;
    var failed = p.is_error || p.error || (p.result && p.result.error);
    el.dataset.state = failed ? "error" : "done";
    var meta = $(".kc-tool-meta", el);
    if (meta) {
      var bits = [];
      if (p.duration_s) bits.push(Math.max(0.1, p.duration_s).toFixed(1) + "s");
      var summary = toolMetaSummary(p.summary);
      if (summary) bits.push(String(summary).slice(0, 90));
      meta.textContent = bits.join(" · ");
    }
    var pre = $("pre", el);
    if (pre) {
      var body = p.result_text || p.result;
      var text = typeof body === "string" ? body : JSON.stringify(body, null, 2);
      var more = $(".kc-tool-more", el);
      if (text && text.length) {
        pre.textContent = String(text).slice(0, 4000);
        if (more) more.classList.remove("k-chat-hidden");
      } else if (more) {
        more.classList.add("k-chat-hidden");
      }
    }
    chatScrollBottom();
  }

  function replayOpenRequests(list) {
    if (!Array.isArray(list) || !list.length) return;
    list.forEach(function (req) {
      if (!req || !req.id || CHAT.openCards[req.id]) return;
      handleServerRequest({ jsonrpc: "2.0", id: req.id, method: req.method, params: req.params || {} });
    });
  }

  /* JSON-RPC server→client requests (tui_gateway/server_requests.py). The
     reply is the response frame with the same srq id, not an RPC call. */
  function handleServerRequest(frame) {
    if (!frame || !frame.id) return;
    var method = frame.method;
    var p = frame.params || {};
    if (CHAT.openCards[frame.id]) return;
    /* No chat surface (another route) or a session this window is not showing:
       decline like the desktop does so the agent fails fast instead of waiting
       out clarify's 300 s deadline. */
    if (!CHAT.panel || (p.session_id && CHAT.sessionId && p.session_id !== CHAT.sessionId)) {
      gwRespond(frame.id, null, { code: 4404, message: "No KROHN window is showing this chat." });
      return;
    }
    if (method === "approval") {
      addApproval(p, frame.id);
      return;
    }
    if (method === "clarify") {
      addClarify(p, frame.id);
      return;
    }
    if (method === "sudo" || method === "secret" || /^vault\./.test(method)) {
      gwRespond(frame.id, { value: "" });
      chatNotice("KROHN pidió un dato privado (" + (p.prompt || method) + "). Responde ese aviso en la TUI.", "wait");
      return;
    }
    if (method === "setup_beat") {
      gwRespond(frame.id, { answer: null });
      return;
    }
    gwRespond(frame.id, null, { code: -32601, message: "unsupported request" });
  }

  function dropServerCard(id) {
    var el = id && CHAT.openCards[id];
    if (!el) return;
    try { el.remove(); } catch (_) {}
    delete CHAT.openCards[id];
  }

  function addApproval(p, reqId) {
    chatEmpty(false);
    var el = mk("div", "kc-notice kc-prompt");
    el.dataset.tone = "wait";
    el.innerHTML = '<b>KROHN necesita tu aprobación</b><span></span><div class="kc-actions"></div>';
    $("span", el).textContent = p.description || p.command || "Comando pendiente";
    var actions = $(".kc-actions", el);
    var choices = Array.isArray(p.choices) && p.choices.length ? p.choices : ["once", "always", "deny"];
    choices.forEach(function (c) {
      var b = mk("button", "kc-action");
      b.type = "button";
      b.textContent = c === "once" ? "Permitir una vez" : c === "always" ? "Permitir siempre" : c === "session" ? "Permitir sesión" : c === "deny" ? "Rechazar" : c;
      b.addEventListener("click", function () {
        b.disabled = true;
        var done = function () {
          el.dataset.tone = "info";
          actions.remove();
          if (reqId) delete CHAT.openCards[reqId];
        };
        var fail = function (e) { chatNotice("No se pudo responder: " + (e.message || e), "error"); };
        if (reqId) { gwRespond(reqId, { choice: c }); done(); return; }
        gwCall("approval.respond", { session_id: CHAT.sessionId, request_id: p.request_id, choice: c }, 12000).then(done).catch(fail);
      });
      actions.appendChild(b);
    });
    CHAT.list.appendChild(el);
    if (reqId) CHAT.openCards[reqId] = el;
    chatScrollBottom();
  }

  function addClarify(p, reqId) {
    chatEmpty(false);
    var qs = Array.isArray(p.questions) && p.questions.length ? p.questions : [{ qid: "q", question: p.question || "¿Puedes aclararlo?" }];
    var el = mk("div", "kc-notice kc-prompt kc-clarify");
    el.dataset.tone = "wait";
    el.innerHTML = "<b>KROHN necesita una aclaración</b>";
    var answers = {};
    var inputs = {};
    qs.forEach(function (q, i) {
      var block = mk("div", "kc-q");
      var label = mk("span", "kc-q-label");
      label.textContent = (i + 1) + ". " + q.question;
      block.appendChild(label);
      if (Array.isArray(q.choices) && q.choices.length) {
        var row = mk("div", "kc-actions");
        q.choices.forEach(function (c) {
          var b = mk("button", "kc-action");
          b.type = "button";
          b.textContent = c;
          b.addEventListener("click", function () {
            answers[q.qid] = c;
            Array.prototype.forEach.call(row.children, function (k) { k.classList.toggle("on", k === b); });
          });
          row.appendChild(b);
        });
        block.appendChild(row);
      } else {
        var inp = mk("input", "kc-q-input");
        inp.type = "text";
        inp.placeholder = q.multi_select ? "Escribe una respuesta por línea" : "Tu respuesta";
        inp.setAttribute("aria-label", q.question);
        inputs[q.qid] = inp;
        block.appendChild(inp);
      }
      el.appendChild(block);
    });
    var actions = mk("div", "kc-actions kc-q-send");
    var send = mk("button", "kc-action on");
    send.type = "button";
    send.textContent = "Responder";
    send.addEventListener("click", function () {
      Object.keys(inputs).forEach(function (k) { answers[k] = inputs[k].value; });
      var has = Object.keys(answers).some(function (k) { return String(answers[k] || "").trim(); });
      var result = has ? { answers: answers, outcome: "submitted" } : { answers: null, outcome: "cancelled" };
      if (reqId) gwRespond(reqId, result);
      else gwCall("clarify.respond", { session_id: CHAT.sessionId, request_id: p.request_id, answer: JSON.stringify(answers) }, 12000).catch(function () {});
      el.dataset.tone = "info";
      el.querySelectorAll("button,input").forEach(function (n) { n.disabled = true; });
      if (reqId) delete CHAT.openCards[reqId];
    });
    var skip = mk("button", "kc-action");
    skip.type = "button";
    skip.textContent = "Omitir";
    skip.addEventListener("click", function () {
      if (reqId) gwRespond(reqId, { answers: null, outcome: "cancelled" });
      el.dataset.tone = "info";
      el.querySelectorAll("button,input").forEach(function (n) { n.disabled = true; });
      if (reqId) delete CHAT.openCards[reqId];
    });
    actions.appendChild(send);
    actions.appendChild(skip);
    el.appendChild(actions);
    CHAT.list.appendChild(el);
    if (reqId) CHAT.openCards[reqId] = el;
    chatScrollBottom();
  }

  function renderTodos(p) {
    var todos = (p && p.todos) || (p && p.items) || null;
    if (!Array.isArray(todos) || !todos.length) return;
    var old = $(".kc-todos", CHAT.panel);
    if (old) old.remove();
    var el = mk("div", "kc-todos");
    el.innerHTML = "<b>Plan</b>";
    todos.forEach(function (t) {
      var row = mk("div", "kc-todo");
      row.dataset.done = t.status === "completed" || t.done ? "1" : "0";
      row.textContent = (t.status === "completed" ? "✓ " : "• ") + (t.text || t.title || "");
      el.appendChild(row);
    });
    CHAT.list.appendChild(el);
    chatScrollBottom();
  }

  function chatMarkdown(src) {
    var text = String(src || "");
    var blocks = text.split(/```/);
    var out = "";
    blocks.forEach(function (block, i) {
      if (i % 2 === 1) {
        var nl = block.indexOf("\n");
        var lang = nl >= 0 ? block.slice(0, nl).trim() : "";
        var code = nl >= 0 ? block.slice(nl + 1) : block;
        out += '<pre class="kc-code"><code>' + esc(code.replace(/\n$/, "")) + "</code></pre>";
        return;
      }
      var parts = block.split(/\n{2,}/);
      parts.forEach(function (par) {
        if (!par.trim()) return;
        out += "<p>" + inlineMarkdown(par) + "</p>";
      });
    });
    return out || "";
  }

  function inlineMarkdown(s) {
    var t = esc(s);
    t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
    t = t.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
    t = t.replace(/(^|\n)([*-] )/g, "$1• ");
    t = t.replace(/\n/g, "<br>");
    return t;
  }

  /* ---- send / stop ---- */

  function setChatStop(on) {
    if (!CHAT.panel) return;
    CHAT.send.classList.toggle("k-chat-hidden", !!on);
    $("[data-kc-stop]", CHAT.panel).classList.toggle("k-chat-hidden", !on);
  }

  function flushQueuedChat() {
    if (!CHAT.queuedSend || !CHAT.sessionId || !CHAT.seqReady || CHAT.streaming) return;
    var text = CHAT.queuedSend;
    CHAT.queuedSend = null;
    CHAT.input.value = text;
    autoGrowChat();
    void sendChat();
  }

  function sendChat() {
    var text = (CHAT.input.value || "").trim();
    if (!text) return;
    if (!CHAT.sessionId || !CHAT.seqReady) {
      CHAT.queuedSend = text;
      CHAT.input.value = "";
      autoGrowChat();
      chatStatus("Preparando…");
      chatNotice("Preparando la conversación. El mensaje se enviará solo.", "info");
      if (!CHAT.sessionId) void newChat();
      return;
    }
    CHAT.input.value = "";
    autoGrowChat();
    CHAT.stick = true;
    addUserBubble(text);
    chatEmpty(false);
    CHAT.streaming = true;
    setChatStop(true);
    chatTyping(true);
    chatStatus("Pensando…");
    petSet("think");
    gwCall("prompt.submit", { session_id: CHAT.sessionId, text: text }, 25000).catch(function (e) {
      if (!CHAT.pickerId || !/session not found/i.test(e && e.message || "")) throw e;
      return resumeChat(CHAT.pickerId).then(function () {
        addUserBubble(text);
        return gwCall("prompt.submit", { session_id: CHAT.sessionId, text: text }, 25000);
      });
    }).catch(function (e) {
      CHAT.streaming = false;
      setChatStop(false);
      chatTyping(false);
      chatNotice("No se pudo enviar: " + (e.message || e), "error");
    });
  }

  function stopChat() {
    if (!CHAT.sessionId) return;
    gwCall("session.interrupt", { session_id: CHAT.sessionId }, 12000).then(function () {
      CHAT.streaming = false;
      setChatStop(false);
      chatTyping(false);
      chatStatus("Detenido");
      petSet("idle");
    }).catch(function (e) {
      chatNotice("No se pudo detener: " + (e.message || e), "error");
    });
  }

  /* ------------------------------------------------------------------ */
  /* boot                                                               */
  /* ------------------------------------------------------------------ */

  /* Small automation surface (tests, plugins, future keybinds). */
  S.openLive = openLive;
  S.openNotes = openNotes;
  S.openPalette = openPalette;
  S.pet = petSet;
  S.liveState = function () {
    return {
      running: LIVE.running, starting: LIVE.starting, provider: LIVE.provider,
      models: LIVE.models.length, stage: LIVE.stage, geminiReady: LIVE.geminiReady
    };
  };
  S.petState = function () { return { state: pet.state, label: pet.label }; };
  S.chat = {
    open: openChat,
    send: sendChat,
    state: function () {
      return {
        mounted: !!CHAT.panel,
        sessionId: CHAT.sessionId,
        sessions: CHAT.sessions.length,
        streaming: CHAT.streaming,
        seq: CHAT.seq,
        pickerId: CHAT.pickerId,
        seqReady: CHAT.seqReady,
        messages: CHAT.list ? CHAT.list.querySelectorAll(".kc-msg,.kc-tool").length : 0
      };
    }
  };

  onReady(function () {
    buildLive();
    buildNotes();
    buildPalette();
    buildPet();
    bootSidebar();
    watchThemeMenus();
    startPetPolling();
    mountChat();
    setInterval(mountChat, 2000);
    setInterval(relabelTheme, 2500);
    /* Warm the slow lists (skills scans the disk, slash comes over RPC) so the
       palette opens instantly when the user types @ or /. */
    setTimeout(function () { if (!PAL.skills) loadSkills(); }, 7000);
    setTimeout(function () { if (!PAL.commands) loadCommands(); }, 10000);
  });
})();
