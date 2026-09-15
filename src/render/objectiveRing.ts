import {
  DoubleSide, Mesh, MeshBasicMaterial, RingGeometry,
  type Camera, type Object3D, type Vector3,
} from 'three'

/**
 * 環的線寬佔半徑的比例。【起始值，待掃描】
 *
 * 太細在 20 km 外會被抗鋸齒吃掉，太粗看起來像一個實心的盤子而不是一個門。
 */
const THICKNESS = 0.04
/** 圓周分段數。20 km 外只佔螢幕高度 8.8%，128 段已經看不出多邊形 */
const SEGMENTS = 128
/**
 * 環的顏色。與 `HUD_COLORS.primary` 同一個綠。
 *
 * 【為什麼不是紅或黃】紅是敵機、黃是自己分隊的同伴（`hud/types.ts` 的
 * `contactColor`）。撤離點是**目標**，借用那兩個顏色會讀出一個不存在的意思。
 */
const COLOR = 0x7dfba8

export interface ObjectiveRing {
  readonly object: Object3D
  /** 每幀更新：圓心、半徑、正對相機 */
  update(centre: Vector3, radius: number, camera: Camera): void
  setVisible(v: boolean): void
  dispose(): void
}

/**
 * 撤離點的 3D 圓環。
 *
 * 【為什麼是 billboard 而不是固定朝向的環面】判定是球形
 * （`playerPos.distanceTo(point) < radius`，見 `battle/mission.ts`），而
 * billboard 圓環**就是那顆球的輪廓** —— 所以「你看到的那個圈 = 判定範圍」
 * 從**任何角度**都逐字成立。固定朝向的環面從側面看是一條線，玩家會遇到
 * 「我明明穿過去了卻沒算到」，而那種 bug 沒有辦法從畫面上自我解釋
 * （任務框架 spec §6.3）。
 *
 * 【為什麼幾何以單位半徑建、用 scale 給大小】半徑是每一關的參數，而
 * `RingGeometry` 改半徑要重建整個 buffer。縮放是免費的，而且讓「縮放即
 * 半徑」成為一條測得到的性質。
 *
 * 【為什麼吃霧】20 km 處只有 7.5%（`fog.ts` 的 `FOG_DENSITY = 1.4e-5`），
 * 不影響辨識；而關掉霧會讓它在遠處比周圍的世界更清楚，看起來像貼在螢幕上
 * 的 UI 而不是天上的一個東西。
 *
 * 【生命週期】比照 `render/terrain.ts`：**每一場都重建**（`enterBattle` 拆
 * 舊的、建新的），那條路徑因此每一場都在走。
 */
export function createObjectiveRing(): ObjectiveRing {
  const geometry = new RingGeometry(1 - THICKNESS, 1, SEGMENTS)
  const material = new MeshBasicMaterial({
    color: COLOR,
    // 【雙面】billboard 理論上永遠正面朝相機，但更新與渲染之間差一個
    // 相機移動就會露出背面 —— 那一幀環會整個消失
    side: DoubleSide,
    // 【forceSinglePass】透明雙面預設分兩趟、每次繪製重算兩次 shader program。
    // 環是平的，正反面不會疊在同一個像素上，一趟畫出來的像素相同
    forceSinglePass: true,
    transparent: true,
    opacity: 0.9,
    // 【不用加法混色】加法在**亮天空**背景上會洗白（把綠推向白）——
    // 而環的背景絕大多數就是天空，因為它在
    // 4,000 m、大致水平地看過去。一般混色在亮天空與深海上都讀得出綠。
    // 【不寫深度】它是半透明的疊加物。寫深度會讓後面的飛機被一個看不見的
    // 圓盤切掉 —— 而那個圓盤的邊界正好在環的內圈上
    depthWrite: false,
  })
  const mesh = new Mesh(geometry, material)
  // 【關掉視錐剔除】包圍球是照**原始幾何**（半徑 1）算的，剔除會用一顆
  // 半徑 1 的球去判斷一個直徑 2 km 的東西 —— 症狀是環在畫面邊緣憑空消失
  mesh.frustumCulled = false

  return {
    object: mesh,
    update(centre, radius, camera) {
      mesh.position.copy(centre)
      mesh.scale.setScalar(radius)
      // `RingGeometry` 躺在 XY 平面、法線是 +Z；`lookAt` 把 +Z 轉向相機
      mesh.lookAt(camera.position)
    },
    setVisible(v) {
      mesh.visible = v
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
