import type { Usage } from '@krohn/shared/gateway-events'

export { usageFromTick } from '@krohn/shared/usage-tick'

export const ZERO: Usage = { calls: 0, input: 0, output: 0, total: 0 }
