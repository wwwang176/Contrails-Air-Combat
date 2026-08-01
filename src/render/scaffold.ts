import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type PerspectiveCamera,
} from 'three'

/**
 * 臨時視覺鷹架 —— 只為了讓人能在瀏覽器裡感受到飛行。
 *
 * Task 21 會用程序化機體幾何取代 `createPlaceholderAircraft`，
 * Task 23 會用完整 HUD 取代 `createScaffoldHud`。
 * 這個檔案屆時整個刪除，不要在它上面長出任何邏輯。
 */

/** 機體佔位物：機首朝 −Z，翼展沿 X，垂直尾翼在 +Z。三色以便一眼看出姿態。 */
export function createPlaceholderAircraft(): Group {
  const g = new Group()

  const fuselage = new Mesh(
    new BoxGeometry(1.2, 1.4, 9),
    new MeshStandardMaterial({ color: 0x9aa7b4, roughness: 0.7 }),
  )
  g.add(fuselage)

  // 機翼：左右不同色，滾轉方向才看得出來
  const wingGeo = new BoxGeometry(5.4, 0.35, 2.0)
  const left = new Mesh(wingGeo, new MeshStandardMaterial({ color: 0xd05a4a, roughness: 0.8 }))
  left.position.set(-3.0, 0, 0)
  g.add(left)
  const right = new Mesh(wingGeo, new MeshStandardMaterial({ color: 0x4a86d0, roughness: 0.8 }))
  right.position.set(3.0, 0, 0)
  g.add(right)

  // 垂直尾翼在機尾（+Z），偏航看得出來
  const fin = new Mesh(
    new BoxGeometry(0.25, 2.0, 1.6),
    new MeshStandardMaterial({ color: 0xe8e2d0, roughness: 0.8 }),
  )
  fin.position.set(0, 1.2, 4.0)
  g.add(fin)

  // 水平尾翼
  const stab = new Mesh(
    new BoxGeometry(3.2, 0.25, 1.0),
    new MeshStandardMaterial({ color: 0xe8e2d0, roughness: 0.8 }),
  )
  stab.position.set(0, 0.2, 4.0)
  g.add(stab)

  return g
}

export interface ScaffoldHudFrame {
  /** 玩家指著的世界方向（單位向量） */
  aimWorld: Vector3
  /** 機首世界方向（單位向量） */
  noseWorld: Vector3
  /** 機體姿態，用來畫坡度刻度 */
  orientation: Quaternion
  altitude: number
  /** 真空速 m/s */
  tas: number
  loadFactor: number
  alphaDeg: number
  /** 單位剩餘功率 m/s */
  ps: number
  throttle: number
  specName: string
}

export interface ScaffoldHud {
  render(f: ScaffoldHudFrame, camera: PerspectiveCamera): void
  dispose(): void
}

/**
 * 臨時 HUD：雙準星（滑鼠圓圈 / 機體十字）＋ 幾個文字讀數。
 * 用獨立的 2D canvas 疊在 WebGL canvas 上。
 */
export function createScaffoldHud(): ScaffoldHud {
  const hud = document.createElement('canvas')
  hud.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:5'
  document.body.appendChild(hud)
  const g = hud.getContext('2d')!

  const probe = new Vector3()
  const bodyUp = new Vector3()
  const camRight = new Vector3()
  const camUp = new Vector3()

  function resize() {
    const dpr = Math.min(window.devicePixelRatio, 2)
    hud.width = Math.floor(window.innerWidth * dpr)
    hud.height = Math.floor(window.innerHeight * dpr)
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
  resize()
  window.addEventListener('resize', resize)

  /** 世界方向 → 螢幕像素座標。回傳 null 表示在相機背後。 */
  function project(dir: Vector3, camera: PerspectiveCamera): { x: number; y: number } | null {
    probe.copy(dir).multiplyScalar(2000).add(camera.position).project(camera)
    if (probe.z > 1) return null
    return {
      x: (probe.x * 0.5 + 0.5) * window.innerWidth,
      y: (-probe.y * 0.5 + 0.5) * window.innerHeight,
    }
  }

  return {
    render(f, camera) {
      const W = window.innerWidth
      const H = window.innerHeight
      g.clearRect(0, 0, W, H)

      // 機體十字（機槍指向）
      const nose = project(f.noseWorld, camera)
      if (nose) {
        g.strokeStyle = '#e8e2d0'
        g.lineWidth = 2
        g.beginPath()
        g.moveTo(nose.x - 14, nose.y)
        g.lineTo(nose.x - 5, nose.y)
        g.moveTo(nose.x + 5, nose.y)
        g.lineTo(nose.x + 14, nose.y)
        g.moveTo(nose.x, nose.y - 14)
        g.lineTo(nose.x, nose.y - 5)
        g.moveTo(nose.x, nose.y + 5)
        g.lineTo(nose.x, nose.y + 14)
        g.stroke()
      }

      // 滑鼠圓圈（玩家指的方向）＋ 連線
      const aim = project(f.aimWorld, camera)
      if (aim) {
        g.strokeStyle = '#5ad07a'
        g.lineWidth = 2
        g.beginPath()
        g.arc(aim.x, aim.y, 11, 0, Math.PI * 2)
        g.stroke()
        if (nose) {
          g.strokeStyle = 'rgba(90,208,122,0.35)'
          g.lineWidth = 1
          g.beginPath()
          g.moveTo(nose.x, nose.y)
          g.lineTo(aim.x, aim.y)
          g.stroke()
        }
      }

      // 坡度指示：把機體「上」方向投影到螢幕，畫一條短線
      bodyUp.set(0, 1, 0).applyQuaternion(f.orientation)
      camRight.set(1, 0, 0).applyQuaternion(camera.quaternion)
      camUp.set(0, 1, 0).applyQuaternion(camera.quaternion)
      const cx = W / 2
      const cy = H - 70
      const bank = Math.atan2(bodyUp.dot(camRight), bodyUp.dot(camUp))
      g.strokeStyle = '#e8e2d0'
      g.lineWidth = 2
      g.beginPath()
      g.arc(cx, cy, 40, 0, Math.PI * 2)
      g.stroke()
      g.strokeStyle = '#5ad07a'
      g.lineWidth = 3
      g.beginPath()
      g.moveTo(cx - Math.cos(bank) * 34, cy - Math.sin(bank) * 34)
      g.lineTo(cx + Math.cos(bank) * 34, cy + Math.sin(bank) * 34)
      g.stroke()

      // 文字讀數
      g.fillStyle = '#e8e2d0'
      g.font = '14px ui-monospace, monospace'
      const lines = [
        `${f.specName}`,
        `IAS  ${(f.tas * 3.6).toFixed(0)} km/h`,
        `ALT  ${f.altitude.toFixed(0)} m`,
        `G    ${f.loadFactor.toFixed(2)}`,
        `AoA  ${f.alphaDeg.toFixed(1)}°`,
        `Ps   ${f.ps.toFixed(1)} m/s`,
        `THR  ${(f.throttle * 100).toFixed(0)}%`,
        `BANK ${(bank * 180 / Math.PI).toFixed(0)}°`,
      ]
      lines.forEach((t, i) => g.fillText(t, 18, 28 + i * 19))

      g.fillStyle = 'rgba(232,226,208,0.55)'
      g.fillText('W/S 油門   V 視角   C 換機   R 重置   F3 效能', 18, H - 20)
    },
    dispose() {
      window.removeEventListener('resize', resize)
      hud.remove()
    },
  }
}
