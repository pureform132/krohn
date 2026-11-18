import { describe, expect, it } from 'vitest'

import {
  normalizeKROHNOpenString,
  pathFromKROHNDeepLink,
  pathFromOpenDeepLink,
  resolveKROHNOpenPath
} from './krohn-open-target'

describe('normalizeKROHNOpenString', () => {
  it('accepts hash-router paths and strips a leading hash', () => {
    expect(normalizeKROHNOpenString('/index-network/intent/1')).toBe('/index-network/intent/1')
    expect(normalizeKROHNOpenString('#/index-network/intent/1')).toBe('/index-network/intent/1')
  })

  it('maps plugin-scoped krohn:// deep links to the same path', () => {
    expect(normalizeKROHNOpenString('krohn://index-network/intent/1')).toBe('/index-network/intent/1')
    expect(normalizeKROHNOpenString('krohn://index-network/intent/1?focus=true')).toBe(
      '/index-network/intent/1?focus=true'
    )
  })

  it('maps krohn://open/… deep links by stripping the open host', () => {
    expect(normalizeKROHNOpenString('krohn://open/index-network/intent/1')).toBe('/index-network/intent/1')
    expect(normalizeKROHNOpenString('krohn://open/settings/plugins')).toBe('/settings/plugins')
  })

  it('rejects reserved krohn kinds and unsafe paths', () => {
    expect(normalizeKROHNOpenString('krohn://blueprint/morning-brief')).toBeNull()
    expect(normalizeKROHNOpenString('krohn://plugin/install')).toBeNull()
    expect(normalizeKROHNOpenString('https://example.com/x')).toBeNull()
    expect(normalizeKROHNOpenString('/../etc/passwd')).toBeNull()
    expect(normalizeKROHNOpenString('index-network')).toBeNull()
  })
})

describe('resolveKROHNOpenPath', () => {
  it('merges structured path + params', () => {
    expect(resolveKROHNOpenPath({ path: '/index-network/intent/1', params: { focus: 'true' } })).toBe(
      '/index-network/intent/1?focus=true'
    )
  })

  it('resolves href the same as a bare string', () => {
    expect(resolveKROHNOpenPath({ href: 'krohn://index-network/intent/1' })).toBe('/index-network/intent/1')
  })
})

describe('pathFromKROHNDeepLink', () => {
  it('builds the navigate path from a plugin-scoped deep-link payload', () => {
    expect(pathFromKROHNDeepLink('index-network', 'intent/1')).toBe('/index-network/intent/1')
  })

  it('builds the navigate path from krohn://open/… payloads', () => {
    expect(pathFromOpenDeepLink('index-network/intent/1')).toBe('/index-network/intent/1')
    expect(pathFromKROHNDeepLink('open', 'agent/42')).toBe('/agent/42')
  })

  it('ignores reserved kinds', () => {
    expect(pathFromKROHNDeepLink('blueprint', 'morning-brief')).toBeNull()
    expect(pathFromKROHNDeepLink('plugin', 'install')).toBeNull()
  })
})
