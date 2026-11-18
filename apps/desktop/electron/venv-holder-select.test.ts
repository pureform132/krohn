import assert from 'node:assert/strict'

import { test } from 'vitest'

import { hasWindowsPathPrefix, isExternalVenvHolder, isKROHNOwnedVenvDaemon } from './venv-holder-select'

const SCRIPTS = 'C:\\KROHN\\venv\\Scripts'

test('matches the hindsight daemon shim (exe under venv Scripts + hindsight cmdline)', () => {
  assert.equal(
    isKROHNOwnedVenvDaemon(
      'C:\\KROHN\\venv\\Scripts\\pythonw.exe',
      'C:\\KROHN\\venv\\Scripts\\pythonw.exe -m hindsight_api.main --daemon --idle-timeout 300 --port 9177',
      SCRIPTS
    ),
    true
  )
})

test('Windows path prefix match is ordinal case-insensitive', () => {
  assert.equal(
    isKROHNOwnedVenvDaemon(
      'c:\\krohn\\venv\\scripts\\python.exe',
      'python.exe -m hindsight_api.main --daemon',
      'C:\\KROHN\\venv\\Scripts'
    ),
    true
  )
})

test('excludes external venv holders that are not the hindsight daemon', () => {
  // a user terminal running the krohn CLI from the venv — must NOT be killed
  assert.equal(isKROHNOwnedVenvDaemon('C:\\KROHN\\venv\\Scripts\\krohn.exe', 'krohn chat -q "hi"', SCRIPTS), false)
  // an unrelated python script using the venv interpreter
  assert.equal(
    isKROHNOwnedVenvDaemon('C:\\KROHN\\venv\\Scripts\\python.exe', 'python C:\\tools\\import.py', SCRIPTS),
    false
  )
})

test('excludes exes outside the venv even when the cmdline mentions hindsight', () => {
  assert.equal(
    isKROHNOwnedVenvDaemon('C:\\Other\\pythonw.exe', 'pythonw -m hindsight_api.main --daemon', SCRIPTS),
    false
  )
})

test('prefix boundary: sibling dirs (ScriptsX) do not match', () => {
  assert.equal(hasWindowsPathPrefix('C:\\KROHN\\venv\\ScriptsX\\python.exe', SCRIPTS), false)
  assert.equal(hasWindowsPathPrefix('C:\\KROHN\\venv\\Scripts\\python.exe', SCRIPTS), true)
})

test('null/undefined fields never match', () => {
  assert.equal(isKROHNOwnedVenvDaemon(null, 'x', SCRIPTS), false)
  assert.equal(isKROHNOwnedVenvDaemon('C:\\KROHN\\venv\\Scripts\\pythonw.exe', null, SCRIPTS), false)
  assert.equal(isKROHNOwnedVenvDaemon(undefined, undefined, SCRIPTS), false)
})

// --- isExternalVenvHolder (#62311) ------------------------------------------

test('matches the autostart gateway shim (krohn.exe under venv Scripts)', () => {
  assert.equal(
    isExternalVenvHolder(
      'C:\\KROHN\\venv\\Scripts\\krohn.exe',
      '"C:\\KROHN\\venv\\Scripts\\krohn.exe" gateway run --external-supervisor',
      SCRIPTS
    ),
    true
  )
})

test('matches the dashboard scheduled task (python -m krohn_cli / -m krohn)', () => {
  assert.equal(
    isExternalVenvHolder(
      'C:\\KROHN\\venv\\Scripts\\python.exe',
      '"C:\\KROHN\\venv\\Scripts\\python.exe" -m krohn_cli.main dashboard',
      SCRIPTS
    ),
    true
  )
  assert.equal(
    isExternalVenvHolder('C:\\KROHN\\venv\\Scripts\\pythonw.exe', 'pythonw.exe -m krohn serve', SCRIPTS),
    true
  )
})

test('never matches an unrelated process that merely borrows the venv interpreter', () => {
  // a user's own script running on the venv python — NOT KROHN, must NOT be killed
  assert.equal(
    isExternalVenvHolder('C:\\KROHN\\venv\\Scripts\\python.exe', 'python C:\\tools\\import.py', SCRIPTS),
    false
  )
  // hindsight daemon is selected by isKROHNOwnedVenvDaemon, not here
  assert.equal(
    isExternalVenvHolder('C:\\KROHN\\venv\\Scripts\\pythonw.exe', 'pythonw -m hindsight_api.main --daemon', SCRIPTS),
    false
  )
})

test('never matches a process outside the venv, even with krohn in the cmdline', () => {
  // an editor / shell whose command line mentions the install root (#62445 regression guard)
  assert.equal(
    isExternalVenvHolder('C:\\Windows\\System32\\cmd.exe', 'cmd /c cd C:\\KROHN\\venv\\Scripts && dir', SCRIPTS),
    false
  )
  assert.equal(isExternalVenvHolder('C:\\Other\\krohn.exe', 'krohn gateway run', SCRIPTS), false)
})

test('sibling-dir and boundary safety for the external selector', () => {
  assert.equal(isExternalVenvHolder('C:\\KROHN\\venv\\ScriptsX\\krohn.exe', 'krohn gateway run', SCRIPTS), false)
  assert.equal(isExternalVenvHolder(null, 'krohn gateway run', SCRIPTS), false)
  assert.equal(isExternalVenvHolder('C:\\KROHN\\venv\\Scripts\\krohn.exe', null, SCRIPTS), false)
})
