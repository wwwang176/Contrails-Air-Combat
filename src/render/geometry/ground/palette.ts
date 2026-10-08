/** 地面模型共用配色與 GLB 材質名的約定；不依賴載入器或幾何生成。 */


/**
 * 配色。**同一族用同一個色鍵**，改一次全部跟著改。GLB 那幾台照材質名對到
 * 這裡（本檔的 `GLB_MATERIALS`），火車直接用。
 */
export const HUE = {
  /** 蘇軍 4BO 保護綠（T-34、卡車）。 */
  armyGreen: 0x4d5a37,
  /** 德軍 Dunkelgelb（Flak 砲位）。 */
  sandYellow: 0x8f7d51,
  /** 鋼鐵：砲管、軌道、車架。 */
  steel: 0x4a4f55,
  steelDark: 0x33383d,
  /** 蒸汽機車的黑。純黑在暗場景裡是一團看不見的洞，所以是很深的藍灰。 */
  locoBlack: 0x24282c,
  /** 橡膠：輪胎、履帶。 */
  rubber: 0x1f2226,
  /** 帆布篷、遮蔽物。 */
  canvas: 0x7d7357,
  /** 木材：貨車地板、枕木。 */
  wood: 0x6b5537,
  /** 玻璃：駕駛室窗。單一顏色，不做透明 —— 一個 draw call 的代價。 */
  glass: 0x2c3a44,
  /** 標記紅：軌道車輛的底架、緩衝器。 */
  markRed: 0x7a2f26,
  /**
   * 冬季白漆。帶一點灰：純白在平面著色下與雪地融成一片，車身的稜線都看不出來。
   * **起始值，由試玩裁定。**
   */
  winterWhite: 0xb4b4ac,
} as const


/**
 * 由 GLB 載入的地面單位。
 *
 * 【GLB 只帶幾何，顏色是遊戲的】GLB 的材質只有名字算數：載入時照名字查
 * `GLB_MATERIALS` 貼成頂點色，然後**整台併成一顆幾何** —— 與 `parts.ts` 的
 * `assemble` 同一個產物（不共用頂點、頂點色、一個 draw call），所以展示區與
 * 護欄測試不必分辨一台是 GLB 來的還是盒子疊的。
 *
 * 【名字對不上就丟】GLB 裡多了一個材質、或表裡多了一個沒人用的名字，都是
 * manifest 過期 —— 靜靜地塗成預設色比丟例外難抓得多。與 `geometry/glb.ts`
 * 的機種同一條紀律。
 *
 * 【為什麼載入是非同步、取用是同步】`GLTFLoader.parse` 走 Promise；而展示區與
 * 測試要的是「給我這台的幾何」。做法與飛機、船相同：開場 `await` 一次
 * `preloadGroundGlbs`，之後 `groundGlb` 同步從快取拿。
 */

/**
 * 廠區的髒舊色盤，五色 × 四明度階。
 *
 * 【為什麼是一組而不是一個】整片廠區同一個灰，從投彈高度看下去是一張印出來
 * 的紙。階要夠粗 —— 連續的抖動在平面著色下看起來是雜訊。
 */
const PLANT_PALETTE = [0x6e5a4a, 0x3c3a37, 0x6b6d68, 0x554a3c, 0x8a5a3c]

const PLANT_SHADES = [0.90, 0.97, 1.04, 1.10]


function plantShades(): Record<string, number> {
  const out: Record<string, number> = {}
  for (let i = 0; i < PLANT_PALETTE.length; i++) {
    for (let j = 0; j < PLANT_SHADES.length; j++) {
      const base = PLANT_PALETTE[i]!
      const f = PLANT_SHADES[j]!
      const r = Math.min(255, Math.round(((base >> 16) & 0xff) * f))
      const g = Math.min(255, Math.round(((base >> 8) & 0xff) * f))
      const b = Math.min(255, Math.round((base & 0xff) * f))
      out[`LP_Plant_${i}${j}`] = (r << 16) | (g << 8) | b
    }
  }
  return out
}


/** GLB 材質名 → 遊戲顏色。**名字與各地面單位 GLB 的材質名一致，GLB 換了要跟著對。** */
export const GLB_MATERIALS: Readonly<Record<string, number>> = {
  LP_ArmorGreen: HUE.armyGreen,
  LP_Track: HUE.rubber,
  LP_Steel: HUE.steel,
  LP_TruckGreen: HUE.armyGreen,
  LP_Canvas: HUE.canvas,
  LP_Tire: HUE.rubber,
  LP_Glass: HUE.glass,
  LP_GunGrey: HUE.sandYellow,
}

/**
 * 冬季塗裝：只換烤漆，**鋼、履帶、輪胎、玻璃、帆布不刷**。表裡沒有的材質照 `GLB_MATERIALS`。
 * 純頂點色，不用貼圖（`liveryGeometry`）。
 */
export const WINTER_PAINT: Readonly<Record<string, number>> = {
  LP_ArmorGreen: HUE.winterWhite,
  LP_TruckGreen: HUE.winterWhite,
  LP_GunGrey: HUE.winterWhite,
}


/**
 * 洛伊納廠區的材質名 → 顏色。**名字與 `leuna_plant.glb` 的材質名一致，GLB 換了要跟著對。**
 *
 * 【為什麼與載具的表分開】`ground-units` 那條護欄守的是「載具的 manifest 沒
 * 過期」：表裡不得有沒人用的名字。廠區的三十一個名字混進去，那條就永遠是紅的
 * —— 而它守的東西與廠區無關。
 */
export const PLANT_MATERIALS: Readonly<Record<string, number>> = {
  ...plantShades(),
  LP_PlantBrick: 0x6b4a3c,
  LP_PlantSteel: 0x33383d,
  LP_PlantGlass: HUE.glass,
  LP_PlantCoal: 0x2b2723,
  LP_PlantEarth: 0x6b5f4e,
  LP_PlantWall: 0x9a9488,
  LP_PlantSand: 0x8a7a58,
  LP_PlantPole: 0x5a4a38,
  LP_PlantRail: HUE.steel,
  LP_PlantPlatform: 0x7d7a72,
  LP_PlantSlab: 0x868279,
  LP_PlantStain: 0x33302c,
}
