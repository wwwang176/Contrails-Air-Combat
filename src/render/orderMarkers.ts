import {
  BufferAttribute, BufferGeometry, DynamicDrawUsage, Group, LineBasicMaterial,
  LineSegments, Mesh, MeshBasicMaterial, Object3D, SphereGeometry,
} from 'three'
import type { Team } from '../world/World'

/**
 * 指揮官集合點的可視化。**觀測工具，不進任何遊戲邏輯。**
 *
 * 一個分隊握著 `rally` 命令時，在 `order.point` 畫一顆半徑等於
 * `order.radius` 的線框球，並從該分隊長機拉一條線到球心。
 *
 * 【為什麼要有這個東西】集合令的到達判定是「長機進到 `radius` 以內」，而
 * `rallyAim` 是對固定點的**純追擊、沒有抵達行為** —— 迴轉半徑大於
 * `radius` 時，長機會在球外面繞著它盤旋而永遠判不到達。那個畫面在無頭
 * 模擬裡難以重現（見 2026-08-13 的紀錄 §3.1），但在遊戲裡一眼就看得出來：
 * **球就在那裡，長機繞著它但碰不到。**
 *
 * 【半徑不寫死】直接吃 `order.radius`，所以 `arriveRadius` 改值時這個球
 * 自動跟著改。一個寫死的 300 會在下次調參後靜靜地說謊。
 *
 * 【為什麼線框球而不是半透明實心球】實心球會擋住球裡面的飛機，而「長機
 * 有沒有進到球裡」正是要看的那件事。
 *
 * 熱路徑：`begin` / `add` / `end` 都不配置。
 */
export interface OrderMarkers {
  readonly object: Object3D
  /** 這一幀的開始。之後用 `add` 逐筆填，最後 `end` 收尾 */
  begin(): void
  /**
   * 加一個集合點。
   *
   * @param team   決定顏色
   * @param px,py,pz  球心（世界座標）
   * @param radius 球半徑，m
   * @param lx,ly,lz  長機位置；線由這裡拉到球心
   */
  add(
    team: Team, px: number, py: number, pz: number, radius: number,
    lx: number, ly: number, lz: number,
  ): void
  /** 收尾：多餘的槽位藏起來、線的頂點推上 GPU */
  end(): void
  setVisible(v: boolean): void
  dispose(): void
}

/** 同時能顯示幾個集合點。20v20 是十個分隊，取兩倍當餘裕 */
const CAPACITY = 20
/** 球的經緯分段。夠圓就好 —— 它是量具不是景物 */
const SEGMENTS_W = 24
const SEGMENTS_H = 16
const COLOR_BLUE = 0x5aa8ff
const COLOR_RED = 0xff6b5a
/**
 * 線框的不透明度。
 *
 * 【為什麼不是 1】球有 300 m 大，實心的線框在近距離會糊成一片白牆，
 * 反而看不到裡面的飛機。
 */
const OPACITY = 0.35
const LINE_OPACITY = 0.5

export function createOrderMarkers(): OrderMarkers {
  const group = new Group()
  // 【`frustumCulled = false`】球心可能在鏡頭後面而球面在鏡頭裡；three 的
  // 剔除用的是包圍球中心，這個尺度下會整顆被剔掉。與 `vortex.ts` 同一個
  // 理由（那裡是掃掠管的包圍盒每幀在動）。
  group.frustumCulled = false

  // 【單位球共用一份幾何】縮放由每個 Mesh 的 `scale` 決定，所以
  // `radius` 改值不必重建幾何
  const sphere = new SphereGeometry(1, SEGMENTS_W, SEGMENTS_H)
  const mats: Record<Team, MeshBasicMaterial> = {
    blue: new MeshBasicMaterial({
      color: COLOR_BLUE, wireframe: true, transparent: true, opacity: OPACITY,
      // 【不寫深度】否則球面會把它後面的飛機切掉一塊，而那正是要看的東西
      depthWrite: false, fog: false,
    }),
    red: new MeshBasicMaterial({
      color: COLOR_RED, wireframe: true, transparent: true, opacity: OPACITY,
      depthWrite: false, fog: false,
    }),
  }

  const meshes: Mesh[] = []
  for (let i = 0; i < CAPACITY; i++) {
    const m = new Mesh(sphere, mats.blue)
    m.frustumCulled = false
    m.visible = false
    group.add(m)
    meshes.push(m)
  }

  // 【線用單一 LineSegments + drawRange】每條線兩個頂點，畫幾條由
  // `setDrawRange` 決定，不必增刪物件
  const linePos = new Float32Array(CAPACITY * 2 * 3)
  const lineColor = new Float32Array(CAPACITY * 2 * 3)
  const lineGeo = new BufferGeometry()
  const posAttr = new BufferAttribute(linePos, 3)
  const colorAttr = new BufferAttribute(lineColor, 3)
  posAttr.setUsage(DynamicDrawUsage)
  colorAttr.setUsage(DynamicDrawUsage)
  lineGeo.setAttribute('position', posAttr)
  lineGeo.setAttribute('color', colorAttr)
  const lineMat = new LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: LINE_OPACITY,
    depthWrite: false, fog: false,
  })
  const lines = new LineSegments(lineGeo, lineMat)
  lines.frustumCulled = false
  group.add(lines)

  let used = 0

  return {
    object: group,
    begin(): void {
      used = 0
    },
    add(team, px, py, pz, radius, lx, ly, lz): void {
      if (used >= CAPACITY) return
      const m = meshes[used]!
      m.visible = true
      m.material = mats[team]
      m.position.set(px, py, pz)
      m.scale.setScalar(radius)

      const o = used * 6
      linePos[o] = lx; linePos[o + 1] = ly; linePos[o + 2] = lz
      linePos[o + 3] = px; linePos[o + 4] = py; linePos[o + 5] = pz
      const c = team === 'blue' ? COLOR_BLUE : COLOR_RED
      const r = ((c >> 16) & 255) / 255
      const g = ((c >> 8) & 255) / 255
      const bl = (c & 255) / 255
      for (let k = 0; k < 2; k++) {
        lineColor[o + k * 3] = r
        lineColor[o + k * 3 + 1] = g
        lineColor[o + k * 3 + 2] = bl
      }
      used++
    },
    end(): void {
      for (let i = used; i < CAPACITY; i++) meshes[i]!.visible = false
      lineGeo.setDrawRange(0, used * 2)
      posAttr.needsUpdate = true
      colorAttr.needsUpdate = true
    },
    setVisible(v: boolean): void {
      group.visible = v
    },
    dispose(): void {
      sphere.dispose()
      mats.blue.dispose()
      mats.red.dispose()
      lineGeo.dispose()
      lineMat.dispose()
    },
  }
}
