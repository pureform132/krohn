// KROHN demo.html -> MP4. Minimal: seek(t)-pure pages, image2pipe -> ffmpeg.
//   node render.mjs page.html out.mp4 [fps=30] [subframes=2] [workers=4]
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [, , html, out, a3 = '30', a4 = '1', a5 = '4'] = process.argv
if (!html || !out) { console.log('usage: node render.mjs page.html out.mp4 [fps] [subframes] [workers]'); process.exit(1) }

const CHROME = 'C:/Users/DAMSRIS NIBAL/AppData/Local/krohn/tools/chromium-1248/chrome-win64/chrome.exe'
const envProxy = process.env.HTTPS_PROXY || process.env.https_proxy
const args = ['--allow-file-access-from-files']
if (envProxy) args.push(`--proxy-server=${envProxy}`)
const url = pathToFileURL(path.resolve(html)).href + '?render'
const browser = await chromium.launch({ executablePath: CHROME, args })

const probe = await browser.newPage()
await probe.goto(url)
await probe.waitForFunction(() => window.VIDEO && typeof window.seek === 'function')
const V = await probe.evaluate(() => window.VIDEO)
await probe.close()

async function openPage() {
  const page = await browser.newPage({ viewport: { width: V.w, height: V.h } })
  await page.goto(url)
  await page.waitForFunction(() => window.VIDEO && typeof window.seek === 'function')
  await page.evaluate(async () => { await Promise.all([...document.fonts].map(f => f.load().catch(() => {}))); await document.fonts.ready })
  return page
}
const shot = async (page, t) => { await page.evaluate(t => window.seek(t), t); return page.screenshot({ type: 'jpeg', quality: 80 }) }

const fps = +a3, sub = Math.max(1, +a4), workers = Math.max(1, +a5), N = Math.round(V.duration * fps)
const base = out.replace(/\.mp4$/, ''), silent = base + '_silent.mp4'
const t0 = Date.now()
let done = 0
const per = Math.ceil(N / workers)
const segs = []
const vf = sub > 1 ? ['-vf', `tmix=frames=${sub},select='eq(mod(n\\,${sub})\\,${sub - 1})',setpts=N/(${fps}*TB)`] : []

console.log(`render ${V.w}x${V.h} ${V.duration}s @ ${fps}fps x${sub}sub x${workers}`)

await Promise.all(Array.from({ length: workers }, async (_, w) => {
  const a = w * per, b = Math.min(N, a + per); if (a >= b) return
  const seg = `${base}_seg${w}.mp4`; segs[w] = seg
  const page = await openPage()
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps * sub), '-i', '-', ...vf,
    '-r', String(fps), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'fast', seg], { stdio: ['pipe', 'inherit', 'inherit'] })
  const closed = new Promise(r => ff.on('close', r))
  for (let f = a; f < b; f++) {
    for (let s = 0; s < sub; s++) {
      const t = (f + (sub > 1 ? (s / sub) * 0.5 : 0)) / fps
      const buf = await shot(page, t)
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r))
    }
    if (++done % 60 === 0) process.stdout.write(`\r${done}/${N} frames  ${((Date.now() - t0) / 1000).toFixed(0)}s`)
  }
  ff.stdin.end(); await closed; await page.close()
}))
const list = base + '_segs.txt'
writeFileSync(list, segs.filter(Boolean).map(s => `file '${path.resolve(s)}'`).join('\n'))
await new Promise((res, rej) => { const p = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', silent], { stdio: 'inherit' }); p.on('close', c => c ? rej(new Error('ffmpeg ' + c)) : res()) })
segs.filter(Boolean).forEach(s => rmSync(s)); rmSync(list)
console.log(`\nvideo -> ${silent}  ${((Date.now() - t0) / 1000).toFixed(0)}s`)
await browser.close()
