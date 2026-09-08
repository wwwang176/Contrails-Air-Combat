import { Quaternion, Vector3 } from 'three'
import { boundingRadius, type Box } from './hit'
import { SHIP_AA_ZONES, type ShipAAZone } from './shipAA'
import type { BurstCycle } from '../weapons/burst'
import type { StrikeTarget } from './strikeTarget'
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
   * 船體命中盒，**艦體座標**。驅逐艦與巡洋艦各一個（艦體），航母兩個
   * （艦體＋飛行甲板）。
   *
   * 【盒頂一律低於最低的砲位】見 `SHIP_CLASSES` 的註解 —— 包住砲位的話，
   * 砲位永遠打不掉而且不報錯。有測試守著。
   *
   * 【艦體盒的底是吃水，不是水線】水下沒有盒的話，定深 1 m 的魚雷會從每
   * 一艘船的底下穿過去 —— 而那個失效的樣子是「魚雷安靜地穿過去繼續跑」。
   * 對炸彈是零影響：垂直距離只跟盒頂有關，而炸彈的爆心到不了水線之下
   * （`ship-draft.test.ts` 逐位元守著）。
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
   * 船體血量。
   *
   * 【它是用「幾枚魚雷」訂的，不是用機槍】機槍機砲打不沉軍艦：20 mm 一發
   * 5 傷害，打沉一艘驅逐艦要 4,000 發。魚雷一枚 15,000
   * （`weapons/stores.ts`）之下是：
   *
   * ```
   *   驅逐 20,000   2 枚
   *   巡洋 40,000   3 枚
   *   航母 60,000   4 枚
   * ```
   */
  readonly hp: number
  /**
   * 艦體的裝甲，mm。**打得穿它的口徑才扣得動艦體**（`weapons/armour.ts`）。
   *
   * 【它只擋艦體】甲板上的砲位是露天的，那幾個盒子沒有這一格 —— 機槍照樣
   * 打得掉防空砲，而那正是掃射軍艦在史實上的意義。
   *
   * 【取的是實際板厚】驅逐艦沒有裝甲帶，船殼是半吋級的鋼板；巡洋艦與航母
   * 有真正的裝甲帶。場上最大的航空機砲是 30 mm，所以後兩者對空中的槍砲
   * 是實質免疫 —— 機槍打不沉主力艦。
   */
  readonly armour: number
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
   * 還活著嗎。**死了之後那個盒從命中判定裡拿掉** —— 打掉的砲位是一個洞，
   * 不是還會擋子彈的殘骸。
   */
  alive: boolean
  /**
   * 命中盒，艦體座標，**已經含 ×1.5 的膨脹**（不膨脹的話砲位很難打中）。
   */
  readonly box: Box
}

/**
 * 場上的一艘船。**同時是 AI 的打擊目標**（`StrikeTarget`）：`hull`、
 * `impactY`、`value` 三格是艦級資料的複本，建船時填一次 —— 打擊那一層
 * 不必知道 `ShipClass`，地面目標也用同一份視圖。
 */
export interface Ship extends StrikeTarget {
  readonly kind: 'ship'
  readonly index: number
  readonly team: Team
  /** 就是 `cls.hull` */
  readonly hull: readonly Box[]
  /** 就是 `deckHeightOf(cls)`：船的 `position.y` 恆為 0，甲板高就是世界高度 */
  readonly impactY: number
  /** 就是 `cls.hp`：選目標時的價值（`ai/shipAttack.ts`） */
  readonly value: number
  /**
   * 這一艘沉了就輸 —— 只有 `defend` 規則讀它（`battle/mission.ts` 的
   * `vitalSunk`）。由關卡的 `MissionFleet` 條目帶進來。
   *
   * **`World` 自己不讀它。** 船怎麼被打沉與它要不要緊是兩件事。
   */
  readonly vital: boolean
  readonly cls: ShipClass
  /** 世界座標，水線。**y 恆為 0** —— 船不隨浪起伏（spec §12）。 */
  readonly position: Vector3
  /** 只有艏向（繞 Y）。船不橫搖、不縱搖、**也不轉向**。 */
  readonly orientation: Quaternion
  /** 開局位置。`resetShip` 抄回去 —— 沒有波次的關重開不重建 World。 */
  readonly spawn: Vector3
  readonly heading: number
  /**
   * 目前航速，m/s。**沉了之後會被 `stepShips` 一路減到 0**，其餘時間等於
   * `cruiseSpeed`。
   */
  speed: number
  /** 開局航速，m/s。`resetShip` 抄回去 —— `speed` 會被滑行歸零。 */
  readonly cruiseSpeed: number
  hp: number
  /**
   * 還浮著嗎。**血量歸零就是 false。**
   *
   * 【沉了之後它完全退場】砲位全部死掉、不再是任何人的目標、也不再擋
   * 子彈 —— 與 `Combatant.alive` 同一個性質：**旗標而不是從陣列移除**，
   * 因為 `Ship.index` 是彈丸 `owner` 編碼的來源，移除會讓還在飛的船砲彈
   * 認錯主人。
   *
   * 【但它還會動】沉了之後 `stepShips` 讓它滑行到停 —— 見那一支。
   */
  alive: boolean
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
 * 【盒頂一律低於最低的砲位 —— 硬性不變量，有測試守著】盒子含住砲位的話，
 * 從上方來的子彈會在更早的物理步就被船體吃掉，**砲位永遠打不掉而且不報錯**
 * —— 同一個物理步之內的優先權救不了跨步的問題。
 *
 * 所以船體盒只到**主甲板**，甲板以上交給砲位自己的盒。代價是子彈會穿過
 * 艦橋，這一期接受。
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
      box([-14.2, -8.5, -133.0], [14.2, 12.0, 133.0]),
      // 飛行甲板。頂 14.0 剛好在最低的砲位（14.18）之下
      box([-24.5, 12.0, -130.0], [18.5, 14.0, 130.0]),
    ],
    radius: 0,
    hp: 60_000,
    // 機庫甲板 3 吋、舷側裝甲帶 4 吋。取薄的那一層
    armour: 76,
    zones: SHIP_AA_ZONES.essex!,
  },
  fletcher: {
    id: 'fletcher',
    name: 'USS Fletcher DD-445',
    url: '/models/fletcher.glb',
    hull: [
      box([-6.04, -4.0, -57.4], [6.04, 4.5, 57.4]),
    ],
    radius: 0,
    hp: 20_000,
    // 沒有裝甲帶，船殼是半吋級的鋼板 —— 20 mm 打得動它
    armour: 13,
    zones: SHIP_AA_ZONES.fletcher!,
  },
  wichita: {
    id: 'wichita',
    name: 'USS Wichita CA-45',
    url: '/models/wichita.glb',
    hull: [
      box([-9.41, -6.5, -92.7], [9.41, 7.0, 92.7]),
    ],
    radius: 0,
    hp: 40_000,
    // 舷側裝甲帶 6 吋
    armour: 152,
    zones: SHIP_AA_ZONES.wichita!,
  },
}

// 【半徑就地補上】寫在字面值裡的話 `hull` 與 `zones` 還沒成形。
for (const cls of Object.values(SHIP_CLASSES)) {
  (cls as { radius: number }).radius = radiusOf(cls.hull, cls.zones)
}

/**
 * 主甲板的高度，m。
 *
 * 【為什麼是 `hull` 的最高點】船體盒一律止於主甲板（本檔的硬性不變量：
 * 盒頂低於最低的砲位），所以那就是甲板。
 *
 * 【它不是「船有多高」】桅杆、測距儀、上層建築全在盒外，所以它只有模型
 * 高度的三分之一到一半。要「整艘船的最高點」的話問的是**模型** ——
 * `render/ships.ts` 的 `shipModelTop`，HUD 的標記走那一支。
 *
 * 唯一的消費端是轟炸解算（`ai/bombRun.ts`）：炸彈落在甲板上，用海面的話
 * 末速下多飛約 7 m。
 */
export function deckHeightOf(cls: ShipClass): number {
  let top = 0
  for (const b of cls.hull) {
    const t = b.center.y + b.half.y
    if (t > top) top = t
  }
  return top
}

export function createShip(
  index: number, cls: ShipClass, team: Team,
  x: number, z: number, heading: number, speed: number,
  vital = false,
): Ship {
  return {
    kind: 'ship',
    index,
    team,
    vital,
    cls,
    hull: cls.hull,
    impactY: deckHeightOf(cls),
    value: cls.hp,
    position: new Vector3(x, 0, z),
    orientation: new Quaternion().setFromAxisAngle(UP, heading),
    spawn: new Vector3(x, 0, z),
    heading,
    speed,
    cruiseSpeed: speed,
    hp: cls.hp,
    alive: true,
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
  // 【航速也要抄回去】它會被沉沒後的滑行減到 0。少了這一行，第二場的
  // 沉船從 0 起步 —— 而 `rematch` 那一組護欄比的是耗時，抓不到
  s.speed = s.cruiseSpeed
  s.hp = s.cls.hp
  s.alive = true
  s.gunCooldowns.fill(0)
}

/** 給 `stepShips` 用的暫存。模組私有，禁止跨模組共用。 */
const FWD = /* @__PURE__ */ new Vector3()

/**
 * 沉沒之後的減速度，m/s²。**起始值，待試飛。**
 *
 * 艦隊航速 8 m/s ⇒ 約 27 秒停下、滑行約 107 m。
 *
 * 【為什麼是固定減速度而不是指數衰減】指數衰減永遠到不了 0 —— 畫面上那是
 * 一艘永遠在慢慢爬的船，而且 `speed === 0` 那條捷徑永遠不成立。
 */
export const COAST_DECEL = 0.3

/**
 * 推進一步：等速直線，固定艏向。
 *
 * 【為什麼這麼簡單】任務中的船緩慢向前、不閃避。轉向與損管都不在這一期。
 *
 * 【沉了之後滑行到停】一萬噸的船在同一個物理步之內從 8 m/s 變成 0，畫面上
 * 像撞到牆。停下來之後 `speed === 0`，這個迴圈就跳過它了。
 */
export function stepShips(ships: readonly Ship[], dt: number): void {
  for (const s of ships) {
    if (s.speed === 0) continue
    if (!s.alive) {
      const v = s.speed - COAST_DECEL * dt
      s.speed = v > 0 ? v : 0
    }
    FWD.set(0, 0, -1).applyQuaternion(s.orientation)
    s.position.addScaledVector(FWD, s.speed * dt)
  }
}
