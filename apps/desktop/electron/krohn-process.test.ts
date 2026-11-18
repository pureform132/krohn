import { describe, expect, it } from 'vitest'

import { commandLineIsKROHNRuntime } from './krohn-process'

// HX003: process identity comes from a whole argv TOKEN, never an argv substring.
describe('commandLineIsKROHNRuntime (HX003 token matching)', () => {
  it('matches a real KROHN gateway command line', () => {
    expect(commandLineIsKROHNRuntime('krohn\0gateway\0run')).toBe(true)
    expect(commandLineIsKROHNRuntime('krohn gateway run')).toBe(true)
    expect(commandLineIsKROHNRuntime('krohn --profile work gateway run')).toBe(true)
  })

  it('matches a KROHN launched by an interpreter (basename of a path token)', () => {
    expect(commandLineIsKROHNRuntime('/venv/bin/python\0/venv/bin/krohn\0gateway\0run')).toBe(true)
    expect(commandLineIsKROHNRuntime('C:\\KROHN\\krohn.exe gateway run')).toBe(true)
  })

  // The bug this replaces: a bare `.includes('krohn')` matched any of these.
  it('does NOT match an unrelated process whose path merely contains "krohn"', () => {
    expect(commandLineIsKROHNRuntime('vim /home/user/krohn-notes.txt')).toBe(false)
    expect(commandLineIsKROHNRuntime('/opt/krohnbrew/bin/tool --run')).toBe(false)
    expect(commandLineIsKROHNRuntime('node /srv/krohn-dashboard/server.js')).toBe(false)
    expect(commandLineIsKROHNRuntime('cat ~/.krohn/config.yaml')).toBe(false)
  })

  // G2 (#150283): the real unmanaged-gateway launch is `python -m krohn_cli.main … gateway
  // run`, which the executable-basename-only matcher REJECTED — so findRunningGatewayProfiles
  // missed a live gateway at first launch / profile repair. Mirror the canonical Python matcher
  // (gateway.status.looks_like_gateway_command_line): recognize the module entry point, by argv
  // TOKENS not a substring, carrying the gateway subcommand.
  it('matches a module-launched gateway (python -m krohn_cli.main … gateway run)', () => {
    expect(commandLineIsKROHNRuntime('python\0-m\0krohn_cli.main\0-p\0x\0gateway\0run')).toBe(true)
    expect(commandLineIsKROHNRuntime('python -m krohn_cli.main -p x gateway run')).toBe(true)
    expect(commandLineIsKROHNRuntime('/venv/bin/python /venv/lib/krohn_cli/main.py gateway run')).toBe(true)
    expect(commandLineIsKROHNRuntime('python -m krohn_cli.main --profile work gateway run')).toBe(true)
  })

  it('does NOT match a module entry without the gateway subcommand, nor an unrelated krohn-tool path', () => {
    // A krohn_cli.main invocation that is not a gateway (e.g. `chat`) is not a running gateway.
    expect(commandLineIsKROHNRuntime('python -m krohn_cli.main chat')).toBe(false)
    // HX003: no substring; an unrelated tool whose path contains "krohn" is never a runtime.
    expect(commandLineIsKROHNRuntime('/opt/krohn-tool/foo gateway run')).toBe(false)
    // `-p gateway` is a profile value, not a subcommand.
    expect(commandLineIsKROHNRuntime('python -m krohn_cli.main -p gateway chat')).toBe(false)
  })
})
