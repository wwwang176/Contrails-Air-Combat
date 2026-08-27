import { describe, it, expect } from 'vitest'
import { Color, type Mesh, type MeshStandardMaterial, type ShaderMaterial } from 'three'
import { createFog, fogFactor, FOG_COLOR, FOG_DENSITY } from '../../src/render/fog'
import {
  createSky, skyColorAt, SKY_GRADIENT_POWER, SKY_HORIZON, SKY_ZENITH,
} from '../../src/render/sky'
import { CAMERA_FAR } from '../../src/render/scene'
import { createOcean, FAR_SEA_SIZE, FAR_SEA_Y, SEA_COLOR } from '../../src/render/ocean'
import { DEFAULT_GOD_CAMERA } from '../../src/camera/godCamera'

describe('fogFactor', () => {
  it('零距離沒有霧', () => {
    expect(fogFactor(0, FOG_DENSITY)).toBe(0)
  })

  it('隨距離單調遞增且不超過 1', () => {
    let prev = -1
    for (let d = 0; d <= 400_000; d += 5_000) {
      const f = fogFactor(d, FOG_DENSITY)
      expect(f).toBeGreaterThanOrEqual(prev)
      expect(f).toBeLessThanOrEqual(1)
      prev = f
    }
  })
})

/**
 * 【這一組把設計意圖變成會紅的東西】
 *
 * 密度是一個數字，而它同時決定三件相互拉扯的事：纏鬥距離內顏色不失真、
 * 上帝視角看得到整個戰場、遠海的邊緣化得掉。只斷言「有霧」的話，這三個
 * 後果沒有任何一個被守住 —— 有人為了讓遠方更朦朧把密度加十倍，近處的
 * 敵機會一起變灰，而沒有東西會紅。
 */
describe('霧的濃度落在設計意圖上', () => {
  it('5 km（纏鬥距離）幾乎沒有霧', () => {
    expect(fogFactor(5_000, FOG_DENSITY)).toBeLessThan(0.01)
  })

  it('30 km（上帝視角的全戰場）開始化開但仍看得清楚', () => {
    const f = fogFactor(30_000, FOG_DENSITY)
    expect(f).toBeGreaterThan(0.10)
    expect(f).toBeLessThan(0.25)
  })

})

/** three 工作色彩空間下的 HSL 明度。 */
const lightness = (c: Color): number => c.getHSL({ h: 0, s: 0, l: 0 }).l

/**
 * 【這一組守的是需求本身，不是實作細節】專案負責人的原話是「遠方可以考慮
 * FOG，但是要看得出地平線」，2026-08-09 又補上「海面要比天空深、海面近到遠
 * 幾乎沒有顏色變化」。
 *
 * 【地平線由誰撐起來，換過一次】原本是**霧色**與天空色的差：遠海化進霧色，
 * 而霧色比天空暗一階。但那個做法讓海面自己近到遠變了 0.109，比地平線那一階
 * （0.092）還大 —— 那條線讀起來只是一整片洗白裡的一段。
 *
 * 現在是**海色**與天空色的差（2026-08-10 起 0.454），而海面完全退出全域霧。
 * 所以這一組的
 * 主角由 `FOG_COLOR` 換成 `SEA_COLOR` 加上兩個材質的 `fog` 旗標。
 *
 * 【比的是 `skyColorAt(0)` 不是 `SKY_HORIZON`】初版比錯了對象。天空著色器
 * 的 `t = dirY × 0.5 + 0.5`，地平線（`dirY = 0`）落在漸層的**正中間**；
 * `SKY_HORIZON` 只出現在正下方、被海擋著，畫面上永遠不會出現。當時的霧色
 * 因此比天空**亮**，而測試照樣綠 —— 專案負責人在試飛時一眼看出來。
 * 那個教訓由本組最後一條記錄著。
 */
describe('地平線要看得出來', () => {
  /**
   * 【地平線現在由海色與天空色的差撐起來，不再由霧色】專案負責人的要求原文
   * 是「海面要比天空深」。海面不吃霧之後（見下面兩條），霧不再讓海面往天空
   * 色靠，所以這條關係變成兩個常數之間的事。
   *
   * 【比的是 base color，那是刻意的】畫面上的像素還要過一次 PBR 著色，測不到
   * 也不該測 —— 那會把燈光綁進這條斷言。base color 與天空色是唯一測得到、
   * 也唯一不會隨燈光漂掉的一組數（spec 2026-08-09 §4.2）。
   *
   * 【0.25 是怎麼來的】2026-08-09 實測：天空 0.431、海 0.060，階差 0.371。
   * 在那之前只有 0.092（霧化後的遠海 0.169 對天空 0.261）—— 那正是「接縫太
   * 怪」的成因。取 0.25 留浮動空間，但遠高於改動前。
   *
   * 【2026-08-10 又拉開了】天空的下半提亮、海色壓深，階差變成 **0.454**
   * （天空 0.495、海 0.041）。門檻不動 —— 它守的是下限，而兩次改動都是往
   * 上走。
   */
  it('海色比地平線上的天空色暗，而且差得很開', () => {
    const sky = skyColorAt(0, new Color())
    const sea = new Color(SEA_COLOR)
    expect(lightness(sea)).toBeLessThan(lightness(sky))
    expect(lightness(sky) - lightness(sea)).toBeGreaterThan(0.25)
  })

  /**
   * 【這是「霧不再讓海面近遠變色」唯一的來源】海面的近遠色差**完全**來自霧。
   *
   * 【兩個材質要分開斷言】只測一個的話，漏掉另一個的那種錯誤 —— 也就是
   * `ocean.ts` 自己註解裡警告的「5 km 處出現一條色帶」—— 就沒有被守住。
   */
  it('細浪面不吃霧', () => {
    const ocean = createOcean()
    try {
      // 【細浪面是一組 clipmap 的層】十層共用同一份材質（見 OCEAN_BASE_CELL），
      // 所以取任何一層都是同一顆。逐層檢查是為了擋住「日後有人給某一層換了
      // 材質」—— 那正是「5 km 處出現一條色帶」那一類 bug 的形狀
      expect(ocean.mesh.children.length).toBeGreaterThan(0)
      for (const level of ocean.mesh.children) {
        expect(((level as Mesh).material as MeshStandardMaterial).fog).toBe(false)
      }
    } finally {
      ocean.dispose()
    }
  })

  it('遠海不吃霧', () => {
    const ocean = createOcean()
    try {
      expect((ocean.farMesh.material as MeshStandardMaterial).fog).toBe(false)
    } finally {
      ocean.dispose()
    }
  })

  /**
   * 【天空頂部比較深】專案負責人要求的第四件事。它改動前就成立，這條是防止
   * 日後有人把漸層調反或壓平 —— 那會讓天空變成一片死板的單色。
   * 實測落差 0.218（2026-08-09 是 0.154，在那之前 0.146）。
   */
  it('天頂比地平線上的天空暗', () => {
    const top = skyColorAt(1, new Color())
    const hz = skyColorAt(0, new Color())
    expect(lightness(hz) - lightness(top)).toBeGreaterThan(0.10)
  })

  /**
   * 【天空整體要比 2026-08-09 之前亮】那時地平線 0.261、天頂 0.115；提亮後
   * 是 0.431 與 0.277；2026-08-10 只再提下半，成為 **0.495 與 0.277**。
   *
   * 【天頂的下限就是這條在守】專案負責人 2026-08-10 要求「頂部不動」，而
   * 「不動」在這個漸層裡是恆等式（`dirY = 1` → `t = 1` → 直接取天頂色），
   * 不需要另一條測試。這條守的是有人日後真的去改 `SKY_ZENITH`。
   *
   * 【兩頭都要釘】只釘地平線的話，有人可以把天頂調得**更黑**而仍然通過 ——
   * 那不是「整體淡一點」，是把落差拉大。所以天頂也要有下限。
   */
  it('天空整體比改動前亮（地平線與天頂都要）', () => {
    expect(lightness(skyColorAt(0, new Color()))).toBeGreaterThan(0.35)
    expect(lightness(skyColorAt(1, new Color()))).toBeGreaterThan(0.20)
  })

  /**
   * 【把著色器那一份接上來】上面幾條測的都是 CPU 的 `skyColorAt`，而畫面是
   * 天空球的著色器畫的。`sky.ts` 寫著「兩份必須一致」，但那句話原本沒有任何
   * 測試 —— 有人改了 `uniforms` 而沒改 `skyColorAt`（或反過來），上面每一條
   * 都還是綠的，畫面卻變了。
   *
   * 這一條守得住三個 uniform，守不住 `FRAG` 裡混色的**形狀**（`mix` 與
   * `clamp` 那兩行是字串，測不到）。2026-08-10 把指數由字面值改成 uniform，
   * 因此多守住一格 —— 原本 `pow(t, 0.65)` 與 `SKY_GRADIENT_POWER` 是兩份
   * 獨立的常數。
   */
  it('天空球的 uniform 用的是同三個常數', () => {
    const sky = createSky()
    const mat = sky.material as ShaderMaterial
    expect((mat.uniforms.horizon!.value as Color).getHex()).toBe(SKY_HORIZON)
    expect((mat.uniforms.zenith!.value as Color).getHex()).toBe(SKY_ZENITH)
    // 【2026-08-10 補上】指數原本是 FRAG 字串裡的字面值 0.65，與
    // SKY_GRADIENT_POWER 是兩份獨立的常數 —— 改一份忘另一份，畫面與霧色就
    // 分家而沒有東西會紅。改成 uniform 之後這條守得住。
    expect(mat.uniforms.power!.value).toBe(SKY_GRADIENT_POWER)
  })

  /**
   * 【取代被刪掉的「霧色比天空暗」】那條斷言的**關係**被需求推翻了，但它
   * 背後的需求沒有 —— **霧色必須跟著天空走**。改動後的關係是「相等」。
   *
   * 【為什麼下面 `createFog` 那條守不住這件事】它比的是 `createFog().color`
   * 與 exported `FOG_COLOR`。兩邊一起改照樣綠，`FOG_COLOR` 可以被寫成任意
   * 常數。這一條比的是 `FOG_COLOR` 與它宣稱的來源。
   */
  it('霧色就是地平線上的天空色', () => {
    const sky = skyColorAt(0, new Color())
    expect(FOG_COLOR.r).toBeCloseTo(sky.r, 9)
    expect(FOG_COLOR.g).toBeCloseTo(sky.g, 9)
    expect(FOG_COLOR.b).toBeCloseTo(sky.b, 9)
  })

  /**
   * 【2026-08-11 補】天空球是自寫的 `ShaderMaterial`，three **不會**替它做
   * 輸出色彩空間轉換 —— `linearToOutputTexel` 是 built-in 材質才有的 chunk。
   * 少了它，天空把線性值原樣寫進 sRGB 緩衝區，螢幕上比常數所表達的暗一大截
   * （地平線 L 0.495 → 實際只有 0.241），而**上面每一條斷言都還是綠的**：
   * 它們測的是 CPU 的線性工作空間，看不到輸出那一段。
   *
   * 所以 2026-08-09 與 08-10 兩次「把天空調亮」都沒有真正生效。這一條就是
   * 那個洞的補丁 —— 少了它，有人刪掉那行 include 不會有東西紅。
   *
   * 這一條同時守住「天空與霧色在螢幕上一致」：霧作用的物件走 built-in 材質，
   * 本來就有轉換。
   */
  it('天空球有做輸出色彩空間轉換', () => {
    const mat = createSky().material as ShaderMaterial
    expect(mat.fragmentShader).toContain('#include <colorspace_fragment>')
  })

  it('`SKY_HORIZON` 這個常數本身並不出現在地平線上', () => {
    // 這一條記錄的是上面那個錯誤本身 —— 有人日後想「直接比 SKY_HORIZON
    // 不是更簡單嗎」，這裡有現成的反證。
    const atHorizon = skyColorAt(0, new Color())
    expect(lightness(atHorizon)).toBeLessThan(lightness(new Color(SKY_HORIZON)) - 0.2)
  })
})

describe('createFog', () => {
  it('用的是設計值', () => {
    const f = createFog()
    expect(f.density).toBe(FOG_DENSITY)
    // 【比 r/g/b 不比 getHex】FOG_COLOR 已經在工作色彩空間裡，getHex 會轉回
    // sRGB 並量化成 8 bit，來回一趟不保證逐位元相同。
    expect(f.color.r).toBeCloseTo(FOG_COLOR.r, 6)
    expect(f.color.g).toBeCloseTo(FOG_COLOR.g, 6)
    expect(f.color.b).toBeCloseTo(FOG_COLOR.b, 6)
  })

  it('回傳的是複本，改它不會汙染 FOG_COLOR', () => {
    const before = FOG_COLOR.clone()
    createFog().color.setRGB(1, 0, 0)
    expect(FOG_COLOR.r).toBe(before.r)
    expect(FOG_COLOR.g).toBe(before.g)
    expect(FOG_COLOR.b).toBe(before.b)
  })
})

/**
 * 【畫面上那條地平線必須接近幾何地平線】這個世界的海是平的，所以幾何地平線
 * 永遠是與海面平行的那條視線（世界仰角 0°），與高度無關。但 `farMesh` 是
 * **有限**的四邊形，它的邊落在 `atan(離海高度 / 半邊)` —— **那才是畫面上
 * 實際看到的那條線**。
 *
 * 【那是上界】正方形朝**邊的中點**看時俯角最深，朝**角**看時距離是
 * `半邊 × √2`、俯角更淺。所以這裡算的是最壞值。
 *
 * 改動前半邊 250 km，上帝視角上限（12,000 m）時那條邊在幾何地平線以下
 * 2.751°，1080p / 65° 下是 40.7 px，而且**隨高度往下跑**。以前被霧糊掉所以
 * 看不出來；海面不吃霧之後它會變成 L 0.060 對 L 0.431 的硬階。
 * 半邊 3,000 km 之後只剩 0.229°（3.4 px）。
 */
describe('地平線接近幾何地平線', () => {
  /** 透視投影下的像素數：`(H/2)·tanθ / tan(FOV_v/2)`。1080p / 65° */
  const pixels = (deg: number): number =>
    (1080 / 2) * Math.tan(deg * (Math.PI / 180)) / Math.tan(32.5 * (Math.PI / 180))

  /** 遠海邊的最壞俯角，度。高度是**離海面**的高度，所以要扣掉 `FAR_SEA_Y` */
  const edgeDeg = (cameraY: number): number =>
    Math.atan((cameraY - FAR_SEA_Y) / (FAR_SEA_SIZE / 2)) * (180 / Math.PI)

  /**
   * 【為什麼要這一條】負的或零的 `FAR_SEA_SIZE` 會讓 `edgeDeg` 變成負值或
   * 無限大，下面那條斷言可能因此假綠。先把輸入釘住。
   */
  it('遠海的尺寸是正的', () => {
    expect(FAR_SEA_SIZE).toBeGreaterThan(0)
  })

  it('上帝視角的高度上限處，遠海的邊落在幾何地平線以下不到 0.3°', () => {
    // 【用實際的設定值不寫死】上帝視角的上限日後若調高，這條要跟著紅
    const deg = edgeDeg(DEFAULT_GOD_CAMERA.maxAltitude)
    expect(deg).toBeGreaterThan(0)
    expect(deg).toBeLessThan(0.3)
    expect(pixels(deg)).toBeLessThan(4)
  })

  /** 【纏鬥的整個高度帶要低於兩個像素】那才是實際會一直看到的高度。 */
  it('6,000 m 處低於兩個像素', () => {
    expect(pixels(edgeDeg(6_000))).toBeLessThan(2)
  })
})

/**
 * 遠平面若小於遠海的半對角線，遠海的四個角會被裁掉 —— 而被裁掉的邊緣就是
 * 一條硬邊。
 */
describe('相機遠平面容得下遠海', () => {
  it('遠平面大於遠海的半對角線', () => {
    // 【要比半對角線不是半邊】方形的角比邊遠 √2 倍，而視野掃得到角
    expect(CAMERA_FAR).toBeGreaterThan((FAR_SEA_SIZE / 2) * Math.SQRT2)
  })
})
