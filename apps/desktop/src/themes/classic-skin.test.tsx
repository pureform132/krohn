import { contrastRatio } from '@krohn/shared/color'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { useTheme } from './context'
import { skinToDesktopTheme } from './skin'

// What the gateway and the Electron bridge report for a STOCK config
// (`display.skin: default`): the CLI's classic gold skin, by name `default`.
const stockDefaultSkin = {
  name: 'default',
  description: 'Classic KROHN — gold and kawaii',
  colors: { banner_text: '#FFF8DC', status_bar_bg: '#1a1a2e', ui_accent: '#FFBF00', banner_border: '#CD7F32' }
}

const BACKEND_THEMES_KEY = 'krohn-desktop-backend-themes-v1'

const cssVar = (name: string) => window.document.documentElement.style.getPropertyValue(name)
const paintedSkin = () => window.document.documentElement.dataset.krohnTheme

type ThemeApi = ReturnType<typeof useTheme>

/** A fresh renderer launch: module state reloads, localStorage survives. */
async function launch(localSkin: typeof stockDefaultSkin | null) {
  cleanup()
  Object.defineProperty(window, 'krohnDesktop', {
    configurable: true,
    value: localSkin ? { localSkin: { profile: 'default', skin: localSkin } } : {}
  })
  vi.resetModules()

  const [context, sync, skinCommand] = await Promise.all([
    import('./context'),
    import('./backend-sync'),
    import('./use-skin-command')
  ])

  // The pre-mount boot paint, i.e. the very first frame of the launch.
  const bootPaint = paintedSkin()
  const api: { theme: ThemeApi | null; skin: ((arg: string) => string) | null } = { skin: null, theme: null }

  function Probe() {
    api.theme = context.useTheme()
    api.skin = skinCommand.useSkinCommand()

    return null
  }

  render(
    <context.ThemeProvider>
      <Probe />
    </context.ThemeProvider>
  )

  // gateway.ready: the connect-time seed of the backend's active skin.
  const connect = () => act(() => sync.ingestBackendSkin(stockDefaultSkin, { apply: false }))

  return { api, bootPaint, connect }
}

describe('Classic KROHN is an explicit Desktop pick, never inferred from stock config (#76579)', () => {
  beforeEach(() => window.localStorage.clear())

  afterEach(() => {
    cleanup()
    window.localStorage.clear()
    Reflect.deleteProperty(window, 'krohnDesktop')
    vi.resetModules()
  })

  it.each([
    ['display.skin: default', stockDefaultSkin],
    ['display.skin unset', null]
  ])('a stock user (%s) with no Desktop pick paints KROHN Editorial on boot, connect and relaunch', async (_label, local) => {
    let run = await launch(local)
    expect(run.bootPaint).toBe('krohn')
    run.connect()
    run.connect() // reconnect re-seed
    expect(run.api.theme?.themeName).toBe('krohn')
    expect(paintedSkin()).toBe('krohn')

    run = await launch(local)
    expect(run.bootPaint).toBe('krohn')
    run.connect()
    expect(paintedSkin()).toBe('krohn')
  })

  it('a Classic pick paints gold/navy (dark mode) and survives connect, reconnect and relaunch; a later Nous pick sticks', async () => {
    let run = await launch(stockDefaultSkin)
    expect(run.api.theme?.availableThemes.find(t => t.name === 'classic')?.label).toBe('Classic KROHN')

    act(() => run.api.theme?.setMode('dark'))
    act(() => run.api.theme?.setTheme('classic'))
    expect(paintedSkin()).toBe('classic')
    expect(cssVar('--theme-background-seed')).toBe('#1a1a2e')
    expect(cssVar('--theme-primary').toLowerCase()).toBe('#ffbf00')

    run.connect()
    run.connect()
    expect(run.api.theme?.themeName).toBe('classic')

    run = await launch(stockDefaultSkin)
    expect(run.bootPaint).toBe('classic')
    run.connect()
    expect(paintedSkin()).toBe('classic')
    expect(cssVar('--theme-background-seed')).toBe('#1a1a2e')

    act(() => run.api.theme?.setTheme('nous'))
    run = await launch(stockDefaultSkin)
    run.connect()
    expect(run.bootPaint).toBe('nous')
    expect(paintedSkin()).toBe('nous')
  })

  it('/skin gold selects Classic; /skin krohn selects KROHN Editorial; /skin default stays the Desktop default (krohn)', async () => {
    const run = await launch(stockDefaultSkin)

    act(() => void run.api.skin?.('gold'))
    expect(run.api.theme?.themeName).toBe('classic')

    act(() => void run.api.skin?.('nous'))
    act(() => void run.api.skin?.('krohn'))
    expect(run.api.theme?.themeName).toBe('krohn')

    act(() => void run.api.skin?.('default'))
    expect(run.api.theme?.themeName).toBe('krohn')
  })

  it('a cache left by the reverted #130015 build (CLI `default` as "Classic KROHN") shows ONE Classic and is purged', async () => {
    // Exactly what that build wrote: the converted CLI `default` skin, relabelled.
    window.localStorage.setItem(
      BACKEND_THEMES_KEY,
      JSON.stringify({
        default: {
          ...skinToDesktopTheme(stockDefaultSkin),
          description: stockDefaultSkin.description,
          label: 'Classic KROHN'
        }
      })
    )

    const run = await launch(stockDefaultSkin)
    run.connect()

    const themes = run.api.theme?.availableThemes ?? []
    expect(themes.filter(t => t.label === 'Classic KROHN').map(t => t.name)).toEqual(['classic'])
    expect(themes.some(t => t.name === 'default')).toBe(false)
    expect(run.api.skin?.('list').match(/Classic KROHN/g)).toHaveLength(1)
    expect(JSON.parse(window.localStorage.getItem(BACKEND_THEMES_KEY) ?? '{}')).not.toHaveProperty('default')
  })

  it('Classic follows the light/dark toggle: a light surface in light mode, gold on navy in dark, both readable', async () => {
    const run = await launch(stockDefaultSkin)
    act(() => run.api.theme?.setTheme('classic'))

    act(() => run.api.theme?.setMode('light'))
    expect(window.document.documentElement.dataset.krohnMode).toBe('light')
    expect(cssVar('--theme-background-seed').toLowerCase()).toBe('#f5f5f5')
    expect(contrastRatio(cssVar('--theme-foreground'), cssVar('--theme-background-seed'))).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(cssVar('--theme-primary'), cssVar('--theme-sidebar-seed'))).toBeGreaterThanOrEqual(4.5)

    act(() => run.api.theme?.setMode('dark'))
    expect(window.document.documentElement.dataset.krohnMode).toBe('dark')
    expect(cssVar('--theme-background-seed')).toBe('#1a1a2e')
    expect(contrastRatio(cssVar('--theme-foreground'), cssVar('--theme-background-seed'))).toBeGreaterThanOrEqual(4.5)
  })
})
