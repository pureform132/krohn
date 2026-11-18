import { useCallback } from 'react'

import { useTheme } from './context'

// Old names land on a shipped theme so muscle memory works. `gold` only ever
// meant the classic gold look, so it reaches Classic KROHN; `default` lands on
// the flagship `krohn` skin, also the stock config value GitHub
// "legacy default" maps to. `krohn` resolves to the KROHN Editorial theme.
const ALIASES: Record<string, string> = {
  ares: 'ember',
  default: 'krohn',
  gold: 'classic',
  'nous-light': 'nous'
}

export function useSkinCommand() {
  const { availableThemes, setTheme, themeName } = useTheme()

  return useCallback(
    (rawArg: string) => {
      const arg = rawArg.trim()

      if (!availableThemes.length) {
        return 'No desktop themes are available.'
      }

      const activeIndex = Math.max(
        0,
        availableThemes.findIndex(t => t.name === themeName)
      )

      if (!arg || arg === 'next') {
        const next = availableThemes[(activeIndex + 1) % availableThemes.length]
        setTheme(next.name)

        return `Desktop theme switched to ${next.label}.`
      }

      if (arg === 'list' || arg === 'ls' || arg === 'status') {
        const rows = availableThemes.map(t => `${t.name === themeName ? '*' : ' '} ${t.name.padEnd(10)} ${t.label}`)

        return ['Desktop themes:', ...rows, '', 'Use /skin <name>, or /skin to cycle.'].join('\n')
      }

      const normalized = arg.toLowerCase()
      const targetName = ALIASES[normalized] || normalized

      const target = availableThemes.find(
        t => t.name.toLowerCase() === targetName || t.label.toLowerCase() === normalized
      )

      if (!target) {
        return `Unknown desktop theme: ${arg}\nAvailable: ${availableThemes.map(t => t.name).join(', ')}`
      }

      setTheme(target.name)

      return `Desktop theme switched to ${target.label}.`
    },
    [availableThemes, setTheme, themeName]
  )
}
