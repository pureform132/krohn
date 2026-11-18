import { describe, expect, it } from 'vitest'

import { isKROHNCloudUrl } from './krohn-cloud'

describe('isKROHNCloudUrl', () => {
  it('recognises production and staging agent hosts, nothing else', () => {
    expect(isKROHNCloudUrl('https://ares-3009.agents.nousresearch.com')).toBe(true)
    expect(isKROHNCloudUrl('https://ares--app.agents.staging-nousresearch.com/')).toBe(true)
    expect(isKROHNCloudUrl('https://agents.nousresearch.com.evil.example')).toBe(false)
    expect(isKROHNCloudUrl('https://my-box.tailnet.ts.net')).toBe(false)
    expect(isKROHNCloudUrl('not a url')).toBe(false)
    expect(isKROHNCloudUrl(undefined)).toBe(false)
  })
})
