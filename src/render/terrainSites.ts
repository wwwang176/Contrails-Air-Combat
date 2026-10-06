/** 各地圖的場地表面配置；由地形組裝與地表著色共用。 */
import type { SiteLayout } from './siteSurface'
import {
  PLANT_BLOCKS, PLANT_CENTER, PLANT_HEADING, PLANT_PAD, PLANT_SATELLITES,
  PLANT_TREE_CLEAR, RAIL_WIDTH, RAILS, ROAD_WIDTH, ROADS,
} from '../world/leuna'
import {
  FIELD_CENTER, FIELD_LOBES, FIELD_PAD, FIELD_TREE_CLEAR, PAD_GRASS, PAVED,
  RAIL_WIDTH as POLTAVA_RAIL_WIDTH, RAILS as POLTAVA_RAILS,
  ROAD_WIDTH as POLTAVA_ROAD_WIDTH, ROADS as POLTAVA_ROADS, RUNWAY_CONCRETE,
} from '../world/poltava'
import {
  FIELD_BUILDING_CLEAR as ASCH_BUILDING_CLEAR, FIELD_CENTER as ASCH_CENTER,
  FIELD_LOBES as ASCH_LOBES, FIELD_PAD as ASCH_PAD,
  FIELD_TREE_CLEAR as ASCH_TREE_CLEAR, PAD_GRASS as ASCH_GRASS, PAVED as ASCH_PAVED, PSP_STEEL,
  ROAD_WIDTH as ASCH_ROAD_WIDTH, ROADS as ASCH_ROADS,
} from '../world/asch'
import { BELT_FRAME, CRATER_PATCHES, MINEFIELDS, SCAR_ZONE, SCORCH, TRACKS, TRENCHES } from '../world/rzhev'
import { aschClumpFlora } from './aschScenery'
import { canopyColor, FLORA_COLORS } from './season'

/** 碴石：調車場的街廓 */
const BALLAST = 0x5f5a52

/** 裸土：留白的街廓 */
const BARE_EARTH = 0x6b5f4e

/** 牆外衛星設施的鋪面。比主廠區暗一階 —— 是附屬的、久沒整修的地 */
const OUTPOST_SLAB = 0x807d76

/**
 * 洛伊納廠區的墊面、道路與鋪面，世界座標。`fields.ts` 的著色器與植被的排除
 * 都讀它。
 *
 * 【鋪面照街廓的機能給】調車場是碴石、留白是裸土 —— 俯視時這兩塊的紋理與
 * 混凝土不同，整片廠區才不是一張均質的灰。
 */
export const LEUNA_SITE: SiteLayout = {
  pivot: { x: PLANT_CENTER.x, z: PLANT_CENTER.z },
  heading: PLANT_HEADING,
  pad: {
    x0: -PLANT_PAD.halfX, z0: -PLANT_PAD.halfZ,
    x1: PLANT_PAD.halfX, z1: PLANT_PAD.halfZ,
  },
  treeClear: PLANT_TREE_CLEAR,
  roads: ROADS,
  roadWidth: ROAD_WIDTH,
  rails: RAILS,
  railWidth: RAIL_WIDTH,
  patches: PLANT_BLOCKS
    .filter((b) => b.kind === 'railyard' || b.kind === 'open')
    .map((b) => ({
      x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1,
      hex: b.kind === 'railyard' ? BALLAST : BARE_EARTH,
    })),
  outposts: PLANT_SATELLITES.map((s) => ({
    x0: s.dx - s.w / 2, x1: s.dx + s.w / 2,
    z0: s.dz - s.d / 2, z1: s.dz + s.d / 2,
    hex: OUTPOST_SLAB,
  })),
}

/** 波爾塔瓦機場的墊面（草）、跑道／滑行道／停機位（水泥）、連外道路與鐵路 */
export const POLTAVA_SITE: SiteLayout = {
  pivot: { x: FIELD_CENTER.x, z: FIELD_CENTER.z },
  pad: FIELD_PAD,
  padLobes: FIELD_LOBES,
  padHex: PAD_GRASS,
  treeClear: FIELD_TREE_CLEAR,
  roads: POLTAVA_ROADS,
  roadWidth: POLTAVA_ROAD_WIDTH,
  rails: POLTAVA_RAILS,
  railWidth: POLTAVA_RAIL_WIDTH,
  patches: PAVED.map((r) => ({ ...r, hex: RUNWAY_CONCRETE })),
}

/** Y-29 的墊面（草，含作業區與營區）、跑道／滑行帶／停機墊（鋼板網）、連外道路 */
export const ASCH_SITE: SiteLayout = {
  pivot: { x: ASCH_CENTER.x, z: ASCH_CENTER.z },
  pad: ASCH_PAD,
  padLobes: ASCH_LOBES,
  padHex: ASCH_GRASS,
  treeClear: ASCH_TREE_CLEAR,
  buildingClear: ASCH_BUILDING_CLEAR,
  flora: aschClumpFlora,
  roads: ASCH_ROADS,
  roadWidth: ASCH_ROAD_WIDTH,
  patches: ASCH_PAVED.map((r) => ({ ...r, hex: PSP_STEEL })),
}

/**
 * 勒熱夫：沒有墊面、不畫路（路是區塊交界的凹路），交戰帶疊上彈坑、燒田、履帶痕與壕溝
 *
 * 【彈坑的密度】交戰帶裡一格（24 m）三成有坑，往外 700 m 內降到三分。**起始值，
 * 拿眼睛校**
 */
export const RZHEV_SITE: SiteLayout = {
  roads: [],
  roadWidth: 0,
  scars: {
    zone: SCAR_ZONE, fade: 700, dense: 0.3, sparse: 0.03,
    scorch: SCORCH, trenches: TRENCHES, tracks: TRACKS, minefields: MINEFIELDS,
    craterPatches: CRATER_PATCHES,
  },
  // 防風林帶在植被圈外（4.8～6 km 以遠）由著色器畫成田界上的帶；顏色是針葉樹冠色，與近處的林帶同一份
  belts: { frame: BELT_FRAME, halfWidth: 9, hex: canopyColor(FLORA_COLORS.winterSteppe.conifer).getHex() },
}
