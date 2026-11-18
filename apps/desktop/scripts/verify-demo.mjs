import { chromium } from '@playwright/test'
const CHROME = 'C:/Users/DAMSRIS NIBAL/AppData/Local/krohn/tools/chromium-1248/chrome-win64/chrome.exe'
const browser = await chromium.launch({ executablePath: CHROME, args: ['--allow-file-access-from-files'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
await page.goto('file:///C:/Users/DAMSRIS%20NIBAL/Downloads/KROHN/landing/demo.html', { waitUntil: 'networkidle' })
for (const t of [12, 23, 30, 40]) {
  await page.evaluate(t => window.seek(t), t)
  await page.screenshot({ path: `C:/Users/DAMSRIS NIBAL/AppData/Local/Temp/opencode/demo-frame-${t}.png` })
}
await browser.close()
console.log('frames written')
