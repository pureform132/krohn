import { vi } from 'vitest'

import type { KROHNApiRequest } from '@/global'

/** Install a fake `window.krohnDesktop.api`, the preload bridge every REST helper sends through. */
export function installRestBridge(answer: (request: KROHNApiRequest) => object) {
  const api = vi.fn(async (request: KROHNApiRequest) => answer(request))

  Object.defineProperty(window, 'krohnDesktop', { configurable: true, value: { api } })

  return api
}
