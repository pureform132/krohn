import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron'

import type { DesktopProfileRoute } from './desktop-profile'
import type { HudModifierApi, HudModifierStatus } from './hud-modifier-types'
import { customWindowControlsEnabled } from './window-controls'

// Which translucency the OS can back. Asked synchronously because the renderer
// needs it before its first paint, and answered by main because deciding it
// needs `os.release()` — a sandboxed preload may only require electron, events,
// timers and url, so importing node:os here throws before contextBridge runs
// and takes the ENTIRE bridge down with it (window.krohnDesktop undefined =>
// "Desktop IPC bridge is unavailable"). No reply means no glass, which degrades
// to an ordinary opaque window rather than a page thinned over nothing.
const translucencySupport = ipcRenderer.sendSync('krohn:translucency:support')
const hudWindowing = ipcRenderer.sendSync('krohn:hud:windowing')
const hudNativeDrag = hudWindowing?.nativeDrag === true

const launchFlags: { localModels?: boolean; assumeFreshInstall?: boolean } | undefined =
  ipcRenderer.sendSync('krohn:feature-flags')

// Local, sanitized skin payload for the first renderer theme paint. This does
// not wait on `gateway.ready`, so an unreachable remote primary cannot force
// the built-in palette over the skin configured on this machine.
const localSkin = ipcRenderer.sendSync('krohn:skin:local')

// This machine's UI preferences store (#145213), read before the first paint so
// a preference set in another window or in this machine's Webapp paints at once.
const uiPreferencesSnapshot = ipcRenderer.sendSync('krohn:ui-preferences:snapshot')

import { unwrapExpectedNotFound } from './api-expected-404'

contextBridge.exposeInMainWorld('krohnDesktop', {
  glassSupported: translucencySupport?.glass === true,
  translucencySupported: translucencySupport?.translucency === true,
  // Launch-flag fact: the app was started with --local, so the renderer may
  // show the local-models surfaces. Static for the window's lifetime.
  localModelsEnabled: launchFlags?.localModels === true,
  // Dev-only launch fact: an unpackaged app started with --fresh-install, so
  // onboarding treats this launch as a fresh install. Always false when packaged.
  assumeFreshInstall: launchFlags?.assumeFreshInstall === true,
  localSkin: localSkin && typeof localSkin === 'object' ? localSkin : null,
  uiPreferences: {
    snapshot: uiPreferencesSnapshot && typeof uiPreferencesSnapshot === 'object' ? uiPreferencesSnapshot : null,
    read: () => ipcRenderer.invoke('krohn:ui-preferences:read'),
    write: payload => ipcRenderer.invoke('krohn:ui-preferences:write', payload),
    onChanged: callback => {
      const listener = (_event, snapshot) => callback(snapshot)
      ipcRenderer.on('krohn:ui-preferences:changed', listener)

      return () => ipcRenderer.removeListener('krohn:ui-preferences:changed', listener)
    }
  },
  getConnection: (profile, opts) => ipcRenderer.invoke('krohn:connection', profile, opts),
  // Loopback origin that hosts YouTube's player for the file:// renderer.
  getEmbedHostOrigin: () => ipcRenderer.invoke('krohn:embed-host:origin'),
  // Registry-scoped backend resolution: { connectionId, profile } → descriptor.
  getConnectionFor: payload => ipcRenderer.invoke('krohn:connection:for', payload),
  getProfileRoutes: profiles => ipcRenderer.invoke('krohn:plugin-profile-routes', profiles),
  revalidateConnection: () => ipcRenderer.invoke('krohn:connection:revalidate'),
  getGatewayWsUrl: profile => ipcRenderer.invoke('krohn:gateway:ws-url', profile),
  // Registry-scoped fresh WS URL: { connectionId, profile } → result shape of
  // getGatewayWsUrl, minted against that connection's backend.
  getGatewayWsUrlFor: payload => ipcRenderer.invoke('krohn:gateway:ws-url-for', payload),
  // { connectionId, profile, pluginId, path } → one-use local plugin socket URL, null, or { refused: 'permission' }.
  getPluginWsUrl: payload => ipcRenderer.invoke('krohn:plugin:ws-url', payload),
  // Union agent roster across every registered connection.
  getAgentRoster: () => ipcRenderer.invoke('krohn:agents:roster'),
  openSessionWindow: (sessionId, opts) => ipcRenderer.invoke('krohn:window:openSession', sessionId, opts),
  openSessionInTerminal: (sessionId, opts) => ipcRenderer.invoke('krohn:window:openInTerminal', sessionId, opts),
  openWindow: (options?: DesktopProfileRoute) => ipcRenderer.invoke('krohn:window:openInstance', options),
  openBrowserWindow: tabId => ipcRenderer.invoke('krohn:window:openBrowser', tabId),
  windowRelay: {
    send: payload => ipcRenderer.send('krohn:window:relay', payload),
    onMessage: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('krohn:window:relay', listener)

      return () => ipcRenderer.removeListener('krohn:window:relay', listener)
    }
  },
  onBrowserPopoutClosed: callback => {
    const listener = (_event, tabId) => callback(tabId)
    ipcRenderer.on('krohn:browser-popout:closed', listener)

    return () => ipcRenderer.removeListener('krohn:browser-popout:closed', listener)
  },
  claimAmbientCue: key => ipcRenderer.invoke('krohn:ambient:claim', key),
  windowControls: {
    custom: customWindowControlsEnabled(),
    minimize: () => ipcRenderer.send('krohn:window-control', 'minimize'),
    toggleMaximize: () => ipcRenderer.send('krohn:window-control', 'toggle-maximize'),
    close: () => ipcRenderer.send('krohn:window-control', 'close')
  },
  wakeIndicator: {
    getState: () => ipcRenderer.invoke('krohn:wake-indicator:get'),
    setState: state => ipcRenderer.send('krohn:wake-indicator:set', state),
    onState: callback => {
      const listener = (_event, state) => callback(state)
      ipcRenderer.on('krohn:wake-indicator:state', listener)

      return () => ipcRenderer.removeListener('krohn:wake-indicator:state', listener)
    }
  },
  chatOnboarding: {
    size: mode => ipcRenderer.send('krohn:window:size', mode)
  },
  petOverlay: {
    // Main renderer → main process: window lifecycle + drag. `request` is
    // `{ bounds, screen }`; resolves with the screen bounds it actually used.
    open: request => ipcRenderer.invoke('krohn:pet-overlay:open', request),
    close: () => ipcRenderer.invoke('krohn:pet-overlay:close'),
    setBounds: bounds => ipcRenderer.send('krohn:pet-overlay:set-bounds', bounds),
    setIgnoreMouse: ignore => ipcRenderer.send('krohn:pet-overlay:ignore-mouse', ignore),
    // Flip the overlay focusable (and focus it) while the composer needs keys.
    setFocusable: focusable => ipcRenderer.send('krohn:pet-overlay:set-focusable', focusable),
    // Main renderer → overlay (forwarded by main): push the latest pet state.
    pushState: payload => ipcRenderer.send('krohn:pet-overlay:state', payload),
    // Overlay → main renderer (forwarded by main): pop back in / composer submit.
    control: payload => ipcRenderer.send('krohn:pet-overlay:control', payload),
    // Overlay subscribes to state pushes.
    onState: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('krohn:pet-overlay:state', listener)

      return () => ipcRenderer.removeListener('krohn:pet-overlay:state', listener)
    },
    // Main renderer subscribes to overlay control messages.
    onControl: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('krohn:pet-overlay:control', listener)

      return () => ipcRenderer.removeListener('krohn:pet-overlay:control', listener)
    }
  },
  // HUD mode: the chrome-free floating chat. A full app renderer (own gateway)
  // sized as a floating bar, so it mounts the real composer. Main owns the
  // window; `onChanged` keeps every window's toggle truthful.
  hud: {
    nativeDrag: hudNativeDrag,
    windowing: {
      clientPlacement: hudWindowing?.clientPlacement !== false,
      controlDrag: hudWindowing?.controlDrag === true,
      nativeDrag: hudNativeDrag,
      solid: hudWindowing?.solid === true,
      workspaceTransfer: hudWindowing?.workspaceTransfer === true
    },
    open: request => ipcRenderer.invoke('krohn:hud:open', request),
    close: () => ipcRenderer.invoke('krohn:hud:close'),
    setIgnoreMouse: ignore => ipcRenderer.send('krohn:hud:ignore-mouse', ignore),
    beginMove: () => ipcRenderer.send('krohn:hud:begin-move'),
    endMove: () => ipcRenderer.send('krohn:hud:end-move'),
    moveBy: delta => ipcRenderer.send('krohn:hud:move-by', delta),
    setWorkspaceTransfer: transferring => ipcRenderer.send('krohn:hud:workspace-transfer', transferring),
    setBounds: bounds => ipcRenderer.send('krohn:hud:set-bounds', bounds),
    resetLayout: () => ipcRenderer.invoke('krohn:hud:reset-layout'),
    // Whether the band covers the window below the bar. Main pairs it with the
    // user's translucency setting to decide the native frost (macOS vibrancy /
    // Windows 11 DWM backdrop) — see hudFrostFor.
    setFrost: showing => ipcRenderer.invoke('krohn:hud:frost', showing),
    // The HUD tells main which session it is on; main hands that back to the
    // app window when the HUD closes, so the app can re-home onto it.
    setSession: sessionId => ipcRenderer.send('krohn:hud:session', sessionId),
    onGoto: callback => {
      const listener = (_event, sessionId) => callback(sessionId)
      ipcRenderer.on('krohn:hud:goto', listener)

      return () => ipcRenderer.removeListener('krohn:hud:goto', listener)
    },
    onChanged: callback => {
      const listener = (_event, state) => callback(state)
      ipcRenderer.on('krohn:hud:changed', listener)

      return () => ipcRenderer.removeListener('krohn:hud:changed', listener)
    },
    // Linux only, and silent elsewhere: where the cursor is, in page
    // coordinates, or null when it has left the window. Stands in for the
    // mousemove that `setIgnoreMouseEvents(true, { forward: true })` delivers on
    // macOS and Windows but not here.
    onCursor: callback => {
      const listener = (_event, point) => callback(point)
      ipcRenderer.on('krohn:hud:cursor', listener)

      return () => ipcRenderer.removeListener('krohn:hud:cursor', listener)
    },
    // Main's game-overlay watch: whether a fullscreen app (a game) is under
    // the HUD, so the renderer can step back to the low-opacity overlay
    // treatment while one owns the screen.
    onGameOverlay: callback => {
      const listener = (_event, state) => callback(state)
      ipcRenderer.on('krohn:hud:game-overlay', listener)

      return () => ipcRenderer.removeListener('krohn:hud:game-overlay', listener)
    }
  },
  hudModifier: {
    getSettings: () => ipcRenderer.invoke('krohn:hud-modifier:settings:get'),
    setEnabled: enabled => ipcRenderer.invoke('krohn:hud-modifier:settings:set', enabled),
    openPermissionSettings: () => ipcRenderer.invoke('krohn:hud-modifier:permission'),
    onStatus: callback => {
      const listener = (_event: Electron.IpcRendererEvent, status: HudModifierStatus) => callback(status)
      ipcRenderer.on('krohn:hud-modifier:status', listener)

      return () => ipcRenderer.removeListener('krohn:hud-modifier:status', listener)
    }
  } satisfies HudModifierApi,
  // macOS native screenshot gesture; captures require a main-issued request.
  screenshot:
    process.platform === 'darwin'
      ? {
          getSettings: () => ipcRenderer.invoke('krohn:screenshot:settings:get'),
          setEnabled: enabled => ipcRenderer.invoke('krohn:screenshot:settings:set', enabled),
          openPermissionSettings: kind => ipcRenderer.invoke('krohn:screenshot:permission', kind),
          capture: requestId => ipcRenderer.invoke('krohn:screenshot:capture', requestId),
          onStatus: callback => {
            const listener = (_event, status) => callback(status)
            ipcRenderer.on('krohn:screenshot:status', listener)

            return () => ipcRenderer.removeListener('krohn:screenshot:status', listener)
          },
          onRequest: callback => {
            const channel = 'krohn:screenshot:request'
            const listener = (_event, requestId) => callback(requestId)

            if (ipcRenderer.listenerCount(channel) === 0) {
              ipcRenderer.send('krohn:screenshot:subscribe', true)
            }

            ipcRenderer.on(channel, listener)

            return () => {
              ipcRenderer.removeListener(channel, listener)

              if (ipcRenderer.listenerCount(channel) === 0) {
                ipcRenderer.send('krohn:screenshot:subscribe', false)
              }
            }
          }
        }
      : undefined,
  // Quick Entry: the global-hotkey mini composer window. Main owns the OS
  // shortcut + the persisted preference; the quick window only captures text
  // and hands it back, and the primary renderer submits it through the normal
  // prompt path.
  quickEntry: {
    getSettings: () => ipcRenderer.invoke('krohn:quick-entry:settings:get'),
    setSettings: patch => ipcRenderer.invoke('krohn:quick-entry:settings:set', patch),
    // Invoke returns the delivery result so the draft is not lost (#85590).
    submit: payload => ipcRenderer.invoke('krohn:quick-entry:submit', payload),
    // Main cannot invoke the primary renderer, so it receives this ack (#85590).
    ackSubmit: (correlationId, result) => ipcRenderer.send('krohn:quick-entry:ack', { correlationId, result }),
    dismiss: () => ipcRenderer.send('krohn:quick-entry:dismiss'),
    // Primary renderer → main → quick window: gateway connection state + the
    // recent-session options the target picker offers. Main caches the latest
    // payload so a freshly spawned quick window starts from truth.
    pushState: payload => ipcRenderer.send('krohn:quick-entry:state', payload),
    // Quick window subscribes to those pushes.
    onState: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('krohn:quick-entry:state', listener)

      return () => ipcRenderer.removeListener('krohn:quick-entry:state', listener)
    },
    // Main → primary renderer: a submit captured by the quick window.
    onSubmit: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('krohn:quick-entry:submit', listener)

      return () => ipcRenderer.removeListener('krohn:quick-entry:submit', listener)
    },
    // Main → quick window: you were just summoned (reset draft + refocus).
    onShown: callback => {
      const listener = () => callback()
      ipcRenderer.on('krohn:quick-entry:shown', listener)

      return () => ipcRenderer.removeListener('krohn:quick-entry:shown', listener)
    },
    // Main → quick window: the outcome of a submit whose relay already timed
    // out. Delivery is now KNOWN — reconcile the unknown state instead of
    // leaving the user to resend a prompt that may already be delivered.
    onLateResult: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('krohn:quick-entry:late-result', listener)

      return () => ipcRenderer.removeListener('krohn:quick-entry:late-result', listener)
    }
  },
  getBootProgress: () => ipcRenderer.invoke('krohn:boot-progress:get'),
  getConnectionConfig: profile => ipcRenderer.invoke('krohn:connection-config:get', profile),
  saveConnectionConfig: payload => ipcRenderer.invoke('krohn:connection-config:save', payload),
  applyConnectionConfig: payload => ipcRenderer.invoke('krohn:connection-config:apply', payload),
  testConnectionConfig: payload => ipcRenderer.invoke('krohn:connection-config:test', payload),
  // Opt-in OS-keychain encryption for stored gateway secrets (default off —
  // see secret-storage-policy.ts). get never touches the OS keychain.
  getSecretStorageEncryption: () => ipcRenderer.invoke('krohn:secret-storage:get'),
  setSecretStorageEncryption: (on: boolean) => ipcRenderer.invoke('krohn:secret-storage:set', on),
  // v2 multi-connection registry: named agent sources (local / remote / cloud / ssh).
  connections: {
    list: () => ipcRenderer.invoke('krohn:connections:list'),
    save: payload => ipcRenderer.invoke('krohn:connections:save', payload),
    remove: id => ipcRenderer.invoke('krohn:connections:remove', id),
    setPrimary: id => ipcRenderer.invoke('krohn:connections:set-primary', id),
    setLaunchMode: mode => ipcRenderer.invoke('krohn:connections:set-launch-mode', mode),
    setLastUsed: id => ipcRenderer.invoke('krohn:connections:set-last-used', id),
    test: id => ipcRenderer.invoke('krohn:connections:test', id),
    updateManaged: id => ipcRenderer.invoke('krohn:connections:update-managed', id),
    // Fan out `krohn update` to every eligible registered connection.
    // Optional excludeIds skips rows the caller updates through another path.
    updateAll: options => ipcRenderer.invoke('krohn:connections:update-all', options),
    // Registry lifecycle push (main → renderer): a connection was removed or
    // materially edited, so secondaries scoped to it must be disposed (and,
    // for edits, re-dialed at the new target).
    onChanged: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('krohn:connections:changed', listener)

      return () => ipcRenderer.removeListener('krohn:connections:changed', listener)
    }
  },
  sshConfigHosts: () => ipcRenderer.invoke('krohn:ssh-config:hosts'),
  sshResolveHost: host => ipcRenderer.invoke('krohn:ssh-config:resolve', host),
  probeConnectionConfig: remoteUrl => ipcRenderer.invoke('krohn:connection-config:probe', remoteUrl),
  // `options` lets a registry-editor draft sign in BEFORE it is saved: the
  // main process settles the draft's connection id up front so the login
  // window writes into the per-connection cookie jar the saved entry will
  // read (not the legacy shared jar an unsaved URL would fall back to).
  oauthLoginConnectionConfig: (remoteUrl, options) =>
    ipcRenderer.invoke('krohn:connection-config:oauth-login', remoteUrl, options),
  oauthLogoutConnectionConfig: remoteUrl => ipcRenderer.invoke('krohn:connection-config:oauth-logout', remoteUrl),
  // KROHN Cloud: one portal login powers discovery + silent per-agent sign-in
  // (cloud-auto-discovery Phase 3).
  cloud: {
    status: () => ipcRenderer.invoke('krohn:cloud:status'),
    login: () => ipcRenderer.invoke('krohn:cloud:login'),
    logout: () => ipcRenderer.invoke('krohn:cloud:logout'),
    discover: org => ipcRenderer.invoke('krohn:cloud:discover', org),
    agentSignIn: dashboardUrl => ipcRenderer.invoke('krohn:cloud:agent-sign-in', dashboardUrl)
  },
  profile: {
    getDefault: () => ipcRenderer.invoke('krohn:profile:default:get'),
    setDefault: (route: DesktopProfileRoute) => ipcRenderer.invoke('krohn:profile:default:set', route),
    onDefaultChanged: (callback: (route: DesktopProfileRoute | null) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, route: DesktopProfileRoute | null) => callback(route)
      ipcRenderer.on('krohn:profile:default:changed', listener)

      return () => ipcRenderer.removeListener('krohn:profile:default:changed', listener)
    },
    get: () => ipcRenderer.invoke('krohn:profile:get'),
    remember: name => ipcRenderer.invoke('krohn:profile:remember', name),
    importConnections: (record: Record<string, string>) =>
      ipcRenderer.invoke('krohn:profile:connections:import', record),
    rememberConnection: (connectionId: string, profile: string) =>
      ipcRenderer.invoke('krohn:profile:connections:remember', connectionId, profile),
    set: name => ipcRenderer.invoke('krohn:profile:set', name)
  },
  // The handler resolves an expected 404 with a sentinel instead of rejecting
  // (Electron logs a stack for every rejected invoke). Turn it back into the
  // rejection the renderer expects — see electron/api-expected-404.ts.
  api: request => ipcRenderer.invoke('krohn:api', request).then(unwrapExpectedNotFound),
  notify: payload => ipcRenderer.invoke('krohn:notify', payload),
  claimStartupLatency: () => ipcRenderer.invoke('krohn:startup-latency:claim'),
  requestMicrophoneAccess: () => ipcRenderer.invoke('krohn:requestMicrophoneAccess'),
  readWindowBelow: () => ipcRenderer.invoke('krohn:window:readBelow'),
  readFileDataUrl: filePath => ipcRenderer.invoke('krohn:readFileDataUrl', filePath),
  readFileDataUrlForAttach: filePath => ipcRenderer.invoke('krohn:readFileDataUrlForAttach', filePath),
  dataUrlReadMax: {
    get: () => ipcRenderer.invoke('krohn:data-url-read-max:get'),
    set: maxMb => ipcRenderer.invoke('krohn:data-url-read-max:set', maxMb)
  },
  readFileText: filePath => ipcRenderer.invoke('krohn:readFileText', filePath),
  readPluginSource: (filePath: string) => ipcRenderer.invoke('krohn:readPluginSource', filePath),
  selectPaths: options => ipcRenderer.invoke('krohn:selectPaths', options),
  selectSavePath: options => ipcRenderer.invoke('krohn:selectSavePath', options),
  saveTextFileAs: request => ipcRenderer.invoke('krohn:saveTextFileAs', request),
  writeClipboard: text => ipcRenderer.invoke('krohn:writeClipboard', text),
  readClipboard: () => ipcRenderer.invoke('krohn:readClipboard'),
  saveGatewayFile: payload => ipcRenderer.invoke('krohn:saveGatewayFile', payload),
  saveImageFromUrl: url => ipcRenderer.invoke('krohn:saveImageFromUrl', url),
  contextMenuEdit: command => ipcRenderer.invoke('krohn:context-menu:edit', command),
  contextMenuCopyImage: () => ipcRenderer.invoke('krohn:context-menu:copy-image'),
  contextMenuSpellcheck: action => ipcRenderer.invoke('krohn:context-menu:spellcheck', action),
  contextMenuGuestAddWord: payload => ipcRenderer.invoke('krohn:context-menu:guest-add-word', payload),
  spellcheckDictionary: (op, word) => ipcRenderer.invoke('krohn:spellcheck:dictionary', { op, word }),
  onContextMenuSpellcheck: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('krohn:context-menu-spellcheck', listener)

    return () => ipcRenderer.removeListener('krohn:context-menu-spellcheck', listener)
  },
  saveImageBuffer: (data, ext, name) => ipcRenderer.invoke('krohn:saveImageBuffer', { data, ext, name }),
  capturePreview: payload => ipcRenderer.invoke('krohn:capturePreview', payload),
  savePastedText: text => ipcRenderer.invoke('krohn:savePastedText', { text }),
  saveClipboardImage: () => ipcRenderer.invoke('krohn:saveClipboardImage'),
  getPathForFile: file => {
    try {
      return webUtils.getPathForFile(file) || ''
    } catch {
      return ''
    }
  },
  normalizePreviewTarget: (target, baseDir) => ipcRenderer.invoke('krohn:normalizePreviewTarget', target, baseDir),
  watchPreviewFile: url => ipcRenderer.invoke('krohn:watchPreviewFile', url),
  watchDirectory: dir => ipcRenderer.invoke('krohn:watchDirectory', dir),
  stopPreviewFileWatch: id => ipcRenderer.invoke('krohn:stopPreviewFileWatch', id),
  setActiveWork: payload => ipcRenderer.send('krohn:active-work', payload),
  scheduleStreamWorkWake: (token, delayMs) => ipcRenderer.send('krohn:stream-work-wake', { token, delayMs }),
  onStreamWorkWake: callback => {
    const listener = (_event, token) => callback(token)
    ipcRenderer.on('krohn:stream-work-ready', listener)

    return () => ipcRenderer.removeListener('krohn:stream-work-ready', listener)
  },
  setTitleBarTheme: payload => ipcRenderer.send('krohn:titlebar-theme', payload),
  setNativeTheme: mode => ipcRenderer.send('krohn:native-theme', mode),
  setTranslucency: payload => ipcRenderer.send('krohn:translucency', payload),
  setKeepAwake: mode => ipcRenderer.send('krohn:keep-awake', mode),
  // Once per computer, after a timed sleep interrupted a turn with keep-awake off.
  onKeepAwakeOffer: callback => {
    const listener = () => callback()
    ipcRenderer.on('krohn:keep-awake-offer', listener)

    return () => ipcRenderer.removeListener('krohn:keep-awake-offer', listener)
  },
  minimizeToTray: {
    get: () => ipcRenderer.invoke('krohn:minimize-to-tray:get'),
    set: on => ipcRenderer.invoke('krohn:minimize-to-tray:set', on),
    onChanged: callback => {
      const listener = (_event, status) => callback(status)
      ipcRenderer.on('krohn:minimize-to-tray:changed', listener)

      return () => ipcRenderer.removeListener('krohn:minimize-to-tray:changed', listener)
    }
  },
  setDisableF12: blocked => ipcRenderer.send('krohn:devtools:disable-f12', blocked),
  setF12ShortcutActive: active => ipcRenderer.send('krohn:f12ShortcutActive', Boolean(active)),
  onF12Shortcut: callback => {
    const listener = (_event, input) => callback(input)
    ipcRenderer.on('krohn:f12-shortcut', listener)

    return () => ipcRenderer.removeListener('krohn:f12-shortcut', listener)
  },
  setPreviewShortcutActive: active => ipcRenderer.send('krohn:previewShortcutActive', Boolean(active)),
  setPreviewGuestHidden: (webContentsId, hidden) =>
    ipcRenderer.send('krohn:preview-guest-hidden', { webContentsId, hidden: Boolean(hidden) }),
  beginPreviewGuestActivity: webContentsId => ipcRenderer.invoke('krohn:preview-guest-activity:begin', webContentsId),
  endPreviewGuestActivity: token => ipcRenderer.invoke('krohn:preview-guest-activity:end', token),
  executePreviewGuestScript: (token, code) => ipcRenderer.invoke('krohn:preview-guest-activity:script', token, code),
  syncPreviewSignins: request => ipcRenderer.invoke('krohn:preview-signins:sync', request),
  migratePreviewSigninsForProfile: (request: { oldProfile: string; newProfile: string }) =>
    ipcRenderer.invoke('krohn:preview-signins:profile-renamed', request),
  dropPreviewSigninsForProfile: (request: { profile: string }) =>
    ipcRenderer.invoke('krohn:preview-signins:profile-deleted', request),
  openExternal: url => ipcRenderer.invoke('krohn:openExternal', url),
  freeTierChallenge: {
    // Load the account service's challenge page in a hidden window (revealed
    // only if the page asks for the human). Resolves with how it ended.
    run: request => ipcRenderer.invoke('krohn:freeTierChallenge:run', request)
  },
  mcpOauth: {
    // One-shot loopback listener for MCP OAuth against remote backends: bind
    // on this machine, hand redirectUri to mcp.servers.oauth.start, then wait
    // for the provider redirect and relay code/state via oauth.callback.
    listen: () => ipcRenderer.invoke('krohn:mcp-oauth:listen'),
    wait: (id, timeoutMs) => ipcRenderer.invoke('krohn:mcp-oauth:wait', id, timeoutMs),
    cancel: id => ipcRenderer.invoke('krohn:mcp-oauth:cancel', id)
  },
  openPreviewInBrowser: url => ipcRenderer.invoke('krohn:openPreviewInBrowser', url),
  reachPreviewUrl: url => ipcRenderer.invoke('krohn:preview:reach', url),
  setActiveConnectionRoute: route => ipcRenderer.send('krohn:connection:active-route', route),
  fetchLinkTitle: url => ipcRenderer.invoke('krohn:fetchLinkTitle', url),
  resolveFavicon: url => ipcRenderer.invoke('krohn:resolveFavicon', url),
  sanitizeWorkspaceCwd: cwd => ipcRenderer.invoke('krohn:workspace:sanitize', cwd),
  settings: {
    getDefaultProjectDir: () => ipcRenderer.invoke('krohn:setting:defaultProjectDir:get'),
    setDefaultProjectDir: dir => ipcRenderer.invoke('krohn:setting:defaultProjectDir:set', dir),
    pickDefaultProjectDir: () => ipcRenderer.invoke('krohn:setting:defaultProjectDir:pick')
  },
  preparedSubmissions: {
    read: () => ipcRenderer.invoke('krohn:prepared-submissions:read'),
    update: (key, entry) => ipcRenderer.invoke('krohn:prepared-submissions:update', key, entry),
    compareAndSet: (key, expected, entry) =>
      ipcRenderer.invoke('krohn:prepared-submissions:compare-and-set', key, expected, entry)
  },
  zoom: {
    // Current zoom of this window, as { level, percent }.
    get: () => ipcRenderer.invoke('krohn:zoom:get'),
    // Synchronous zoom factor (1 = 100%). Coordinate math needs it in the
    // same tick as the event it converts, so no IPC round-trip here.
    factor: () => webFrame.getZoomFactor(),
    setPercent: percent => ipcRenderer.send('krohn:zoom:set-percent', percent),
    // Fires on every zoom change, including the Ctrl/Cmd +/-/0 shortcuts,
    // so the settings UI can stay in sync with the keyboard.
    onChanged: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('krohn:zoom:changed', listener)

      return () => ipcRenderer.removeListener('krohn:zoom:changed', listener)
    }
  },
  revealLogs: () => ipcRenderer.invoke('krohn:logs:reveal'),
  getRecentLogs: () => ipcRenderer.invoke('krohn:logs:recent'),
  // Fire-and-forget: persists a renderer error-boundary catch (with component
  // stack) to desktop.log so crashes survive the window (#79428).
  reportRendererError: report => ipcRenderer.send('krohn:logs:renderer-error', report),
  logLine: (line: string): void => ipcRenderer.send('krohn:logs:renderer-line', line),
  readDir: dirPath => ipcRenderer.invoke('krohn:fs:readDir', dirPath),
  gitRoot: startPath => ipcRenderer.invoke('krohn:fs:gitRoot', startPath),
  revealPath: targetPath => ipcRenderer.invoke('krohn:fs:reveal', targetPath),
  openDir: dirPath => ipcRenderer.invoke('krohn:fs:openDir', dirPath),
  desktopPluginsRoot: () => ipcRenderer.invoke('krohn:fs:desktopPluginsRoot'),
  reconcileDesktopPlugins: async () => (await ipcRenderer.invoke('krohn:fs:reconcileDesktopPlugins')).published,
  reconcileDesktopPluginsReport: () => ipcRenderer.invoke('krohn:fs:reconcileDesktopPlugins'),
  logsRoot: (profile?: string) => ipcRenderer.invoke('krohn:fs:logsRoot', profile),
  renamePath: (targetPath, newName) => ipcRenderer.invoke('krohn:fs:rename', targetPath, newName),
  writeTextFile: (filePath, content) => ipcRenderer.invoke('krohn:fs:writeText', filePath, content),
  trashPath: targetPath => ipcRenderer.invoke('krohn:fs:trash', targetPath),
  pluginFiles: {
    request: (pluginId, labels) => ipcRenderer.invoke('krohn:pluginFiles:request', pluginId, labels),
    grants: pluginId => ipcRenderer.invoke('krohn:pluginFiles:grants', pluginId),
    revoke: (pluginId, folderId) => ipcRenderer.invoke('krohn:pluginFiles:revoke', pluginId, folderId),
    op: (pluginId, request) => ipcRenderer.invoke('krohn:pluginFiles:op', pluginId, request),
    onChanged: callback => {
      const listener = (_event, change) => callback(change)
      ipcRenderer.on('krohn:pluginFiles:changed', listener)

      return () => ipcRenderer.removeListener('krohn:pluginFiles:changed', listener)
    }
  },
  git: {
    worktreeList: repoPath => ipcRenderer.invoke('krohn:git:worktreeList', repoPath),
    worktreeAdd: (repoPath, options) => ipcRenderer.invoke('krohn:git:worktreeAdd', repoPath, options),
    worktreeRemove: (repoPath, worktreePath, options) =>
      ipcRenderer.invoke('krohn:git:worktreeRemove', repoPath, worktreePath, options),
    branchSwitch: (repoPath, branch) => ipcRenderer.invoke('krohn:git:branchSwitch', repoPath, branch),
    branchList: repoPath => ipcRenderer.invoke('krohn:git:branchList', repoPath),
    baseBranchList: repoPath => ipcRenderer.invoke('krohn:git:baseBranchList', repoPath),
    repoStatus: repoPath => ipcRenderer.invoke('krohn:git:repoStatus', repoPath),
    fileDiff: (repoPath, filePath) => ipcRenderer.invoke('krohn:git:fileDiff', repoPath, filePath),
    scanRepos: (roots, options) => ipcRenderer.invoke('krohn:git:scanRepos', roots, options),
    review: {
      list: (repoPath, scope, baseRef) => ipcRenderer.invoke('krohn:git:review:list', repoPath, scope, baseRef),
      diff: (repoPath, filePath, scope, baseRef, staged) =>
        ipcRenderer.invoke('krohn:git:review:diff', repoPath, filePath, scope, baseRef, staged),
      stage: (repoPath, filePath) => ipcRenderer.invoke('krohn:git:review:stage', repoPath, filePath),
      unstage: (repoPath, filePath) => ipcRenderer.invoke('krohn:git:review:unstage', repoPath, filePath),
      revert: (repoPath, filePath) => ipcRenderer.invoke('krohn:git:review:revert', repoPath, filePath),
      revParse: (repoPath, ref) => ipcRenderer.invoke('krohn:git:review:revParse', repoPath, ref),
      commit: (repoPath, message, push) => ipcRenderer.invoke('krohn:git:review:commit', repoPath, message, push),
      commitContext: repoPath => ipcRenderer.invoke('krohn:git:review:commitContext', repoPath),
      push: repoPath => ipcRenderer.invoke('krohn:git:review:push', repoPath),
      shipInfo: repoPath => ipcRenderer.invoke('krohn:git:review:shipInfo', repoPath),
      prList: (repoPath, branches, numbers) =>
        ipcRenderer.invoke('krohn:git:review:prList', repoPath, branches, numbers),
      createPr: repoPath => ipcRenderer.invoke('krohn:git:review:createPr', repoPath)
    }
  },
  terminal: {
    attach: id => ipcRenderer.invoke('krohn:terminal:attach', id),
    cwd: id => ipcRenderer.invoke('krohn:terminal:cwd', id),
    dispose: id => ipcRenderer.invoke('krohn:terminal:dispose', id),
    resize: (id, size) => ipcRenderer.invoke('krohn:terminal:resize', id, size),
    start: options => ipcRenderer.invoke('krohn:terminal:start', options),
    write: (id, data) => ipcRenderer.invoke('krohn:terminal:write', id, data),
    onData: (id, callback) => {
      const channel = `krohn:terminal:${id}:data`
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on(channel, listener)

      return () => ipcRenderer.removeListener(channel, listener)
    },
    onExit: (id, callback) => {
      const channel = `krohn:terminal:${id}:exit`
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on(channel, listener)

      return () => ipcRenderer.removeListener(channel, listener)
    }
  },
  onClosePreviewRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('krohn:close-preview-requested', listener)

    return () => ipcRenderer.removeListener('krohn:close-preview-requested', listener)
  },
  onPreviewNav: callback => {
    const listener = (_event, command) => callback(command)
    ipcRenderer.on('krohn:preview-nav', listener)

    return () => ipcRenderer.removeListener('krohn:preview-nav', listener)
  },
  onOpenFolderRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('krohn:open-folder-requested', listener)

    return () => ipcRenderer.removeListener('krohn:open-folder-requested', listener)
  },
  onOpenUpdatesRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('krohn:open-updates', listener)

    return () => ipcRenderer.removeListener('krohn:open-updates', listener)
  },
  onDeepLink: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('krohn:deep-link', listener)

    return () => ipcRenderer.removeListener('krohn:deep-link', listener)
  },
  signalDeepLinkReady: () => ipcRenderer.invoke('krohn:deep-link-ready'),
  probePluginRepo: payload => ipcRenderer.invoke('krohn:plugin:probe', payload),
  installDesktopPlugin: payload => ipcRenderer.invoke('krohn:plugin:installDesktop', payload),
  removeDesktopPlugin: payload => ipcRenderer.invoke('krohn:plugin:removeDesktop', payload),
  onWindowStateChanged: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('krohn:window-state-changed', listener)

    return () => ipcRenderer.removeListener('krohn:window-state-changed', listener)
  },
  onFocusSession: callback => {
    const listener = (_event, sessionId) => callback(sessionId)
    ipcRenderer.on('krohn:focus-session', listener)

    return () => ipcRenderer.removeListener('krohn:focus-session', listener)
  },
  onNotificationAction: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('krohn:notification-action', listener)

    return () => ipcRenderer.removeListener('krohn:notification-action', listener)
  },
  onNotificationActivate: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('krohn:notification-activate', listener)

    return () => ipcRenderer.removeListener('krohn:notification-activate', listener)
  },
  onExternalOpenFailed: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('krohn:external-open-failed', listener)

    return () => ipcRenderer.removeListener('krohn:external-open-failed', listener)
  },
  onPreviewFileChanged: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('krohn:preview-file-changed', listener)

    return () => ipcRenderer.removeListener('krohn:preview-file-changed', listener)
  },
  onBackendExit: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('krohn:backend-exit', listener)

    return () => ipcRenderer.removeListener('krohn:backend-exit', listener)
  },
  // Soft gateway-mode apply finished tearing down the primary backend. Renderer
  // should wipe session lists + re-dial without a window reload.
  onConnectionApplied: callback => {
    const listener = () => callback()
    ipcRenderer.on('krohn:connection:applied', listener)

    return () => ipcRenderer.removeListener('krohn:connection:applied', listener)
  },
  onPowerResume: callback => {
    const listener = () => callback()
    ipcRenderer.on('krohn:power-resume', listener)

    return () => ipcRenderer.removeListener('krohn:power-resume', listener)
  },
  // AC ↔ battery transitions; renderers slow their backstop polls on battery.
  getOnBattery: () => ipcRenderer.invoke('krohn:power-battery:get'),
  onBatteryChanged: callback => {
    const listener = (_event, onBattery) => callback(Boolean(onBattery))
    ipcRenderer.on('krohn:power-battery', listener)

    return () => ipcRenderer.removeListener('krohn:power-battery', listener)
  },
  onBootProgress: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('krohn:boot-progress', listener)

    return () => ipcRenderer.removeListener('krohn:boot-progress', listener)
  },
  // First-launch bootstrap progress -- emitted by the install.ps1 stage
  // runner in main.ts (apps/desktop/electron/bootstrap-runner.ts).
  // Renderer's install overlay subscribes to live events and queries the
  // current snapshot via getBootstrapState() to recover after a devtools
  // reload mid-bootstrap.
  getBootstrapState: () => ipcRenderer.invoke('krohn:bootstrap:get'),
  probeLocalBackend: () => ipcRenderer.invoke('krohn:local-backend:probe'),
  continueBootstrapLocal: () => ipcRenderer.invoke('krohn:bootstrap:continue-local'),
  recycleBackend: profile => ipcRenderer.invoke('krohn:backend:recycle', profile),
  resetBootstrap: () => ipcRenderer.invoke('krohn:bootstrap:reset'),
  updateHold: {
    recheck: () => ipcRenderer.invoke('krohn:update-hold:recheck'),
    quit: () => ipcRenderer.invoke('krohn:update-hold:quit'),
    startAnyway: (request: { holdId: string; confirmed: true }) =>
      ipcRenderer.invoke('krohn:update-hold:start-anyway', request)
  },
  repairBootstrap: () => ipcRenderer.invoke('krohn:bootstrap:repair'),
  cancelBootstrap: () => ipcRenderer.invoke('krohn:bootstrap:cancel'),
  onBootstrapEvent: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('krohn:bootstrap:event', listener)

    return () => ipcRenderer.removeListener('krohn:bootstrap:event', listener)
  },
  getVersion: (scope?: { connectionId?: string; profile?: string }) => ipcRenderer.invoke('krohn:version', scope),
  relaunchApp: () => ipcRenderer.invoke('krohn:app:relaunch'),
  getMachineProfile: () => ipcRenderer.invoke('krohn:machine:profile'),
  getRemoteDisplayReason: () => ipcRenderer.invoke('krohn:get-remote-display-reason'),
  uninstall: {
    summary: () => ipcRenderer.invoke('krohn:uninstall:summary'),
    run: mode => ipcRenderer.invoke('krohn:uninstall:run', { mode }),
    openAppsSettings: () => ipcRenderer.invoke('krohn:uninstall:openAppsSettings')
  },
  updates: {
    check: opts => ipcRenderer.invoke('krohn:updates:check', opts),
    apply: opts => ipcRenderer.invoke('krohn:updates:apply', opts),
    setChannel: name => ipcRenderer.invoke('krohn:updates:channel:set', name),
    onProgress: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('krohn:updates:progress', listener)

      return () => ipcRenderer.removeListener('krohn:updates:progress', listener)
    },
    takePendingRun: () => ipcRenderer.invoke('krohn:updates:metric:take'),
    ackPendingRun: sent => ipcRenderer.invoke('krohn:updates:metric:ack', sent),
    onPendingRun: callback => {
      const listener = () => callback()
      ipcRenderer.on('krohn:updates:metric:pending', listener)

      return () => ipcRenderer.removeListener('krohn:updates:metric:pending', listener)
    }
  },
  desktopMetrics: {
    setEnabled: (on, profile) => ipcRenderer.invoke('krohn:desktop-metrics:set-enabled', on, profile),
    takeRendererCrashes: () => ipcRenderer.invoke('krohn:desktop-metrics:crash:take'),
    ackRendererCrashes: sent => ipcRenderer.invoke('krohn:desktop-metrics:crash:ack', sent)
  },
  themes: {
    fetchMarketplace: id => ipcRenderer.invoke('krohn:vscode-theme:fetch', id),
    searchMarketplace: query => ipcRenderer.invoke('krohn:vscode-theme:search', query)
  },
  // Find-in-page (Ctrl/Cmd+F): delegates to Electron's
  // webContents.findInPage on the IPC sender's window so a Cmd+F pressed
  // in a secondary session window searches THAT window, not the primary.
  // `onFoundInPage` returns the unsubscribe fn; the renderer wires it via
  // `initFindInPageListener` in store/find-in-page.ts and tears it down
  // when the FindBar unmounts.
  findInPage: (query, options) => ipcRenderer.invoke('krohn:find-in-page', query, options),
  stopFindInPage: () => ipcRenderer.invoke('krohn:stop-find-in-page'),
  onFoundInPage: callback => {
    const listener = (_event, result) => callback(result)
    ipcRenderer.on('krohn:found-in-page', listener)

    return () => ipcRenderer.removeListener('krohn:found-in-page', listener)
  },
  // Main-process `before-input-event` forwards Ctrl/Cmd+F here so renderer
  // can open the FindBar even when the GTK compositor has already grabbed
  // the chord at the windowing layer (#81727).
  onOpenFindBarRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('krohn:open-find-bar', listener)

    return () => ipcRenderer.removeListener('krohn:open-find-bar', listener)
  }
})
