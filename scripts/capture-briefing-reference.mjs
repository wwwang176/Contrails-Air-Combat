/** Capture the actual game scene and opening deployment, without production hooks.
 * Start Vite first, then: node scripts/capture-briefing-reference.mjs allies-m1
 * A Playwright response patch exposes runtime state only in this browser session.
 * Outputs go to ignored .shots/briefing-reference/<mission>/.
 */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const mission = process.argv[2] ?? 'allies-m1'
const campaign = mission.split('-')[0]
const destination = resolve('.shots/briefing-reference', mission)
const url = process.env.BRIEFING_URL ?? 'http://127.0.0.1:5199/'
await mkdir(destination, { recursive: true })
const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, hasTouch: true })
page.setDefaultTimeout(120000)
page.on('pageerror', e => console.error('Browser:', e.message))
const injection = `
window.__briefingReference = {
  ready: false,
  arm() {
    const poll = () => {
      if (screen !== 'battle' || loadingBattle) { requestAnimationFrame(poll); return; }
      setPausedState(true);
      this.ready = true;
    };
    requestAnimationFrame(poll);
  },
  read() {
    return {
      mission: pendingMission.id, terrain: terrainKind, time: world.time,
      target: battle.mission.hasTarget ? { position: battle.mission.target.toArray(), radius: battle.mission.targetRadius } : null,
      aircraft: world.combatants.filter(c => c.alive).map(c => ({
        index: c.index, aircraft: c.aircraft.spec.id, team: c.team,
        player: c === player, protected: !!battle.board.protectedMask[c.index],
        position: c.aircraft.state.position.toArray(), velocity: c.aircraft.state.velocity.toArray(),
        orientation: c.aircraft.state.orientation.toArray(),
      })),
      ground: window.__ground(), ships: window.__ships().map((s, i) => ({ ...s, team: world.ships[i].team })),
    };
  },
  async overhead(bounds) {
    const { OrthographicCamera } = await import('/node_modules/.vite/deps/three.js');
    const centerX = (bounds.west + bounds.east) / 2;
    const centerZ = (bounds.north + bounds.south) / 2;
    window.__still(0, -90, 20000, elapsed, centerX, centerZ, 60);
    const camera = new OrthographicCamera(
      -(bounds.south - bounds.north)/2, (bounds.south - bounds.north)/2,
      (bounds.east - bounds.west)/2, -(bounds.east - bounds.west)/2, 1, 40000);
    camera.position.set(centerX, 20000, centerZ);
    // Rotate the horizontal chart so the escort's -Z course runs left to right.
    camera.up.set(-1, 0, 0);
    camera.lookAt(centerX, 0, centerZ);
    camera.updateMatrixWorld(true);
    ctx.camera = camera;
    // Remove only atmospheric occlusion and HUD from the reference, not terrain.
    ctx.scene.fog = null;
    window.__gfx({ clouds: false, particles: false, battleProps: false, rain: false });
    ctx.renderer.setPixelRatio(1);
    ctx.renderer.domElement.dataset.referenceCanvas = 'true';
    for (const child of document.body.children) {
      if (child !== ctx.renderer.domElement && !child.contains(ctx.renderer.domElement)) child.style.visibility = 'hidden';
    }
    ctx.renderer.render(ctx.scene, ctx.camera);
    return this.read();
  },
};`

try {
  await page.addInitScript(() => {
    localStorage.setItem('gfx.pixelRatio', '0.5')
    localStorage.setItem('gfx.antialias', '0')
  })
  // Asset authoring can continue while capturing; prevent Vite hot reloads
  // from replacing a paused simulation or its browser-only inspection hooks.
  await page.route('**/@vite/client', route => route.fulfill({ contentType: 'application/javascript', body: '' }))
  await page.route('**/src/main.ts*', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, body: (await response.text()) + injection })
  })
  console.log('Loading actual game...')
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__briefingReference !== undefined)
  console.log('Game ready; selecting', mission)
  await page.locator('[data-act="start"]').click()
  await page.locator('[data-act="mission"]').click()
  await page.locator(`[data-campaign="${campaign}"]`).click()
  await page.locator(`[data-mission="${mission}"]`).click()
  await page.evaluate(() => window.__briefingReference.arm())
  await page.locator('#brief-go').click()
  console.log('Mission launched; waiting for opening frame...')
  await page.waitForFunction(() => window.__briefingReference.ready)
  const snapshot = await page.evaluate(() => window.__briefingReference.read())
  console.log('Opening state:', snapshot.time, 'seconds;', snapshot.aircraft.length, 'aircraft')
  const points = snapshot.aircraft.map(a => a.position)
  if (snapshot.target) points.push(snapshot.target.position)
  for (const g of snapshot.ground) if (g.alive && !g.dormant) points.push([g.x, g.y, g.z])
  for (const ship of snapshot.ships) if (ship.alive) points.push([ship.x, 0, ship.z])
  const west = Math.min(...points.map(p => p[0])) - 1500
  const east = Math.max(...points.map(p => p[0])) + 1500
  const north = Math.min(...points.map(p => p[2])) - 1500
  const south = Math.max(...points.map(p => p[2])) + 1500
  const cx = (west + east) / 2, cz = (north + south) / 2
  const width = Math.max(south - north, (east - west) * 1.5)
  const bounds = { west: cx - width / 3, east: cx + width / 3, north: cz - width / 2, south: cz + width / 2 }
  await page.evaluate(bounds => window.__briefingReference.overhead(bounds), bounds)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.locator('[data-reference-canvas]').screenshot({ path: resolve(destination, 'terrain.png'), timeout: 120000 })
  await writeFile(resolve(destination, 'deployment.json'), JSON.stringify({ ...snapshot, bounds, projection: 'orthographic', image: { width: 1200, height: 800 }, imageRight: '-Z', imageUp: '-X', occlusionRemoved: ['clouds', 'fog', 'HUD', 'effects'] }, null, 2))
  console.log('Saved reference to', destination)
} finally {
  await browser.close()
}
