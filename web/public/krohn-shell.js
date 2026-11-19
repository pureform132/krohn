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
          }
        });
        ws.addEventListener("close", function () {
          gw = null;
          gwPending.forEach(function (p) { clearTimeout(p.timer); p.reject(new Error("gateway closed")); });
          gwPending.clear();
          if (!settled) { settled = true; reject(new Error("gateway closed")); }
          clearTimeout(gwRetry);
          gwRetry = setTimeout(function () { gwConnect().catch(function () {}); }, 3500);
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

  function buildLive() {
    var root = mk("div", "k-overlay");
    root.id = "k-live";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "KROHN Live — voz en tiempo real");
    root.setAttribute("aria-hidden", "true");
    root.innerHTML =
      '<div class="k-panel">' +
        '<div class="k-head k-live-head">' +
          '<span class="k-title">KROHN Live</span>' +
          '<div class="k-live-providers" role="tablist" aria-label="Proveedor Live">' +
            '<button type="button" class="k-live-prov on" data-prov="gemini" role="tab" aria-selected="true">Gemini Live</button>' +
            '<button type="button" class="k-live-prov" data-prov="openai" role="tab" aria-selected="false" disabled>GPT Live</button>' +
          "</div>" +
          '<button type="button" class="k-x" data-close aria-label="Cerrar KROHN Live" title="Cerrar">×</button>' +
        "</div>" +
        '<div class="k-live-stage">' +
          '<div class="k-live-orb">' +
            '<svg viewBox="0 0 36 36" width="50" height="50" fill="none" aria-hidden="true">' +
              '<path d="M5 12.5 L14 6.5 H22 L31 12.5 L27.2 21.5 L22.5 27 H13.5 L8.8 21.5 Z" stroke="#E0503E" stroke-width="2" stroke-linejoin="round"/>' +
              '<path d="M12 15.2 H16.4 M19.6 15.2 H24" stroke="#E0503E" stroke-width="1.8" stroke-linecap="round"/>' +
            "</svg>" +
          "</div>" +
          '<div class="k-live-state" data-state>Elige un modelo y pulsa Empezar</div>' +
          '<canvas class="k-live-wave" width="640" height="62" aria-hidden="true"></canvas>' +
          '<div class="k-live-captions"><div class="k-cap" data-cap="user"></div><div class="k-cap" data-cap="krohn"></div></div>' +
        "</div>" +
        '<div class="k-live-foot">' +
          '<select data-model aria-label="Modelo Live"></select>' +
          '<button type="button" class="k-btn k-primary" data-start>Empezar</button>' +
        "</div>" +
        '<div class="k-live-note" data-note>Voz full-duplex con tu clave de Google AI Studio. La clave no sale de este equipo salvo hacia Google.</div>' +
        '<div class="k-credit">KROHN Live · Creado por <b>Cesar D. Ciprian</b></div>' +
      "</div>";
    document.body.appendChild(root);

    liveEls = {
      root: root,
      state: $("[data-state]", root),
      captions: { user: $('[data-cap="user"]', root), krohn: $('[data-cap="krohn"]', root) },
      model: $("[data-model]", root),
      start: $("[data-start]", root),
      note: $("[data-note]", root),
      wave: $(".k-live-wave", root),
      ctx: null
    };
    try { liveEls.ctx = liveEls.wave.getContext("2d"); } catch (_) { liveEls.ctx = null; }

    $('[data-close]', root).addEventListener("click", function () { closeOverlay(root); });
    root.addEventListener("click", function (e) { if (e.target === root) closeOverlay(root); });
    $('[data-prov="gemini"]', root).addEventListener("click", function () { setLiveProvider("gemini"); });
    $('[data-prov="openai"]', root).addEventListener("click", function () { setLiveProvider("openai"); });
    liveEls.start.addEventListener("click", function () {
      if (LIVE.running || LIVE.starting) liveStop(true);
      else liveStart();
    });
  }

  function setLiveProvider(p) {
    LIVE.provider = p;
    $$(".k-live-prov", liveEls.root).forEach(function (b) {
      var on = b.dataset.prov === p;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (p === "openai") {
      liveSetState("GPT Live requiere OPENAI_API_KEY", false);
      liveEls.note.textContent = "OPENAI_API_KEY no está configurada. Gemini Live está listo.";
    } else {
      liveSetState(LIVE.running ? "Escuchando…" : "Elige un modelo y pulsa Empezar", LIVE.running);
      liveEls.note.textContent = "Voz full-duplex con tu clave de Google AI Studio. La clave no sale de este equipo salvo hacia Google.";
    }
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
      var oai = (data.providers && data.providers.openai) || {};
      LIVE.geminiReady = !!gem.available;
      LIVE.models = (gem.models || []).filter(function (m) { return !m.music && !m.transcribe; });
      if (!LIVE.models.length) {
        LIVE.models = [
          { id: "models/gemini-3.1-flash-live-preview", displayName: "Gemini 3.1 Flash Live" },
          { id: "models/gemini-3.8-live", displayName: "Gemini 3.8 Live" }
        ];
      }
      liveEls.model.innerHTML = LIVE.models.map(function (m) {
        return '<option value="' + esc(m.id) + '">' + esc(m.displayName || m.id) + "</option>";
      }).join("");
      var rec = LIVE.models.filter(function (m) { return m.id === gem.recommended; })[0];
      if (rec) liveEls.model.value = rec.id;
      var gpt = $('[data-prov="openai"]', liveEls.root);
      if (gpt) {
        gpt.disabled = !oai.available;
        gpt.title = oai.available ? "GPT Live" : (oai.reason || "OPENAI_API_KEY no configurada");
      }
      if (!LIVE.geminiReady) {
        liveEls.note.textContent = "GEMINI_API_KEY no detectada. Revisa `krohn doctor`.";
      } else {
        liveEls.note.textContent = "Voz full-duplex con tu clave de Google AI Studio. La clave no sale de este equipo salvo hacia Google.";
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
    openOverlay("k-live", '[data-start]');
    liveCaption("user", "");
    liveCaption("krohn", "");
    if (!LIVE.running) {
      if (LIVE.geminiReady) liveSetState("Elige un modelo y pulsa Empezar", false);
      else liveSetState("Cargando modelos…", false);
    }
    liveLoad();
    if (LIVE.running) liveSetState("Escuchando…", true);
  }

  function liveStage(s) {
    LIVE.stage = s;
    try { console.info("[krohn-live] " + s); } catch (_) {}
  }

  function liveStart() {
    if (LIVE.starting || LIVE.running) return;
    if (LIVE.provider === "openai") {
      liveSetState("GPT Live requiere OPENAI_API_KEY", false);
      return;
    }
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
    liveStage("start");
    liveEls.start.textContent = "Conectando…";
    liveSetState("Conectando con Gemini Live…", false);
    petSet("think", "Conectando Live…");
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
          var wsUrl = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=" + encodeURIComponent(key);
          liveStage("socket");
          var ws = new WebSocket(wsUrl);
          LIVE.ws = ws;
          ws.addEventListener("open", function () {
            liveStage("open");
            ws.send(JSON.stringify({
              setup: {
                model: model,
                generationConfig: { responseModalities: ["AUDIO"] },
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
              liveStop(true);
              liveSetState("Conexión cerrada" + (ev && ev.code ? " (" + ev.code + ")" : ""), false);
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
      liveEls.start.textContent = "Terminar";
      liveSetState("Escuchando…", true);
      petSet("idle", "Live listo");
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
          liveSetState("KROHN está hablando…", true);
          petSet("speaking", "Hablando…");
        }
      });
    }
    if (sc.outputTranscription && sc.outputTranscription.text) liveCaption("krohn", sc.outputTranscription.text);
    if (sc.inputTranscription && sc.inputTranscription.text) liveCaption("user", sc.inputTranscription.text);
    if (sc.generationComplete || sc.turnComplete) {
      liveSetState("Escuchando…", true);
      petSet("idle", "Escuchando…");
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
    if (!liveEls.ctx) return;
    var bars = 46;
    LIVE.waveTimer = setInterval(function () {
      var w = liveEls.wave.width, h = liveEls.wave.height, ctx = liveEls.ctx;
      ctx.clearRect(0, 0, w, h);
      if (!LIVE.analyser) return;
      var data = new Uint8Array(LIVE.analyser.frequencyBinCount);
      LIVE.analyser.getByteFrequencyData(data);
      var bw = w / bars;
      for (var i = 0; i < bars; i++) {
        var v = data[Math.floor(i * data.length / bars)] / 255;
        var bh = Math.max(2, v * (h - 8));
        ctx.fillStyle = i % 9 === 0 ? "#30D158" : "#E0503E";
        ctx.fillRect(i * bw + 2, (h - bh) / 2, bw - 4, bh);
      }
    }, 55);
  }

  function liveStop(keepState) {
    clearTimeout(LIVE.watchdog);
    clearInterval(LIVE.waveTimer);
    try { if (LIVE.ws) LIVE.ws.close(); } catch (_) {}
    LIVE.ws = null;
    LIVE.running = false;
    LIVE.starting = false;
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
    if (liveEls.start) liveEls.start.textContent = "Empezar";
    if (liveEls.ctx && liveEls.wave) liveEls.ctx.clearRect(0, 0, liveEls.wave.width, liveEls.wave.height);
    if (!keepState) liveSetState("Elige un modelo y pulsa Empezar", false);
    petSet("idle", "");
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
      S.sendToPty("@");
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
    S.sendToPty(r.text);
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
    idle: "", think: "Pensando…", work: "Trabajando…", coding: "Escribiendo código…",
    loading: "Cargando…", speaking: "Hablando…", waiting: "Te espera…",
    failed: "Algo falló", wave: "Listo", review: "Revisando…"
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
    el.innerHTML = '<span class="k-sprite" aria-hidden="true"></span><span class="k-pet-bubble" aria-hidden="true"></span>';
    document.body.appendChild(el);
    pet.el = el;
    pet.sprite = $(".k-sprite", el);
    pet.bubble = $(".k-pet-bubble", el);

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
    if (pet.state === key && pet.label === (label || PET_LABEL[key])) return;
    pet.state = key;
    pet.label = label == null ? (PET_LABEL[key] || "") : label;
    var row = PET_ROWS[key];
    var h = pet.el.clientHeight || 101.33;
    pet.sprite.style.backgroundPositionY = (-row * h) + "px";
    pet.el.classList.toggle("k-busy", key === "think" || key === "work" || key === "coding" || key === "loading");
    pet.el.classList.toggle("k-waiting", key === "waiting");
    pet.el.classList.toggle("k-speaking", key === "speaking");
    pet.el.classList.toggle("k-failed", key === "failed");
    if (pet.label) {
      pet.bubble.textContent = pet.label;
      pet.el.classList.add("k-show-bubble");
      clearTimeout(pet.bubbleTimer);
      pet.bubbleTimer = setTimeout(function () { pet.el.classList.remove("k-show-bubble"); }, 3400);
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
    if (type === "message.start") { petSet("think", "Pensando…"); petIdleSoon(30000); }
    else if (type === "thinking.delta" || type === "reasoning.delta") { petSet("think", "Pensando…"); petIdleSoon(30000); }
    else if (type === "tool.generating") { petSet("work", "Preparando herramienta…"); petIdleSoon(30000); }
    else if (type === "tool.start") {
      var name = String(p.name || "").toLowerCase();
      if (/(terminal|shell|exec|bash|powershell|write|edit|patch|code|apply)/.test(name)) {
        petSet("coding", "Escribiendo código…");
      } else if (name === "clarify" || name === "approval") {
        petSet("waiting", "Te espera…");
      } else {
        petSet("work", name ? "Usando " + name + "…" : "Trabajando…");
      }
      petIdleSoon(30000);
    }
    else if (type === "tool.complete") { petIdleSoon(2500); }
    else if (type === "message.delta") { petSet("speaking", "Respondiendo…"); petIdleSoon(30000); }
    else if (type === "message.complete") {
      if (p.status === "error") { petSet("failed", "Algo falló", 6000); }
      else { petSet("wave", "Listo", 4200); }
    }
    else if (type === "error") { petSet("failed", "Algo falló", 6000); }
    else if (type === "clarify.request" || type === "approval.request") { petSet("waiting", "Te espera…", 20000); }
    else if (type === "status.update" && /compress|compact/.test(String(p.kind || ""))) { petSet("loading", "Cargando…", 12000); }
    else if (type === "gateway.reconnecting") { petSet("loading", "Reconectando…", 6000); }
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

  onReady(function () {
    buildLive();
    buildNotes();
    buildPalette();
    buildPet();
    bootSidebar();
    watchThemeMenus();
    startPetPolling();
    setInterval(relabelTheme, 2500);
    /* Warm the slow lists (skills scans the disk, slash comes over RPC) so the
       palette opens instantly when the user types @ or /. */
    setTimeout(function () { if (!PAL.skills) loadSkills(); }, 7000);
    setTimeout(function () { if (!PAL.commands) loadCommands(); }, 10000);
  });
})();
