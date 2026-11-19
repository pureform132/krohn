/* KROHN × MEGANOTE — puente de sincronización local.
 *
 * Qué hace: mantiene el Store de Meganote (un solo registro IndexedDB:
 * `takenotes` / `workspace` / clave `v1`) sincronizado con `meganote.json`
 * en el KROHN home, vía las rutas loopback del dashboard:
 *
 *   GET  /api/meganote?meta=1   → { ok, exists, mtime }        (poll barato)
 *   GET  /api/meganote          → { ok, exists, mtime, data }  (snapshot completo)
 *   PUT  /api/meganote          → { ok, mtime }                (reemplazo atómico)
 *
 * Reglas de negocio (sin sorpresas, sin pérdida de datos):
 *   - Al ARRANCAR: si IndexedDB está vacío pero existe snapshot remoto, se hidrata
 *     y recarga UNA vez. Si IndexedDB tiene datos, gana lo local y se publica el
 *     snapshot (el archivo queda igual que lo que ves).
 *   - EN USO: cada ~4s, si el Store cambió, se publica. El mtime devuelto por el PUT
 *     se recuerda para no confundir tu propio push con una edición del agente.
 *   - Si el agente (o una edición externa) actualiza el archivo y tú llevas ≥ 20s
 *     sin teclear, se aplica el snapshot remoto y se recarga. Así las notas escritas
 *     por KROHN aparecen solas; si estás tecleando, nunca se pisa nada.
 *
 * La UI de Meganote funciona sin este puente (offline total): si el puente falla,
 * solo se pierde la sincronización con el archivo, no las notas.
 */
(function () {
  'use strict';

  var DB_NAME = 'takenotes';
  var STORE = 'workspace';
  var KEY = 'v1';
  var API = '/api/meganote';
  var PUSH_MS = 4000;
  var WATCH_MS = 12000;
  var IDLE_GRACE_MS = 20000;
  var MAX_PAYLOAD = 40 * 1024 * 1024; // 40 MB — el guard contra basura, no un límite real de notas
  var TAG = '[meganote-sync]';

  var token = null;
  var pushing = false;
  var lastPushedJson = '';
  var lastLocalEdit = 0;
  var knownMtime = null;

  function log() { try { console.debug.apply(console, [TAG].concat([].slice.call(arguments))); } catch (_) {} }

  function stableStringify(v) { return JSON.stringify(v); }

  function openDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB open failed')); };
    });
  }

  function idbGet() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readonly');
        var req = tx.objectStore(STORE).get(KEY);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
        tx.oncomplete = function () { db.close(); };
      });
    });
  }

  function idbPut(doc) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(doc, KEY);
        tx.oncomplete = function () { db.close(); resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function apiFetch(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'X-KROHN-Session-Token': token }, opts.headers || {});
    return fetch(API + path, opts).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function remoteMeta() { return apiFetch('?meta=1'); }
  function remoteGet() { return apiFetch(''); }
  function remotePut(doc) {
    var body = stableStringify(doc);
    if (body.length > MAX_PAYLOAD) return Promise.reject(new Error('snapshot too large'));
    return apiFetch('', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: body });
  }

  function markLocalEditIfChanged() {
    idbGet().then(function (local) {
      if (!local) return;
      if (stableStringify(local) !== lastPushedJson) lastLocalEdit = Date.now();
    }).catch(function (e) { log('idb watch:', e && e.message); });
  }

  function pushIfChanged() {
    if (pushing || !token) return;
    idbGet().then(function (local) {
      if (!local) return null;
      var s = stableStringify(local);
      if (s === lastPushedJson) return null;
      pushing = true;
      return remotePut(local).then(function (r) {
        lastPushedJson = s;
        knownMtime = (r && r.mtime != null) ? r.mtime : knownMtime;
        lastLocalEdit = Date.now();
      }).catch(function (e) { log('push falló:', e && e.message); })
        .then(function () { pushing = false; });
    }).catch(function (e) { log('idb read (push):', e && e.message); pushing = false; });
  }

  function applyRemote() {
    return remoteGet().then(function (r) {
      if (!r || !r.exists || !r.data) return null;
      var applied = String(r.mtime);
      try { if (sessionStorage.getItem('kpn-applied') === applied) return null; } catch (_) {}
      return idbPut(r.data).then(function () {
        knownMtime = r.mtime;
        try { sessionStorage.setItem('kpn-applied', applied); } catch (_) {}
        location.reload();
      });
    }).catch(function (e) { log('apply remoto falló:', e && e.message); });
  }

  function watchRemote() {
    if (!token) return;
    if (Date.now() - lastLocalEdit < IDLE_GRACE_MS) return;
    remoteMeta().then(function (m) {
      if (m && m.exists && knownMtime != null && m.mtime !== knownMtime) {
        log('cambio remoto detectado (mtime), aplicando…');
        applyRemote();
      } else if (m && m.mtime != null) {
        knownMtime = m.mtime;
      }
    }).catch(function (e) { log('meta:', e && e.message); });
  }

  function startSteady() {
    idbGet().then(function (local) {
      if (local) lastPushedJson = stableStringify(local);
    }).catch(function () {});
    setInterval(markLocalEditIfChanged, 1500);
    setInterval(pushIfChanged, PUSH_MS);
    setInterval(watchRemote, WATCH_MS);
    window.addEventListener('beforeunload', function () {
      idbGet().then(function (local) {
        if (!local || !token) return;
        try {
          fetch(API, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-KROHN-Session-Token': token },
            body: stableStringify(local),
            keepalive: true,
          });
        } catch (_) { /* best effort */ }
      }).catch(function () {});
    });
  }

  function boot() {
    if (!token) return;
    Promise.all([
      remoteMeta().catch(function () { return null; }),
      idbGet().catch(function () { return null; }),
    ]).then(function (parts) {
      var meta = parts[0], local = parts[1];
      if (meta && meta.exists && meta.mtime != null) knownMtime = meta.mtime;
      if (!local && meta && meta.exists) {
        // IndexedDB vacío + snapshot remoto → hidratar y recargar una vez
        return remoteGet().then(function (r) {
          if (r && r.exists && r.data) {
            return idbPut(r.data).then(function () {
              try { sessionStorage.setItem('kpn-applied', String(r.mtime)); } catch (_) {}
              location.reload();
            });
          }
          startSteady();
        });
      }
      startSteady();
    }).catch(function (e) {
      log('boot:', e && e.message);
      startSteady();
    });
  }

  /* Token handshake con la UI padre (KROHN). El padre publica {kromMeganote:{token}};
   * si el iframe cargó primero, anunciamos hello y el padre responde. */
  window.addEventListener('message', function (ev) {
    if (ev.origin !== location.origin) return;
    var d = ev.data;
    if (d && d.kromMeganote && d.kromMeganote.token && !token) {
      token = d.kromMeganote.token;
      log('token recibido, inicializando sync');
      boot();
    }
  });

  var helloTries = 0;
  function sayHello() {
    try { parent.postMessage({ kromMeganoteHello: true }, location.origin); } catch (_) {}
    if (++helloTries < 40 && !token) setTimeout(sayHello, 500);
  }
  if (parent !== window) {
    sayHello();
  } else {
    log('standalone sin UI padre — Meganote funciona local-only (sin sync con meganote.json)');
  }
})();
