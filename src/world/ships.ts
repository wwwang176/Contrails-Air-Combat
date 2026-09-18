import { Quaternion, Vector3 } from 'three'
import { boundingRadius, type Box } from './hit'
import { SHIP_AA_ZONES, type ShipAAZone } from './shipAA'
import type { BurstCycle } from '../weapons/burst'
import type { ShipGunSpec } from './shipGuns'
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
   * 船體命中盒，**艦體座標**。驅逐艦與巡洋艦各一個（艦體），航母六個
   * （艦體＋飛行甲板＋艦島四層）。**第一個恆是艦體** —— 投放窗與雷擊的
   * 命中窗用它的半長半寬。
   *
   * 【砲位不得在任何盒裡面、也不得在正下方】見 `SHIP_CLASSES` 的註解 ——
   * 包住或蓋住砲位的話，砲位永遠打不掉而且不報錯。有測試守著。
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
   * 砲位打光之後戰鬥機掃射船體的瞄點，**艦體座標**。由 `hull` 自動產生
   * （`hullAimPoints`），載入時算一次。
   */
  readonly aimPoints: readonly Vector3[]
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
  /**
   * 這一門砲的規格。**掛在砲身上而不是查層別的表** —— 陸上的 88 mm 與艦上
   * 的 5 吋同屬 `flak` 層，但強度是兩份（`GROUND_FLAK_SPEC`）。
   */
  readonly spec: ShipGunSpec
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
  /** 累計發射的引信砲彈數。引信誤差的種子：逐發不同、同一場可重現。 */
  fired: number
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
 * 【砲位不得在任何盒裡面、也不得在任何盒的正下方 —— 硬性不變量，有測試
 * 守著】盒子含住或蓋住砲位的話，從上方來的子彈會在更早的物理步就被船體
 * 吃掉，**砲位永遠打不掉而且不報錯** —— 同一個物理步之內的優先權救不了
 * 跨步的問題。
 *
 * 所以驅逐艦與巡洋艦的船體盒只到**主甲板**，甲板以上交給砲位自己的盒，
 * 子彈會穿過它們的艦橋。Essex 的砲位全在甲板邊緣的砲廊上，甲板盒因此只鋪
 * 中央那一條、艦島另有盒 —— 兩者都不蓋到任何砲位。
 */
export const SHIP_CLASSES: Readonly<Record<ShipClassId, ShipClass>> = {
  essex: {
    id: 'essex',
    name: 'USS Essex CV-9',
    url: '/models/essex.glb',
    // 艦體 → 飛行甲板 → 艦島。數字照 GLB 量的（`models-src/essex.glb` 的
    // 頂點包圍盒）：甲板面 18.3、艦島 x 9.5…16.5、z −28…+7、頂 41.6（煙囪）
    hull: [
      // 艦體。頂 12.0 在最低的砲位（14.18）之下
      box([-14.2, -8.5, -133.0], [14.2, 12.0, 133.0]),
      // 飛行甲板：**只鋪中央那一條**。GLB 的甲板寬到 x −19.5…15.75，但砲位
      // 全掛在 |x| ≥ 12.9 的砲廊上、比甲板面低 —— 鋪滿的話砲位在盒的正下方，
      // 從上方來的子彈先被甲板吃掉（見檔頭的不變量）。薄板貼在真甲板的高度，
      // 炸彈的落點面因此是看得到的那一片甲板
      box([-12.0, 17.7, -130.0], [12.0, 18.3, 130.0]),
      // 艦島四層：主體、艦橋層、上艦橋、煙囪。裡面沒有砲位；最近的 5 吋砲在
      // z −29.5 與 +16.5，都在盒外
      box([9.5, 18.05, -28.0], [16.5, 25.0, 7.0]),
      box([10.0, 25.0, -26.0], [16.0, 30.5, 0.0]),
      box([11.0, 30.5, -17.5], [15.0, 34.5, -7.0]),
      box([11.0, 34.5, -10.5], [14.5, 41.6, -3.0]),
    ],
    radius: 0,
    aimPoints: [],
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
    aimPoints: [],
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
    aimPoints: [],
    hp: 40_000,
    // 舷側裝甲帶 6 吋
    armour: 152,
    zones: SHIP_AA_ZONES.wichita!,
  },
}

/**
 * 掃射瞄點的間距上限，m。盒頂面的長、寬各切成 `ceil(邊長 / 間距)` 格，所以
 * 越大的船點越多。**起始值，由試飛裁定。**
 */
export const HULL_AIM_SPACING = 50

/**
 * 由命中盒產生掃射瞄點，**艦體座標**：每個盒的頂面切格、格心放一點；正上方
 * 還有別的盒蓋著的點拿掉。
 *
 * 【只鋪頂面】盒從吃水線以下開始，立體網格會把點放進水裡與船殼裡面 ——
 * 飛機會對著海面打。
 *
 * 【蓋住的拿掉】Essex 的船體盒整條頂面在飛行甲板底下、艦島下層在上層底下；
 * 瞄那些點等於瞄一塊看不到的鋼板。
 */
export function hullAimPoints(hull: readonly Box[], spacing = HULL_AIM_SPACING): Vector3[] {
  const out: Vector3[] = []
  for (const b of hull) {
    const top = b.center.y + b.half.y
    const nx = Math.max(1, Math.ceil((2 * b.half.x) / spacing))
    const nz = Math.max(1, Math.ceil((2 * b.half.z) / spacing))
    for (let i = 0; i < nx; i++) {
      const x = b.center.x - b.half.x + (2 * b.half.x * (i + 0.5)) / nx
      for (let k = 0; k < nz; k++) {
        const z = b.center.z - b.half.z + (2 * b.half.z * (k + 0.5)) / nz
        let covered = false
        for (const o of hull) {
          if (o === b) continue
          if (Math.abs(x - o.center.x) > o.half.x || Math.abs(z - o.center.z) > o.half.z) continue
          if (o.center.y - o.half.y >= top - 1e-6) { covered = true; break }
        }
        if (!covered) out.push(new Vector3(x, top, z))
      }
    }
  }
  return out
}

// 【半徑與瞄點就地補上】寫在字面值裡的話 `hull` 與 `zones` 還沒成形。
for (const cls of Object.values(SHIP_CLASSES)) {
  (cls as { radius: number }).radius = radiusOf(cls.hull, cls.zones)
  ;(cls as { aimPoints: readonly Vector3[] }).aimPoints = hullAimPoints(cls.hull)
}

/**
 * 主甲板的高度，m：**蓋住中線的盒**裡最高的那個盒頂。
 *
 * 【為什麼限定蓋住中線】Essex 的艦島有盒而且比甲板高得多；炸彈落的是甲板，
 * 不是艦島頂。驅逐艦與巡洋艦只有一個盒，兩種說法一樣。
 *
 * 【它不是「船有多高」】桅杆、測距儀全在盒外。要「整艘船的最高點」的話
 * 問的是**模型** —— `render/ships.ts` 的 `shipModelTop`，HUD 的標記走那一支。
 *
 * 唯一的消費端是轟炸解算（`ai/bombRun.ts`）：炸彈落在甲板上，用海面的話
 * 末速下多飛約 7 m。
 */
export function deckHeightOf(cls: ShipClass): number {
  let top = 0
  for (const b of cls.hull) {
    if (Math.abs(b.center.x) > b.half.x) continue
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
