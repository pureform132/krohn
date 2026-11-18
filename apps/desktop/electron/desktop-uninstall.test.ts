/**
 * Tests for electron/desktop-uninstall.ts.
 *
 * Run with: node --test electron/desktop-uninstall.test.ts
 * (Wired into pnpm run test:desktop:platforms in package.json.)
 *
 * These are the pure helpers behind the desktop Chat GUI uninstaller: the
 * mode → CLI-flag mapping, the running-app-bundle resolution per OS, and the
 * cleanup-script builders (POSIX + Windows).
 */

import assert from 'node:assert/strict'
import { type ChildProcess, spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { test } from 'vitest'

import {
  allowedUninstallModes,
  buildPosixCleanupScript,
  buildWindowsCleanupScript,
  installKindAllowsCodeRemoval,
  modeRemovesAgent,
  modeRemovesUserData,
  nativeRemovalInstructions,
  resolveInstallKind,
  resolveRemovableAppPath,
  shouldRemoveAppBundle,
  uninstallArgsForMode
} from './desktop-uninstall'

// --- uninstallArgsForMode ---

test('uninstallArgsForMode throws on an unknown mode (no silent full wipe)', () => {
  assert.throws(() => uninstallArgsForMode('nuke'), /Unknown uninstall mode/)
  assert.throws(() => uninstallArgsForMode(''), /Unknown uninstall mode/)
})

// --- resolveInstallKind / allowedUninstallModes / nativeRemovalInstructions ---

test('resolveInstallKind reads the stamp: distribution nix wins, payload kind means bundled', () => {
  assert.equal(resolveInstallKind({ distribution: 'nix' }), 'nix')
  assert.equal(resolveInstallKind({ source: 'nix' }), 'nix')
  // distribution beats payload: a nix stamp never becomes 'bundled'.
  assert.equal(resolveInstallKind({ distribution: 'nix', payload: 'bundled' }), 'nix')
  assert.equal(resolveInstallKind({ distribution: 'desktop-app', payload: 'bundled' }), 'bundled')
  assert.equal(resolveInstallKind({ payload: 'bundled' }), 'bundled')
  // light artifacts have no agent code either — same managed flow.
  assert.equal(resolveInstallKind({ payload: 'light' }), 'bundled')
  // bootstrap / no stamp facts at all → the classic source/installer flow.
  assert.equal(resolveInstallKind({ payload: 'bootstrap' }), 'standard')
  assert.equal(resolveInstallKind({}), 'standard')
  assert.equal(resolveInstallKind(), 'standard')
})

test('only standard installs allow desktop uninstall; managed kinds have no safe mode', (): void => {
  assert.equal(installKindAllowsCodeRemoval('standard'), true)
  assert.equal(installKindAllowsCodeRemoval('nix'), false)
  assert.equal(installKindAllowsCodeRemoval('bundled'), false)

  assert.deepEqual(allowedUninstallModes('standard'), ['gui', 'lite', 'full'])
  assert.deepEqual(allowedUninstallModes('nix'), [])
  assert.deepEqual(allowedUninstallModes('bundled'), [])
})

test('nativeRemovalInstructions names the steward per kind and OS', () => {
  assert.match(nativeRemovalInstructions('nix', 'linux'), /installed by Nix/)
  assert.match(nativeRemovalInstructions('nix', 'darwin'), /flake or profile/)

  for (const platform of ['linux', 'darwin', 'win32']) {
    const steps = nativeRemovalInstructions('external', platform, '/usr/lib/krohn/krohn')
    assert.match(steps, /with that package manager/)
    assert.doesNotMatch(steps, /Delete|Trash/)
  }

  assert.match(nativeRemovalInstructions('bundled', 'win32'), /Installed apps/)
  assert.equal(
    nativeRemovalInstructions('bundled', 'darwin', '/Applications/KROHN Canary.app'),
    'Quit the app and drag KROHN Canary.app from /Applications to the Trash.'
  )
  assert.match(nativeRemovalInstructions('bundled', 'darwin'), /drag the KROHN app from Applications to the Trash/)
  assert.match(
    nativeRemovalInstructions('bundled', 'linux', '/home/x/Apps/KROHN.AppImage'),
    /\/home\/x\/Apps\/KROHN\.AppImage/
  )
  assert.match(
    nativeRemovalInstructions('bundled', 'linux', '/opt/krohn/linux-unpacked'),
    /app directory at \/opt\/krohn\/linux-unpacked/
  )
  assert.match(nativeRemovalInstructions('bundled', 'linux'), /wherever you saved it/)
})

// --- modeRemovesAgent / modeRemovesUserData ---

test('mode predicates classify what each mode removes', () => {
  assert.equal(modeRemovesAgent('gui'), false)
  assert.equal(modeRemovesAgent('lite'), true)
  assert.equal(modeRemovesAgent('full'), true)
  assert.equal(modeRemovesAgent('data'), false)

  assert.equal(modeRemovesUserData('gui'), false)
  assert.equal(modeRemovesUserData('lite'), false)
  assert.equal(modeRemovesUserData('full'), true)
  assert.equal(modeRemovesUserData('data'), true)
})

// --- resolveRemovableAppPath ---

test('resolveRemovableAppPath finds the .app bundle on macOS', () => {
  assert.equal(
    resolveRemovableAppPath('/Applications/KROHN.app/Contents/MacOS/KROHN', 'darwin'),
    '/Applications/KROHN.app'
  )
  assert.equal(
    resolveRemovableAppPath('/Users/x/Applications/KROHN.app/Contents/MacOS/KROHN', 'darwin'),
    '/Users/x/Applications/KROHN.app'
  )
})

test('resolveRemovableAppPath: dev-run .app resolves (safety is shouldRemoveAppBundle, not null)', () => {
  // A dev run from node_modules' Electron DOES resolve to a .app — the real
  // dev-run safety gate is shouldRemoveAppBundle(isPackaged=false,...), not a
  // null return here. This test documents that contract.
  assert.equal(
    resolveRemovableAppPath('/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron', 'darwin'),
    '/repo/node_modules/electron/dist/Electron.app'
  )
  assert.equal(shouldRemoveAppBundle(false, '/repo/node_modules/electron/dist/Electron.app'), false)
  // A bare path with no .app ancestor → null.
  assert.equal(resolveRemovableAppPath('/usr/bin/electron', 'darwin'), null)
})

test('resolveRemovableAppPath finds the install dir on Windows', () => {
  assert.equal(
    resolveRemovableAppPath('C:\\Users\\x\\AppData\\Local\\Programs\\KROHN\\KROHN.exe', 'win32'),
    'C:\\Users\\x\\AppData\\Local\\Programs\\KROHN'
  )
  assert.equal(
    resolveRemovableAppPath('C:\\Users\\x\\AppData\\Local\\krohn-desktop\\KROHN.exe', 'win32'),
    'C:\\Users\\x\\AppData\\Local\\krohn-desktop'
  )
})

test('resolveRemovableAppPath returns null for an unrecognized Windows dir', () => {
  assert.equal(resolveRemovableAppPath('C:\\Temp\\foo\\KROHN.exe', 'win32'), null)
})

test('resolveRemovableAppPath uses APPIMAGE on Linux when set', () => {
  assert.equal(
    resolveRemovableAppPath('/tmp/.mount_KROHNXXXX/krohn', 'linux', { APPIMAGE: '/home/x/Apps/KROHN.AppImage' }),
    '/home/x/Apps/KROHN.AppImage'
  )
})

// AppImage apps (terminals, IDEs) export APPIMAGE to everything they start;
// uninstalling an unpacked KROHN launched from one must never rm -rf that app.
test('resolveRemovableAppPath ignores an APPIMAGE inherited from another AppImage', () => {
  assert.equal(
    resolveRemovableAppPath('/opt/krohn/linux-unpacked/krohn', 'linux', { APPIMAGE: '/home/x/Apps/Other.AppImage' }),
    '/opt/krohn/linux-unpacked'
  )
})

test('resolveRemovableAppPath finds the unpacked dir on Linux', () => {
  assert.equal(resolveRemovableAppPath('/opt/krohn/linux-unpacked/krohn', 'linux', {}), '/opt/krohn/linux-unpacked')
  // A system-package install (/usr/bin) → null, left to apt/dnf.
  assert.equal(resolveRemovableAppPath('/usr/bin/krohn', 'linux', {}), null)
})

test('resolveRemovableAppPath returns null for an empty exe path', () => {
  assert.equal(resolveRemovableAppPath('', 'darwin'), null)
  assert.equal(resolveRemovableAppPath(null, 'win32'), null)
})

// --- shouldRemoveAppBundle ---

test('shouldRemoveAppBundle requires packaged AND a resolved path', () => {
  assert.equal(shouldRemoveAppBundle(true, '/Applications/KROHN.app'), true)
  assert.equal(shouldRemoveAppBundle(false, '/Applications/KROHN.app'), false)
  assert.equal(shouldRemoveAppBundle(true, null), false)
  assert.equal(shouldRemoveAppBundle(false, null), false)
})

test.skipIf(process.platform === 'win32').each(['gui', 'lite', 'full'] as const)(
  'POSIX cleanup executes %s in its sandbox and preserves its sibling',
  async (mode: string): Promise<void> => {
    const root: string = fs.mkdtempSync(path.join(os.tmpdir(), "uninstall-o'brien-"))
    const app: string = path.join(root, 'App with spaces')
    const sibling: string = path.join(root, 'App with spaces-other')
    const recorder: string = path.join(root, "recorder's.cjs")
    const resultFile: string = path.join(root, 'observed.json')
    const script: string = path.join(root, 'cleanup.sh')
    let child: ChildProcess | undefined

    try {
      fs.mkdirSync(app)
      fs.mkdirSync(sibling)
      fs.writeFileSync(
        recorder,
        `require('node:fs').writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify({argv:process.argv.slice(2), home:process.env.KROHN_HOME, pythonPath:process.env.PYTHONPATH, cwd:process.cwd()}))`
      )
      fs.writeFileSync(
        script,
        buildPosixCleanupScript({
          desktopPid: 0,
          pythonExe: process.execPath,
          pythonPath: mode === 'gui' ? null : root,
          agentRoot: root,
          uninstallArgs: [recorder, ...uninstallArgsForMode(mode)],
          appPath: mode === 'lite' ? null : app,
          krohnHome: root
        })
      )
      child = spawn('bash', [script], {
        env: { ...process.env, PYTHONPATH: 'inherited', KROHN_HOME: root },
        stdio: 'ignore'
      })
      await once(child, 'close')
      assert.equal(child.exitCode, 0)
      assert.deepEqual(JSON.parse(fs.readFileSync(resultFile, 'utf8')), {
        argv: ['-m', 'krohn_cli.uninstall', '--mode', mode],
        home: root,
        pythonPath: mode === 'gui' ? 'inherited' : `${root}:inherited`,
        cwd: root
      })
      assert.equal(fs.existsSync(app), mode === 'lite')
      assert.equal(fs.existsSync(sibling), true)
      assert.equal(fs.existsSync(script), false)
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill()
        await once(child, 'close')
      }

      fs.rmSync(root, { recursive: true, force: true })
    }
  }
)

test('buildPosixCleanupScript waits for the PID, runs the uninstall module, removes bundle', (): void => {
  const script = buildPosixCleanupScript({
    desktopPid: 4321,
    pythonExe: '/home/x/.krohn/krohn/venv/bin/python',
    pythonPath: null,
    agentRoot: '/home/x/.krohn/krohn',
    uninstallArgs: ['-m', 'krohn_cli.uninstall', '--mode', 'gui'],
    appPath: '/opt/krohn/linux-unpacked',
    krohnHome: '/home/x/.krohn'
  })

  assert.match(script, /^#!\/usr\/bin\/env bash\n/)
  assert.match(script, /pid=4321/)
  assert.match(script, /kill -0 "\$pid"/)
  assert.match(script, /'-m' 'krohn_cli\.uninstall' '--mode' 'gui'/)
  assert.match(script, /rm -rf '\/opt\/krohn\/linux-unpacked'/)
  assert.match(script, /export KROHN_HOME='\/home\/x\/\.krohn'/)
})

// --- buildWindowsCleanupScript ---

test('buildWindowsCleanupScript waits (bounded) for PID, runs uninstall, rmdir bundle', () => {
  const script = buildWindowsCleanupScript({
    desktopPid: 9988,
    pythonExe: 'C:\\Python313\\python.exe',
    pythonPath: 'C:\\krohn',
    agentRoot: 'C:\\krohn',
    uninstallArgs: ['-m', 'krohn_cli.uninstall', '--mode', 'full'],
    appPath: 'C:\\Users\\x\\AppData\\Local\\Programs\\KROHN',
    krohnHome: 'C:\\Users\\x\\AppData\\Local\\krohn'
  })

  assert.match(script, /@echo off/)
  assert.match(script, /set "PID=9988"/)
  // PYTHONPATH set so a system python can import krohn_cli from source.
  assert.match(script, /set "PYTHONPATH=C:\\krohn;%PYTHONPATH%"/)
  assert.match(script, /"C:\\Python313\\python.exe" "-m" "krohn_cli\.uninstall" "--mode" "full"/)
  // Bounded wait-loop (no infinite loop), whole-token PID match (no substring).
  assert.match(script, /if %waited% geq 60 goto waited_done/)
  assert.match(script, /findstr \/r \/c:" %PID% "/)
  // Removal is a retry loop (Windows releases dir handles lazily).
  assert.match(script, /:rmloop/)
  assert.match(script, /rmdir \/s \/q "C:\\Users\\x\\AppData\\Local\\Programs\\KROHN" >nul 2>&1/)
  assert.match(script, /if %tries% geq 10 goto rmdone/)
  assert.match(script, /del "%~f0"/)
})

test('buildWindowsCleanupScript omits PYTHONPATH + rmdir when not needed (gui, no bundle)', () => {
  const script = buildWindowsCleanupScript({
    desktopPid: 2,
    pythonExe: 'C:\\h\\venv\\Scripts\\python.exe',
    pythonPath: null,
    agentRoot: 'C:\\h',
    uninstallArgs: ['-m', 'krohn_cli.uninstall', '--mode', 'gui'],
    appPath: null,
    krohnHome: 'C:\\h'
  })

  assert.doesNotMatch(script, /rmdir/)
  assert.doesNotMatch(script, /set "PYTHONPATH=/)
})
