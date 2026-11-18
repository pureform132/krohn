/**
 * @krohn belongs to the default bot only while its source has no real
 * (pre-reservation) `krohn` profile. With one, the roster shows exactly one
 * @krohn — the real profile — and the default answers to @default, so a
 * typed @krohn reaches the same profile the backend's message_agent does.
 */

import { describe, expect, it, vi } from 'vitest'

import { botHandle, botMentionTag, claimDefaultHandles, mergeMultiSourceRoster, resolveRosterMentions } from './data'
import { previewKind } from './row-helpers'
import type { RosterRow } from './types'

vi.mock('@krohn/plugin-sdk', async () => {
  const { atom } = await import('nanostores')

  return { atom, host: {}, queryClient: undefined, useQuery: vi.fn(), useValue: vi.fn() }
})

vi.mock('./shared', () => ({ getPluginCtx: () => null, ID: 'krohn-bots' }))

function roster(names: string[]): RosterRow[] {
  const local = { profiles: names.map(name => ({ name })) }

  // What Electron's buildAgentRoster reports for a single local source: bare-name handles.
  const union = {
    agents: names.map(profile => ({
      connectionId: 'local',
      connectionKind: 'local' as const,
      connectionLabel: 'This device',
      handle: profile,
      profile,
      targetProfile: profile
    })),
    primaryConnectionId: 'local'
  }

  return mergeMultiSourceRoster(local, union, 'local').profiles as RosterRow[]
}

describe('the @krohn handle', () => {
  it.each([
    [['default', 'researcher'], 'default'],
    [['default', 'krohn', 'researcher'], 'krohn']
  ])('roster %j shows one @krohn and a typed @krohn reaches %s', (names, owner) => {
    const rows = roster(names)
    const handles = rows.map(row => botHandle(row.name, row))

    expect(handles.filter(handle => handle === 'krohn')).toHaveLength(1)
    expect(rows.map(row => botMentionTag(row)).filter(tag => tag === 'krohn')).toHaveLength(1)
    expect(resolveRosterMentions('@krohn ping', rows, { name: 'researcher' }).map(row => row.name)).toEqual([owner])
  })

  it('names the default @default once a real krohn profile holds the handle', () => {
    const rows = roster(['default', 'krohn', 'researcher'])
    const byName = Object.fromEntries(rows.map(row => [row.name, botHandle(row.name, row)]))

    expect(byName).toEqual({ default: 'default', krohn: 'krohn', researcher: 'researcher' })
    expect(resolveRosterMentions('@default ping', rows, { name: 'researcher' }).map(row => row.name)).toEqual(['default'])
  })

  it('keeps each source separate: a remote krohn profile does not rename the local default', () => {
    const rows = claimDefaultHandles<Partial<RosterRow>>([
      { connectionId: 'local', name: 'default' },
      { connectionId: 'mini', name: 'default' },
      { connectionId: 'mini', name: 'krohn' }
    ])

    expect(rows.map(row => botHandle(String(row.name), row))).toEqual(['krohn', 'default', 'krohn'])
  })

  it("never lets a source's stale 'krohn' handle on its default answer @krohn", () => {
    // An older backend labels its default @krohn even beside a real krohn profile.
    const rows = claimDefaultHandles<RosterRow>([
      { connectionId: 'mini', handle: 'krohn', name: 'default', remoteSource: true },
      { connectionId: 'mini', handle: 'krohn', name: 'krohn', remoteSource: true },
      { connectionId: 'local', name: 'researcher' }
    ])

    expect(resolveRosterMentions('@krohn ping', rows, { name: 'researcher' }).map(row => row.name)).toEqual(['krohn'])
  })

  it('names a DM sender in a row preview by its roster handle', () => {
    const rows = claimDefaultHandles<RosterRow>(
      ['default', 'krohn', 'researcher'].map(name => ({ connectionId: 'local', name }))
    )

    const sender = (name: string, list: RosterRow[]) =>
      previewKind(`Message from 🤖 ${name} (@x): hi`, list, 'local').fromBot

    expect([sender('default', rows), sender('krohn', rows)]).toEqual(['default', 'krohn'])
    // No real krohn profile: the default is still @krohn (#89484).
    expect(sender('default', claimDefaultHandles<RosterRow>([{ connectionId: 'local', name: 'default' }]))).toBe(
      'krohn'
    )
  })
})
