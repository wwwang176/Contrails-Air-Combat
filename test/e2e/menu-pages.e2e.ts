/**
 * Menu behavior in real Chromium, without starting the game or a dev server.
 * Run: npx vite-node test/e2e/menu-pages.e2e.ts
 * Optional MENU_COMPARE_REF compares DOM and hook traces with that Git revision.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'vite'
import { chromium } from 'playwright'
import type { mount } from './menu-pages.fixture'

declare global {
  interface Window {
    MenuFixture: { mount: typeof mount }
    __menuFixture: ReturnType<typeof mount>
  }
}

async function bundle(ref?: string): Promise<string> {
  const source = ref === undefined ? undefined : execFileSync('git', ['show', `${ref}:src/ui/menu.ts`], { encoding: 'utf8' })
  let baselineLoaded = false
  const result = await build({
    configFile: false, publicDir: false, logLevel: 'error',
    plugins: source === undefined ? [] : [{
      name: 'menu-review-baseline',
      load(id) {
        if (id.replaceAll('\\', '/').endsWith('/src/ui/menu.ts')) {
          baselineLoaded = true
          return source
        }
      },
    }],
    build: { write: false, minify: false,
      lib: { entry: resolve('test/e2e/menu-pages.fixture.ts'), name: 'MenuFixture', formats: ['iife'] },
    },
  })
  assert(source === undefined || baselineLoaded, 'Baseline menu must replace the current implementation')
  if ('on' in result) throw new Error('Unexpected watch build')
  const output = (Array.isArray(result) ? result[0]! : result).output
  const script = output.find(o => o.type === 'chunk')
  assert(script?.type === 'chunk')
  return script.code
}

const html = (await readFile('index.html', 'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
const browser = await chromium.launch({ headless: true })
try {
  async function check(code: string) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))
    try {
      await page.setContent(html, { waitUntil: 'domcontentloaded' })
      await page.addScriptTag({ content: code })
      await page.evaluate(() => { window.__menuFixture = window.MenuFixture.mount() })
      const snapshots: unknown[] = []
      const capture = async () => {
        // Let the dossier bars finish their scheduled DOM writes before comparing.
        await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => { done() })))
        snapshots.push(await page.evaluate(() => ({
          html: document.querySelector('#ui')!.innerHTML,
          events: window.__menuFixture.events,
          setup: window.__menuFixture.setup,
        })))
      }
      const click = async (selector: string) => { await page.locator(selector).click() }
      const aircraftEvents = () => page.evaluate(() => window.__menuFixture.events.filter(e => e[0] === 'aircraft').length)

      assert.equal(await page.locator('[data-campaign]').count(), 3)
      await click('[data-campaign="japan"]')
      await click('[data-mission="japan-m2"]')
      const brief = await page.locator('#brief').innerHTML()
      await page.evaluate(() => window.__menuFixture.setLang('en'))
      assert.notEqual(await page.locator('#brief').innerHTML(), brief)
      assert.equal(await page.locator('#route .on').getAttribute('data-mission'), 'japan-m2')
      await capture()
      await click('#brief-go')
      assert.deepEqual(await page.evaluate(() => window.__menuFixture.events.slice(-2)), [['mission', 'japan-m2'], ['event', 'fight']])
      await page.evaluate(() => window.__menuFixture.show('campaign'))
      await click('[data-campaign="germany"]')
      await page.locator('#route button').nth(1).click()
      const remembered = await page.locator('#route .on').getAttribute('data-mission')
      await page.evaluate(() => window.__menuFixture.show('campaign'))
      await click('[data-campaign="japan"]')
      assert.equal(await page.locator('#route .on').getAttribute('data-mission'), 'japan-m2')
      await page.evaluate(() => window.__menuFixture.show('campaign'))
      await click('[data-campaign="germany"]')
      assert.equal(await page.locator('#route .on').getAttribute('data-mission'), remembered)
      await capture()

      await page.evaluate(() => window.__menuFixture.show('hangar'))
      assert.equal(await aircraftEvents(), 1)
      await page.locator('#hangar-rack button').nth(1).click()
      const selected = await page.locator('#hangar-rack .on').getAttribute('data-aircraft')
      assert.equal(await aircraftEvents(), 2)
      await click('#hangar-rack .on')
      assert.equal(await aircraftEvents(), 2)
      const dossier = await page.locator('#hangar-sheet').innerHTML()
      await page.evaluate(() => window.__menuFixture.setLang('zh'))
      assert.equal(await aircraftEvents(), 2)
      assert.equal(await page.locator('#hangar-rack .on').getAttribute('data-aircraft'), selected)
      assert.notEqual(await page.locator('#hangar-sheet').innerHTML(), dossier)
      await capture()
      await page.evaluate(() => { window.__menuFixture.show('campaign'); window.__menuFixture.show('hangar') })
      assert.equal(await aircraftEvents(), 3)

      await page.evaluate(() => window.__menuFixture.show('skirmish'))
      await click('#sk-mine .minus')
      assert.equal(await page.evaluate(() => window.__menuFixture.setup.blue[0]!.count), 3)
      await click('#sk-mine .add')
      const oldTitle = await page.locator('#plane-pick-title').textContent()
      await page.evaluate(() => window.__menuFixture.setLang('en'))
      assert.notEqual(await page.locator('#plane-pick-title').textContent(), oldTitle)
      assert.equal(await page.locator('#plane-pick').isVisible(), true)
      await capture()
      await page.locator('#plane-pick-list button').last().click()
      assert.equal(await page.locator('#plane-pick').isVisible(), false)
      assert.equal(await page.evaluate(() => window.__menuFixture.setup.blue.length), 2)
      assert.equal(await page.evaluate(() => window.__menuFixture.setup.red.length), 1)
      await page.locator('#sk-mine .pick').last().click()
      assert.equal(await page.evaluate(() => window.__menuFixture.setup.lead), 1)
      await capture()
      await click('#sk-foe .rm')
      assert.equal(await page.locator('#skirmish [data-act="fight"]').isDisabled(), true)
      await click('#sk-foe .add')
      await page.locator('#plane-pick-list button').first().click()
      assert.equal(await page.evaluate(() => window.__menuFixture.setup.red.length), 1)
      assert.equal(await page.locator('#skirmish [data-act="fight"]').isDisabled(), false)
      await capture()
      await click('#sk-foe .add')
      await click('[data-act="planePickCancel"]')
      assert.equal(await page.evaluate(() => window.__menuFixture.setup.red.length), 1)
      await page.locator('#sk-presets button').first().click()
      await capture()
      assert.deepEqual(errors, [])
      return snapshots
    } finally { await page.close() }
  }
  const current = await check(await bundle())
  const ref = process.env['MENU_COMPARE_REF']
  if (ref !== undefined) assert.deepEqual(current, await check(await bundle(ref)))
  console.log(`Menu page checks passed; ${current.length} DOM/hook snapshots${ref === undefined ? '' : ` identical to ${ref}`}.`)
} finally { await browser.close() }
