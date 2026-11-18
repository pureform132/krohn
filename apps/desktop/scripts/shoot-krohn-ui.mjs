import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const out = 'C:/Users/DAMSRIS NIBAL/AppData/Local/Temp/opencode/shots'
fs.mkdirSync(out, { recursive: true })

const proxy = process.env.HTTPS_PROXY || process.env.https_proxy
const browser = await chromium.launch({
  executablePath: 'C:/Users/DAMSRIS NIBAL/AppData/Local/krohn/tools/chromium-1248/chrome-win64/chrome.exe',
  args: proxy ? [`--proxy-server=${proxy}`] : []
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, locale: 'es-ES' })
const routes = [
  ['', 'home'],
  ['sessions', 'sessions'],
  ['models', 'models'],
  ['skills', 'skills'],
  ['plugins', 'plugins'],
  ['cron', 'cron'],
  ['settings', 'settings'],
  ['agents', 'agents'],
  ['system', 'system']
]
for (const [route, name] of routes) {
  try {
    await page.goto('http://127.0.0.1:4173/' + route, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${out}/${name}.png` })
    console.log('shot', name)
  } catch (err) {
    console.log('fail', name, String(err).split('\n')[0])
    try { await page.screenshot({ path: `${out}/${name}.png` }) } catch {}
  }
}
await browser.close()
