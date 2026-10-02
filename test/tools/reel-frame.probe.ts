/**
 * 分鏡構圖探針：印出某一段在某幾秒時，每一架飛機在畫面上的位置（NDC）與距離。
 * 用法：npx vite-node test/tools/reel-frame.probe.ts -- <段名> <秒> [<秒> ...]
 *
 * 主選單會把主角往右推（`subjectX`），這裡印的是推之前的 NDC；x < −0.2 大約就落在
 * 左邊的選單後面。
 */
import { PerspectiveCamera, Vector3 } from 'three'
import { createReelCamera, reelShots } from '../../src/app/reelShots'

const args = process.argv.slice(2).filter((a) => a !== '--')
const id = args[0] ?? 'stream'
const times = args.slice(1).map(Number)
const shot = reelShots().find((s) => s.id === id)
if (shot === undefined) throw new Error(`沒有這一段：${id}`)
const cam = createReelCamera()
const c = new PerspectiveCamera(50, 16 / 9, 1, 1e5)
const p = new Vector3()
for (const t of times) {
  shot.camera(t, cam)
  c.fov = cam.fov
  c.updateProjectionMatrix()
  c.position.copy(cam.position)
  // 跟著機身滾轉的鏡頭（肩後、掛在機上的），上方不是世界上方
  c.up.copy(cam.up)
  c.lookAt(cam.target)
  c.updateMatrixWorld()
  console.log(`t=${t}`)
  shot.planes.forEach((pl, i) => {
    pl.path(t, p)
    const d = p.distanceTo(c.position)
    p.project(c)
    console.log(`  #${i} ${pl.spec.id.padEnd(8)} x ${p.x.toFixed(2).padStart(6)} y ${p.y.toFixed(2).padStart(6)}  ${d.toFixed(0)} m`)
  })
}
