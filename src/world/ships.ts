import { Quaternion, Vector3 } from 'three'
import { boundingRadius, type Box } from './hit'
import { SHIP_AA_ZONES, type ShipAAZone } from './shipAA'
import type { BurstCycle } from '../weapons/burst'
import type { Team } from './World'

/**
 * # 場上的軍艦
 *
 * **船不是 `Combatant`。** 它沒有飛行模型、沒有控制器、不進記分板、不上
 * HUD 的接觸列表。理由見
 * `docs/superpowers/specs/2026-09-04-carrier-group-design.md` §2：船與飛機
 * 真正共用的只有「砲位怎麼瞄準」，而那一層已經是純函數。
 *
 * ## 座標系
 *
 * 與 `shipAA.ts` 一致：X 橫向（+X 右舷）、**Y 上**、**−Z 艦首**，原點在
 * 水線 × 艦體中點 × 中線。艏向 0 = 朝 −Z。
 */
export type ShipClassId = 'essex' | 'fletcher' | 'wichita'

/** 艦級的靜態資料。一個艦級一筆，所有同型艦共用。 */
export interface ShipClass {
  readonly id: ShipClassId
  readonly name: string
  /** 瀏覽器取得 GLB 的路徑。放 `public/` 底下才會進 `vite build` 的產物。 */
  readonly url: string
  /**
   * 船體命中盒，**艦體座標**。艦體一個、上層建築一個（航母多一層飛行甲板）。
   *
   * 【它同時擋子彈與判撞船】所以最高點必須高過最高的砲位 —— 只做到主甲板
   * 的話，子彈會從艦橋「裡面」穿過去打到對舷的砲位。
   */
  readonly hull: readonly Box[]
  /**
   * 包圍球半徑，m。**必須是上界。**
   *
   * 【算小了不會報錯】子彈穿過艦艏卻不扣血，而且只在特定角度發生 ——
   * 與 `hit.ts` 的 `boundingRadius` 同一條規則。所以取「船體盒最遠角」與
   * 「最遠砲位」兩者的最大值再加餘裕，而且有測試守著。
   */
  readonly radius: number
  /**
   * 船體血量。**這一期會扣、不會歸零** —— 機槍機砲打不沉軍艦，擊沉要等
   * 魚雷與炸彈（spec §12）。
   */
  readonly hp: number
  readonly zones: readonly ShipAAZone[]
}

/**
 * 一個砲位的執行期狀態。
 *
 * 【為什麼型別住在這裡而不是 `shipGuns.ts`】那一支是**行為**（瞄準、扳機），
 * 這一份是**狀態**。放在行為那一邊的話 `ships.ts` 要 import `shipGuns.ts`
 * 才寫得出 `Ship.guns`，而 `shipGuns.ts` 又要 import `Ship` —— 循環。
 * 資料模組不認識行為模組，方向就只有一個。
 */
export interface ShipGun extends BurstCycle {
  readonly zone: ShipAAZone
  /** 目前指向，**艦體座標**單位向量。初值 = 該層射界錐的軸。 */
  readonly aim: Vector3
  /** 射界錐的軸，艦體座標。`aim` 沒有目標時回歸到它。 */
  readonly axis: Vector3
  /** 搖晃相位。 */
  phase: number
  /** 目前目標的 combatant 索引；−1 = 沒有目標。 */
  targetIndex: number
  /** 距離下一次重新搜尋還有幾秒。 */
  searchCooldown: number
  /** 槍焰剩餘秒數。 */
  flash: number
  hp: number
  /**
   * 還活著嗎。**死了之後那個盒從命中判定裡拿掉** —— 負責人裁定：
   * 打掉的砲位是一個洞，不是還會擋子彈的殘骸。
   */
  alive: boolean
  /**
   * 命中盒，艦體座標，**已經含 ×1.5 的膨脹**（負責人：「可能需要膨脹
   * 1.5 倍比較好打」）。
   */
  readonly box: Box
}

/** 場上的一艘船。 */
export interface Ship {
  readonly index: number
  readonly team: Team
  readonly cls: ShipClass
  /** 世界座標，水線。**y 恆為 0** —— 船不隨浪起伏（spec §12）。 */
  readonly position: Vector3
  /** 只有艏向（繞 Y）。船不橫搖、不縱搖、**也不轉向**。 */
  readonly orientation: Quaternion
  /** 開局位置。`resetShip` 抄回去 —— 沒有波次的關重開不重建 World。 */
  readonly spawn: Vector3
  readonly heading: number
  /** 航速，m/s。固定不變。 */
  speed: number
  hp: number
  guns: ShipGun[]
  /**
   * 每個砲位一個射擊時鐘。
   *
   * 【為什麼是陣列而不是每個砲位一個 number】`weapons/cadence.ts` 的
   * `stepCadence` 收的是 `Float32Array + index`。放一個單獨的 number 在
   * `ShipGun` 裡就接不上那支函數，而重寫一份射速時鐘等於多一個會漂移的
   * 實作。
   */
  gunCooldowns: Float32Array
}

const UP = /* @__PURE__ */ new Vector3(0, 1, 0)

/** 以兩個角點建盒。與 `hit.ts` 的 `makeHitBox` 同一個形式，但不帶部位。 */
function box(
  min: readonly [number, number, number],
  max: readonly [number, number, number],
): Box {
  return {
    center: new Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2),
    half: new Vector3((max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2),
  }
}

/**
 * 包圍球：船體盒的最遠角與最遠砲位取大，再加 5 m 餘裕。
 *
 * 【餘裕不是保守，是必要】砲位盒本身有半邊長（最大 3 m），而這個半徑是拿來
 * 對**線段**做粗篩的 —— 只算到砲口的話，砲位盒朝外那一面在球外。
 */
function radiusOf(hull: readonly Box[], zones: readonly ShipAAZone[]): number {
  let r = boundingRadius(hull)
  for (const z of zones) r = Math.max(r, z.position.length())
  return r + 5
}

/**
 * 三個艦級。
 *
 * 【尺寸的來源】全長與艦寬照 `tools/blender/build_*.py` 開頭的史實值
 * （那也是 GLB 的來源）：Essex 265.79×28.35、Fletcher 114.75×12.065、
 * Wichita 185.42×18.82。高度帶則由 `shipAA.ts` 量到的砲位包絡推 ——
 * 砲位就架在甲板與上層建築上，它們的 y 範圍就是那兩層的高度。
 *
 * 【它們是碰撞用的粗體積，不是外型】兩三個盒不可能貼合艦體，也不需要 ——
 * 與飛機的 `hitBoxes` 同一個性質（那也比機體小）。
 *
 * 【Essex 的盒這一期沒有人驗】它不出現在 `japan-m4`（1943 年 1 月它還沒到
 * 太平洋）。等 `allies-m4` 沖繩那一關才會第一次被打到。
 */
export const SHIP_CLASSES: Readonly<Record<ShipClassId, ShipClass>> = {
  essex: {
    id: 'essex',
    name: 'USS Essex CV-9',
    url: '/models/essex.glb',
    // 艦體 → 飛行甲板（比水線寬很多，砲位掛在甲板邊的砲座上）→ 艦島
    hull: [
      box([-14.2, 0, -133.0], [14.2, 12.0, 133.0]),
      box([-24.5, 12.0, -130.0], [18.5, 15.5, 130.0]),
      box([7.0, 15.5, -22.0], [17.0, 26.0, 32.0]),
    ],
    radius: 0,
    hp: 60_000,
    zones: SHIP_AA_ZONES.essex!,
  },
  fletcher: {
    id: 'fletcher',
    name: 'USS Fletcher DD-445',
    url: '/models/fletcher.glb',
    hull: [
      box([-6.04, 0, -57.4], [6.04, 5.0, 57.4]),
      box([-4.6, 5.0, -26.0], [4.6, 13.0, 26.0]),
    ],
    radius: 0,
    hp: 20_000,
    zones: SHIP_AA_ZONES.fletcher!,
  },
  wichita: {
    id: 'wichita',
    name: 'USS Wichita CA-45',
    url: '/models/wichita.glb',
    hull: [
      box([-9.41, 0, -92.7], [9.41, 7.0, 92.7]),
      box([-7.6, 7.0, -48.0], [7.6, 16.0, 38.0]),
    ],
    radius: 0,
    hp: 40_000,
  zones: SHIP_AA_ZONES.wichita!,
  },
}

// 【半徑就地補上】寫在字面值裡的話 `hull` 與 `zones` 還沒成形。
for (const cls of Object.values(SHIP_CLASSES)) {
  (cls as { radius: number }).radius = radiusOf(cls.hull, cls.zones)
}

export function createShip(
  index: number, cls: ShipClass, team: Team,
  x: number, z: number, heading: number, speed: number,
): Ship {
  return {
    index,
    team,
    cls,
    position: new Vector3(x, 0, z),
    orientation: new Quaternion().setFromAxisAngle(UP, heading),
    spawn: new Vector3(x, 0, z),
    heading,
    speed,
    hp: cls.hp,
    // 【砲位由 shipGuns 填】這裡不 import 它的建構函數 —— 那會是
    // ships → shipGuns → ships 的循環。`createFleet` 負責把兩者接起來。
    guns: [],
    gunCooldowns: new Float32Array(cls.zones.length),
  }
}

/**
 * 回到開局狀態。**砲位由 `resetShipGuns` 另外處理。**
 *
 * 【為什麼一定要有】`japan-m4` 沒有波次，所以「再打一場」走的是就地
 * `resetBattle`，不重建 World。少了這一支，第二局船會停在上一局結束的
 * 位置 —— 而且不報錯。
 */
export function resetShip(s: Ship): void {
  s.position.copy(s.spawn)
  s.hp = s.cls.hp
  s.gunCooldowns.fill(0)
}

/** 給 `stepShips` 用的暫存。模組私有，禁止跨模組共用。 */
const FWD = /* @__PURE__ */ new Vector3()

/**
 * 推進一步：等速直線，固定艏向。
 *
 * 【為什麼這麼簡單】負責人裁定：任務中的船緩慢向前、不閃避。轉向與損管
 * 都不在這一期。
 */
export function stepShips(ships: readonly Ship[], dt: number): void {
  for (const s of ships) {
    if (s.speed === 0) continue
    FWD.set(0, 0, -1).applyQuaternion(s.orientation)
    s.position.addScaledVector(FWD, s.speed * dt)
  }
}
