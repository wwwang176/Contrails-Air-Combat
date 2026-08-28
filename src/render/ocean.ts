import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  LessDepth,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Sphere,
  Vector2,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import { SKY_GRADIENT_POWER, SKY_HORIZON, SKY_ZENITH } from './sky'

export interface WaveSpec {
  dirX: number
  dirZ: number
  amplitude: number
  /** 波長，公尺 */
  wavelength: number
  /** 相位速度，m/s */
  speed: number
}

/**
 * 波參數的唯一權威來源：同時餵給 shader uniform 與 CPU 的 gerstnerHeight。
 *
 * ── 【三道，而且都在 120 m 之上 —— 那是格子決定的】─────────────
 *
 * 網格是 60 m 的低多邊形面（見 `OCEAN_BASE_CELL`），Nyquist 因此把波長的
 * 下限釘在 **120 m**。更短的波在幾何上只會變成混疊，而 `OCEAN_VERT_FADE_HI
 * = 0.5` 正好會把它整個淡掉 —— 那道波**完全不存在**卻還在 uniform 裡佔一個
 * 位置、在片段裡照跑一次 sin。`ocean.test.ts` 有一條守著。
 *
 * ── 【方向要對 180° 取模來看】─────────────────────────────────
 *
 * 正弦波的 `+k` 與 `−k` 只差一個相位，所以 `(1.0, 0.15)` 與 `(−1.0, −0.15)`
 * 是同一道波。判斷方向分不分散，要看的是模 180° 之後的分佈。三道均勻鋪在
 * **0° / 55° / 115°**，沒有兩道擠在一起。
 *
 * ── 【速度用深水色散關係】────────────────────────────────────
 *
 *     c = √(gλ / 2π)      g = 9.81 m/s²
 *
 *   波長 380 m → 24.35 m/s
 *        250 m → 19.75
 *        165 m → 16.05
 *
 * **長波比短波快**，那是海面看起來有「湧」的原因：長浪從短浪底下穿過去。
 *
 * ── 【振幅和 4.5 m，兩端各有一條線夾著】───────────────────────
 *
 * 上界是 `island.ts` 的 `DRAW_FLOOR`（−5.5）：波谷比它更深的話，會露出
 * 為了避免 z-fighting 而沒有畫的海床格，島的四周破洞。
 *
 * 下界是「看得出是多邊形」：相鄰面的高差最大約 6.6 m / 60 m，法線差約 12°。
 * 比島（相鄰面差幾十度）柔得多 —— 所以低多邊形的主要訊號是**逐面色調**
 * （見 `FACE_TINT`），法線只是配角。
 *
 * 【加道數的代價】`splash`、`wrecks`、`debris` 入水全部走 `heightAt`，
 * 這裡每多一道就是每次呼叫多一次 `sin`。三道在可忽略的量級。
 */
export const WAVES: readonly WaveSpec[] = [
  { dirX: 1.0, dirZ: 0.0, amplitude: 2.0, wavelength: 380, speed: 24.35 },
  { dirX: 0.574, dirZ: 0.819, amplitude: 1.5, wavelength: 250, speed: 19.75 },
  { dirX: -0.423, dirZ: 0.906, amplitude: 1.0, wavelength: 165, speed: 16.05 },
]

/**
 * 座標扭曲的振幅（m）與兩道扭曲波的波長（m）、速度（m/s）。
 *
 * ── 【為什麼需要它：正弦的和是格柵，不是海】────────────────────────
 *
 * WAVES 是幾道**長峰**正弦波的疊加。長峰的意思是同一道波的波峰是一條直線，
 * 從畫面這頭拉到那頭。幾道直線波交叉，得到的是一個**規則的菱形格柵** ——
 * 畫面上看起來像燈芯絨或魚鱗，不像海。
 *
 * 這正是 2026-08-25 把 SEA_SHADE_GAIN 關掉的原因（見該常數的註解：「明暗會
 * 沿波形成規則的橫條紋」）。當時的處置是不要明暗；但天空反射一上來，同一個
 * 格柵又會從反射裡浮出來，躲不掉。
 *
 * 真實海面是**短峰**的：波峰只有幾個波長長就斷掉、彎折、錯開。成因是方向
 * 散佈與非線性交互作用。
 *
 * ── 【怎麼打散：座標扭曲（domain warping）】─────────────────────────
 *
 * 在算相位之前，先把取樣座標本身推歪一點：
 *
 *     phase = k · dot(dir, p + warp(p)) − ω t
 *
 * warp 是兩道**很長**的正弦（900 / 1100 m，互質），振幅 25 m。對 140 m 的
 * 長波，25 m 是五分之一個波長 —— 波峰因此在公里尺度上彎來彎去；對 31 m 的
 * 短波則接近一個波長，整個打散。**同一片海，不同尺度自動得到不同程度的
 * 打散**，而代價只有兩次 sin，與波的數量無關。
 *
 * 【為什麼兩道扭曲波要互質】900 與 1100 的最小公倍數是 9900 m，所以格柵的
 * 重複週期被推到將近 10 km 之外 —— 遠大於任何一個畫面看得到的範圍。取整數
 * 倍（例如 900/1800）的話扭曲自己就變成一個規則圖樣，等於把問題換了個尺度。
 *
 * 【三個地方必須一致】CPU 的 gerstnerHeight（碰撞、水柱、殘骸入水）、頂點
 * 著色器的位移、片段著色器的坡度 —— 三份都要用同一個 warp。不一致的症狀是
 * 「飛機撞到看不見的浪」或「亮塊與浪的形狀分家」。
 */
export const WAVE_WARP_AMP = 110
/**
 * 見 WAVE_WARP_AMP。第一層扭曲的兩道波長，m。
 *
 * ── 【2026-08-26 由 900 / 1100 拉長到 2113 / 3271】────────────────
 *
 * **人工回報：「從高空看很容易觀察到重覆」。** 成因是扭曲自己有週期：
 * 900 與 1100 的最小公倍數是 9,900 m，而 6,000 m 高空正俯視時畫面涵蓋
 * 約 7.6 km —— 那個圖樣在同一張畫面裡重複七、八次，比它要打散的波還好認。
 *
 * **打散圖樣的東西自己必須比畫面大。** 2113 與 3271 都是質數，最小公倍數
 * 6.9 × 10⁶ m；在任何看得到的尺度上都不會重複，而單獨一道的週期（2～3 km）
 * 也已經接近畫面的高度，讀起來是「這一片海跟那一片不一樣」而不是圖樣。
 */
export const WAVE_WARP_LEN_A = 2113
/** 見 WAVE_WARP_LEN_A。 */
export const WAVE_WARP_LEN_B = 3271

/**
 * 第二層扭曲的振幅（m）與兩道波長（m）。
 *
 * 【為什麼一層不夠】把第一層拉長到公里尺度之後，它只能讓「這一片海」與
 * 「那一片海」不一樣 —— 在**局部**（幾百公尺的範圍內）波峰仍然是一組平行
 * 直線交叉出來的規則格柵。第二層在 400～600 m 的尺度上再彎一次，那正好是
 * 高空俯視時一眼能涵蓋的範圍。
 *
 * 【振幅要小】9 m 對 140 m 的長波是十五分之一個波長 —— 彎得出來但不會把
 * 波形攪爛。第一層的 40 m 之所以可以大，是因為它慢：在 2 km 的尺度上變化
 * 40 m，局部幾乎是純平移，波形完全不受影響。
 *
 * 【兩層的軸刻意交換】第一層用 p.y 驅動 x、p.x 驅動 y；第二層反過來。同向
 * 疊加會讓兩層的效果沿同一個方向累積，看起來像一層比較強的扭曲。
 */
export const WAVE_WARP2_AMP = 25
/** 見 WAVE_WARP2_AMP。同樣取質數。 */
export const WAVE_WARP2_LEN_A = 419
/** 見 WAVE_WARP2_AMP。 */
export const WAVE_WARP2_LEN_B = 577

/**
 * 浪高包絡：每一道波的振幅隨位置起伏的下限。1 = 不起伏。
 *
 * ── 【為什麼真實的海是一組一組的】──────────────────────────────
 *
 * 純正弦波的振幅處處相同，所以整片海的浪高一模一樣 —— 那是這個海面看起來
 * 「機器做的」的另一半原因（前一半是波峰太直，由 WAVE_WARP_* 處理）。
 *
 * 真實海面的浪是**成群**的：幾個大浪過去之後跟著一段平緩，行話叫 wave
 * group。物理成因是頻率相近的波互相拍頻。眼睛非常認得這個特徵 —— 少了它，
 * 再多的波疊加起來還是像一張規則的布。
 *
 * ── 【怎麼做】────────────────────────────────────────────────
 *
 * 一個低頻的準隨機場 g（兩道長波相乘，見 WAVE_ENV_LEN_A），每一道波取它的
 * **不同相位切片**當作自己的振幅倍率：
 *
 *     env_i = mix(WAVE_ENV_LO, 1, 0.5 + 0.5 · sin(g · 展幅 + 該道波的相位))
 *
 * 取切片而不是各算一個場，是為了成本：場只算一次（兩次 sin），每道波再一次
 * sin。**而且不同的相位讓各道波的「大浪帶」錯開** —— 全部對齊的話就變成
 * 整片海一起漲落，那是潮汐不是浪。
 *
 * ── 【0.35 這個下限】──────────────────────────────────────────
 *
 * 振幅在 35% 到 100% 之間走。**刻意只往下調不往上調**：
 *
 *   一、test/unit/ocean.test.ts 守著「波高不超過所有波幅的總和」。往上調
 *       會讓那條界線失效，而那是碰撞判定唯一的靜態保證。
 *   二、往上調等於偷偷提高整體浪高，而浪谷不得深過 `island.ts` 的
 *       `DRAW_FLOOR`（−5.5）—— 越過就會露出沒有畫的海床，島的四周破洞。
 *
 * 代價是平均浪高降到約 67%。要補回來就動 `WAVES` 的振幅，而那要回頭看上面
 * 那兩條界線。
 */
export const WAVE_ENV_LO = 0.35
/**
 * 見 WAVE_ENV_LO。包絡場的兩道波長，m。
 *
 * 【為什麼是 800～1300 m】真實的 wave group 大約是五到十個波長長。對這裡
 * 最長的 140 m 波，那是 700～1400 m。同樣取質數避免與扭曲的尺度共振。
 */
export const WAVE_ENV_LEN_A = 887
/** 見 WAVE_ENV_LEN_A。 */
export const WAVE_ENV_LEN_B = 1289
/**
 * 見 WAVE_ENV_LO。切片的展幅 —— g 乘上它再取 sin。
 *
 * 【為什麼要 > 1】g 的值域是 [−1, 1]。展幅 1 時 sin 的引數只走 ±1 弧度，
 * 各道波取到的值高度相關，等於整片一起漲落。3.1 讓引數走 ±3.1（接近整個
 * 週期），相鄰兩道波的相位差就能給出幾乎無關的倍率。
 */
export const WAVE_ENV_SPREAD = 3.1
/**
 * 見 WAVE_WARP_AMP。扭曲自己的移動速度，m/s。
 *
 * 【為什麼要會動】不動的話扭曲就是一張固定的地圖釘在世界座標上 —— 浪從
 * 底下穿過去，而彎折的位置永遠不變，看久了會認出那個圖樣。
 *
 * 【為什麼要比浪慢一個量級】浪是 5～9 m/s。扭曲若跟浪同速，等於整個圖樣
 * 平移，打散的效果會被眼睛追著跑。0.6 m/s 讓它像是海流在慢慢改變。
 */
export const WAVE_WARP_SPEED = 0.6

/**
 * 每一道波「這個像素還分不分得出它」的淡出窗，單位是波長的倍數。
 *
 * 【為什麼不是剛好 0.5】0.5λ 是 Nyquist 的**極限**，不是可以用的工作點。
 * 取樣剛好到極限時，重建出來的訊號會帶著與取樣格柵的差頻 —— 畫面上就是
 * 一片規則的斜格子（摩爾紋）。而且 MSAA 幫不上忙：它做的是幾何覆蓋率的
 * 反鋸齒，著色器內部算出來的高頻它看不到。
 *
 * 【2026-08-26 為什麼現在才要動它】天空反射之前，波法線對顏色的影響極小
 * （只餵給碎光的對齊判定），混疊不明顯。菲涅耳在掠射角對法線**極度敏感**
 * —— 88° 入射時法線差 1° 就能讓反射率差一截 —— 於是同一個混疊被放大成
 * 看得見的格柵。
 *
 * 【代價是細節】提早淡出等於更早把波交給 σ 統計。近處不受影響（footprint
 * 遠小於波長），中距離會少一點浪的形狀、多一點糊。
 */
export const WAVE_FADE_LO = 0.15
/** 見 WAVE_FADE_LO。 */
export const WAVE_FADE_HI = 0.4

/**
 * 座標扭曲，**CPU 的那一份**。見 WAVE_WARP_AMP 與 WAVE_WARP2_AMP。
 *
 * 【與 shader 的 oceanWarp 必須逐字相同】那是這一段的 GLSL 版。
 */
export function waveWarp(x: number, z: number, time: number): [number, number] {
  const ka = (Math.PI * 2) / WAVE_WARP_LEN_A
  const kb = (Math.PI * 2) / WAVE_WARP_LEN_B
  const ka2 = (Math.PI * 2) / WAVE_WARP2_LEN_A
  const kb2 = (Math.PI * 2) / WAVE_WARP2_LEN_B
  const t = time * WAVE_WARP_SPEED
  return [
    Math.sin(z * ka + t * ka) * WAVE_WARP_AMP
      + Math.sin(x * ka2 - t * ka2 + 1.7) * WAVE_WARP2_AMP,
    Math.sin(x * kb - t * kb) * WAVE_WARP_AMP
      + Math.sin(z * kb2 + t * kb2 + 4.1) * WAVE_WARP2_AMP,
  ]
}

/**
 * 浪高包絡的底層場，值域 [−1, 1]。**CPU 的那一份**。見 WAVE_ENV_LO。
 *
 * 【與 shader 的 oceanEnvField 必須逐字相同】
 */
export function waveEnvField(x: number, z: number, time: number): number {
  const ka = (Math.PI * 2) / WAVE_ENV_LEN_A
  const kb = (Math.PI * 2) / WAVE_ENV_LEN_B
  const t = time * WAVE_WARP_SPEED
  return Math.sin(x * ka + t * ka) * Math.sin(z * kb - t * kb * 0.7)
}

/**
 * 第 `i` 道波在場值 `g` 之下的振幅倍率，落在 [WAVE_ENV_LO, 1]。
 *
 * 【與 shader 的 oceanEnv 必須逐字相同】
 */
export function waveEnv(g: number, i: number): number {
  const u = 0.5 + 0.5 * Math.sin(g * WAVE_ENV_SPREAD + i * 2.399963)
  return WAVE_ENV_LO + (1 - WAVE_ENV_LO) * u
}

/**
 * CPU 端波高。必須與 shader 的頂點位移公式完全一致，
 * 否則會出現視覺與碰撞判定不一致。
 */
export function gerstnerHeight(x: number, z: number, time: number): number {
  // 【扭曲在算相位之前】見 WAVE_WARP_AMP
  const [wx, wz] = waveWarp(x, z, time)
  const px = x + wx
  const pz = z + wz
  // 【包絡吃的是**未扭曲**的座標】扭曲是為了打散波峰的方向性，而包絡管的是
  // 「這一片海浪大不大」—— 那是位置的性質，不該跟著波一起被推歪
  const g = waveEnvField(x, z, time)
  let h = 0
  for (let i = 0; i < WAVES.length; i++) {
    const w = WAVES[i]!
    const k = (Math.PI * 2) / w.wavelength
    h += w.amplitude * waveEnv(g, i)
      * Math.sin(k * (w.dirX * px + w.dirZ * pz) - w.speed * k * time)
  }
  return h
}

/**
 * clipmap 最內層的格子邊長，m —— **也就是低多邊形那個「面」有多大**。
 *
 * 【60 怎麼來的】專案負責人指定「海的邊長比山大 1.5」，而山是
 * `archipelago.ts` 的 `FIELD_CELL = 40`。`ocean.test.ts` 守的是那個**關係**
 * 不是數字：山變了海要跟著變。
 *
 * 【它同時是波長的下限】Nyquist 讓 60 m 的格子畫不出短於 120 m 的波，
 * 見 `WAVES`。
 */
export const OCEAN_BASE_CELL = 60
/**
 * 見 OCEAN_BASE_CELL。每一層的邊各切幾格。**必須是 4 的倍數**（空洞是中央
 * 的 (段數/2)²，而那要能整除）。
 *
 * 【128 怎麼來的】它同時決定兩件事：每層的四邊形數（128² − 64² = 12,288）
 * 與每層覆蓋的半徑（64 × 格子）。128 配上 60 m 的基礎格，讓 L0 的半寬是
 * 3,840 m —— 浪最有起伏的那一圈。
 */
export const OCEAN_RING_SEGMENTS = 128
/**
 * 見 `OCEAN_BASE_CELL`。層數。每多一層，覆蓋半徑加倍、四邊形加 12,288。
 *
 * 【為什麼是 4】四層接到 ±30.7 km。再往外由平的遠海接手，而那個接縫的 5 m
 * 落差在 30.7 km 處是 0.21 px —— 仍在一個像素以內。
 *
 * 【為什麼不是均勻鋪滿】60 m 均勻鋪到 30.7 km 是 2,097,152 個三角形；
 * clipmap 是 106,496。均勻格的成本是半徑的平方，clipmap 是對數。
 */
export const OCEAN_LEVELS = 4

/**
 * 細浪面**整體**的邊長，m。由 clipmap 推導，不是可調參數。
 *
 * 【它現在只有一個用途】`ocean.test.ts` 拿它與 FAR_SEA_SIZE 比，確認遠海
 * 真的遠大於細浪面。
 */
export const OCEAN_SIZE
  = OCEAN_BASE_CELL * 2 ** (OCEAN_LEVELS - 1) * OCEAN_RING_SEGMENTS

/**
 * 網格中心吸附的間距，m。**由 clipmap 推導，不是可調參數。**
 *
 * 【為什麼是最外層的格距】它被每一層的格距整除（各層逐層加倍），所以一次
 * 吸附就讓四層同時落在自己的格點上 —— 見 `update`。
 */
export const OCEAN_SNAP = OCEAN_BASE_CELL * 2 ** (OCEAN_LEVELS - 1)

/**
 * 頂點位移的頻帶限制窗，單位是波長的倍數。**格子小於 `LO × λ` 完全保留，
 * 大於 `HI × λ` 完全拿掉。**
 *
 * 【上界 0.5 是 Nyquist，不是美學選擇】格子等於半波長就是取樣的硬上限，
 * 再粗只會得到混疊。
 *
 * 【為什麼下界放到 0.35 —— 這一輪要的正是折角】舊值 0.2 的立意是「正弦波
 * 用直線接起來，要五個點以上才看不出折角」。低多邊形的海要的就是那個折角，
 * 所以窗往上推，讓 60 m 的格子留得住 165 m 的波（0.36λ）。
 *
 * 【它是徑向連續的，不是逐層常數】頂點著色器算的是
 * `vCell = max(baseCell, 離中心的距離 / 64)` —— 兩層交界上同一點兩層算出
 * 同一個值，淡出量因此逐位元一致，交界不會有高低差。
 *
 * 於是每一道波有一個「消失半徑」`HI × λ × 64`：380 m 那道撐到 12,160 m，
 * 165 m 那道到 5,280 m。**格子變粗與浪變平是同一件事的兩面** —— 遠處是大
 * 而平的面，近處是小而有起伏的面。接到平的遠海不必新增邊界處理。
 *
 * 【與 `gerstnerHeight` 的差異】CPU 那一份**不做**這個淡出，它永遠是完整的
 * 三道波。相機附近淡出量是 0，兩者逐位元相同；遠處才分家。而讀它的是水柱、
 * 殘骸、碎片入水 —— 那些都發生在相機附近。**碰撞不讀它**（海面是平的，
 * 見 `world/seaCrash.ts`）。
 */
export const OCEAN_VERT_FADE_LO = 0.35
/** 見 OCEAN_VERT_FADE_LO。 */
export const OCEAN_VERT_FADE_HI = 0.5

/**
 * 遠海的邊長，m。**這是一片平的四邊形，不是網格。**
 *
 * 【為什麼是 3,000 km 的半邊】這個世界的海是平的，幾何地平線永遠是與海面
 * 平行的那條視線（世界仰角 0°），與高度無關。但這片四邊形是有限的，它的邊
 * 落在 `atan(離海高度 / 半邊)` —— **那才是畫面上實際看到的那條地平線**。
 * （那是上界：朝正方形的**角**看時距離是 `半邊 × √2`，俯角更淺。）
 *
 * 像素數用 `(H/2)·tanθ / tan(FOV_v/2)`，1080p / 65°：
 *
 * ```
 * 相機高度    半邊 250 km        半邊 3,000 km
 *  1,000 m   0.230°（3.4 px）   0.019°（0.28 px）
 *  6,000 m   1.376°（20.4 px）  0.115°（1.7 px）
 * 12,000 m   2.751°（40.7 px）  0.229°（3.4 px）
 * ```
 *
 * 250 km 時那條線在上帝視角的極端高度下低了 40.7 px，而且隨高度移動。以前
 * 看不出來是因為霧把它糊掉了；海面不吃霧之後（見下面兩個材質的 `fog: false`）
 * 它會變成 L 0.060 對 L 0.431 的硬階
 * （spec `2026-08-09-sky-sea-horizon-design.md` §3）。
 *
 * 【這是近似，不是精確】有限平面永遠做不到精確落在幾何地平線。要精確就得換
 * 成相機相對的程序化海面或 clip-space 的解法 —— 那是另一個量級的改動。現況
 * 與目標之間差了一個數量級，先把數量級拿掉。
 *
 * 【遠平面要跟著動】`CAMERA_FAR` 必須大於半對角線 4,243 km，見 `scene.ts`。
 *
 * 【為什麼不必分段】它是平的，分段沒有任何意義。
 */
export const FAR_SEA_SIZE = 6_000_000

/**
 * 遠海的高度，m。
 *
 * 【為什麼是負的】五道波的振幅和是 4.673 m，細浪面的最低點因此是 −4.673。
 * 遠海放在 0 會在波谷之間穿插、產生 z-fighting。放在 −5.0 保證它在 ±5 km
 * 的範圍內**永遠被細浪面蓋住**，餘裕 0.33 m。
 *
 * 【2026-08-26 由 −4.5 降到 −5.0】振幅 ×1.45 之後 −4.5 已經在波谷之上，
 * 會穿插。**這一行與 WAVES 的振幅是綁死的** —— 動振幅就要回來重算。
 *
 * 【接縫的可見度】5.0 m 的落差在 5 km 外張角 1.0 mrad（0.057°）。
 * 1440p / 65° FOV 的一個像素是 0.045°，所以是 1.27 px；改動前的 4.5 m 是
 * 1.14 px。**已經不在一個像素以內了**，貼海低飛時可能看得出一條細線。
 *
 * 實務上還沒看到（2026-08-26 的八張凍結姿態都沒有），因為那條線落在碎光
 * 與反射最亮的區帶裡。真要根治得讓遠海也跟著浪起伏，而那是相機為中心的
 * LOD 那一輪的事。
 */
export const FAR_SEA_Y = -5.0

/**
 * 海的基本色。細浪面與遠海**必須共用**這一個值 —— 兩份會漂開，而漂開的
 * 症狀是 5 km 處出現一條色帶。
 *
 * 【2026-08-26 維持深色海 + 地平線淺色漸層】負責人試過亮海（0x3d7db0）後
 * 決定：海本色**維持原本的深藍** 0x18344c（2026-08-10 壓深的值不動），只讓
 * 最貼地平線的 0~5 度融向天空淺藍（見 SEA_AERIAL_HI、以及 SPARKLE_FRAGMENT
 * 末的最終色 mix）。因為本色沒變、漸層只在極窄的地平線帶，fog.test 的海天差
 * 幾乎不受影響。
 *
 * 【這是 base color，不是畫面上的像素】海面走 `MeshPhysicalMaterial`，實際
 * 亮度還要過一次 PBR 著色，比這個值亮。
 */
export const SEA_COLOR = 0x18344c

/**
 * 海面的粗糙度。**細浪面與遠海必須共用這一個值**（同 `SEA_COLOR` 的理由 ——
 * 兩份會漂開，症狀是 5 km 處出現一條亮度帶）。
 *
 * 【2026-08-11 量過一輪，維持 0.72】曾試過調到 0.10 —— GGX 的高光峰值是
 * `D_max = 1/(π·roughness⁴)`，0.72 只有 1.18，等於高光被攤到不存在，所以海
 * 看起來只有霧面漫射。降到 0.10 峰值變 2687×，面確實會變成太陽白。
 *
 * 但接著量出兩件事，所以這條路沒有繼續走：
 *
 * 1. **亮區被面的傾角鎖死**。52 m 的面法線是頂點差分，傾角中位 1.82°／最大
 *    5.00°，所以能亮的視線範圍只有鏡面點附近 ±10°。再調 roughness 只會讓
 *    每個面變暗，換不到面積（0.20 → 面積 1.71× 但峰值剩 6%）。
 * 2. **改用解析法線也不會變多，只會攤開**。實測白點總量 0.93×，正中心的密度
 *    反而掉到 0.27× —— 面積 2.58× 是把同樣多的白鋪得更稀。
 *
 * 所以走噪聲那條路（見 `SPARKLE_*`）：用解析法線算「這塊水面多接近鏡面」當
 * **密度場**，顆粒大小交給噪聲，兩者解耦。這裡就維持原值不動。
 */
export const SEA_ROUGHNESS = 0.72

/**
 * 鏡面反射的總量倍率。**細浪面與遠海必須共用**（同 SEA_COLOR 的理由）。
 *
 * 【為什麼要換成 MeshPhysicalMaterial —— 2026-08-11】`MeshStandardMaterial`
 * 把介電質的 F0 寫死成 `vec3(0.04)`（three 的 lights_physical_fragment 第 47
 * 行），沒有任何參數能改。0.04 是「一般介電質」（IOR 1.5，玻璃／塑膠）的值，
 * 海面因此反射得像塑膠。只有 physical 分支吃 `ior` 與 `specularIntensity`。
 *
 * 【為什麼用 specularIntensity 而不是 ior】專案負責人要的是「少一半」。
 * `specularIntensity` 同時縮 F0 與 F90
 * （`specularF90 = mix(specularIntensity, 1.0, metalness)`），所以每個角度
 * 都是同一個比例 —— 實測 0.5 在 2°～60° 俯角一律降 47%。
 *
 * 改 `ior` 到水的正確值 1.333 只縮 F0、不縮 F90，而 Fresnel 在掠射角由 F90
 * 主導 —— 那正是遠海最亮的地方。實測只降 23%（2°）到 49%（60°），而且兩者
 * 疊起來會在陡角過切到 58～71%。所以這裡不動 ior。
 *
 *   俯角        現況      si 0.5
 *     2°      0.0861    0.0452 (−47%)
 *    20°      0.0459    0.0241 (−47%)
 *    60°      0.0280    0.0147 (−47%)
 */
export const SEA_SPECULAR = 0.5

/**
 * 太陽方向（由海面**指向太陽**的單位向量）。
 *
 * 【這是一份複本，不是權威 —— 2026-08-11 實驗】權威在 `scene.ts:61` 的
 * `DirectionalLight.position`。兩份會漂開，症狀是「反光在這裡、陰影在那裡」，
 * 而畫面上沒有任何東西會紅。ocean.ts 不能 import scene.ts（那會讓海依賴整個
 * 場景），正解是把太陽抽成獨立的 `sun.ts` 葉節點 —— 那是 ocean-glint 計畫的
 * Task 1。這個實驗定案時必須一起收掉。
 */
const SUN_DIR: readonly [number, number, number] = (() => {
  const [x, y, z] = [-0.4, 0.8, 0.45]
  const m = Math.hypot(x, y, z)
  return [x / m, y / m, z / m]
})()

/**
 * 太陽碎光的參數。**全部是待驗收的暫定值。**
 *
 * 【為什麼是噪聲而不是靠面法線】見 `SEA_ROUGHNESS` 的註解：靠 52 m 的面去
 * 中鏡面條件，白點總量被幾何鎖死，改法線也只是攤開不會變多。這裡把兩件事
 * 拆開 ——
 *
 *   解析波法線 → 「這塊水面有多接近鏡面」，是**密度場**（大尺度，跟著浪動）
 *   hash 噪聲   → 「這塊裡哪些點亮」，是**顆粒**（小尺度，想多細就多細）
 *
 * 所以白點不是貼上去的假效果：密度完全由真實的入射／反射幾何決定，只有
 * 「哪一顆」交給噪聲。
 */
/**
 * 碎光的角度容差（弧度）—— 面法線與半角向量差多少之內還算「對準太陽」。
 *
 * 【為什麼是常數】面法線就是**真實的幾何法線**，沒有「解析不出來的坡度」
 * 要折進 σ。那個補償是逐像素解析波形時才需要的：那時法線只到某個尺度，
 * 更細的起伏得用一個統計量代表。低多邊形沒有那個問題 —— 面就是面。
 *
 * 【它決定亮區的大小與選擇性】亮區的角半徑正比於 σ（高斯的引數是 θ²/2σ²），
 * 所以要把太陽反光的範圍擴散幾倍，就把它乘幾倍。代價是方向選擇性 —— σ 太大
 * 會變成「相機正下方一圈都在亮」而不是一條太陽的反光帶。
 * 實測（2026-08-11，σ 為常數時的正下方／鏡面點對比）：
 *
 *   σ      正下方   鏡面點   對比
 *   12°    0.703    1.000    1.4×   ← 選擇性沒了，亮區變成相機正下方的圓
 *    8°    0.453    1.000    2.2×
 *    4°    0.105    1.000    9.5×
 *
 * 【4.5° 是專案負責人指定「往外擴散三倍」】從 1.5° 乘三。它落在上表 4° 那
 * 一列旁邊，對比仍有 9 倍上下 —— 亮區明顯變大而反光帶還認得出是一條帶。
 * 再往上就開始往 8°（2.2×）掉，那時亮區會變成正下方的一個圓。
 *
 * 【寬核另外給】鏡面圈之外的零星白點由 `SPARKLE_SIGMA_TAIL` 那個寬核負責，
 * 兩者用 `mix` 疊起來 —— 見 `SPARKLE_TAIL_WEIGHT`。
 */
export const SPARKLE_SIGMA_BASE = (4.5 * Math.PI) / 180
/**
 * 尾巴核的角度容差（弧度）。與 `SPARKLE_SIGMA_BASE` 那個核疊成雙核。
 * **它是固定的** —— 尾巴代表 Cox-Munk 的厚尾，那是超出高斯模型的部分，與
 * 「解析到多少道波」無關。窄核負責隨距離變化的那一半。
 *
 * 【為什麼要有尾巴】真實海面任何一塊都有非零機率把太陽鏡射進眼睛 —— 波坡度
 * 分佈（Cox-Munk 1954，航照實測）在 7 m/s 風速下 RMS 傾角約 11°，而且比高斯
 * 厚尾（要加 Gram-Charlier 修正才對得上）。單核衰減得極陡 —— σ 4° 時偏離
 * 10° 還有 1.8% 的亮格，15° 剩 3.7e-4，**18° 之後低於 1e-5**，鏡面圈之外就是
 * 一顆白點都沒有。（float32 的 `exp` 真正 underflow 要到 55°，但那不是關鍵：
 * 機率早在 18° 就掉到看不見了。）
 *
 * 【為什麼不是把窄核的 σ 直接調大】見上面那張表：σ 一大，方向選擇性就
 * 沒了，亮區變成相機正下方的圓。雙核把兩件事分開 —— 窄核保住選擇性，寬核只
 * 用 `SPARKLE_TAIL_WEIGHT` 那麼一點權重把尾巴鋪開。
 */
export const SPARKLE_SIGMA_TAIL = (25 * Math.PI) / 180
/**
 * 尾巴核在雙核裡的權重。
 *
 * 【用 mix 不用加法】兩個高斯在鏡面點都恰好是 `exp(0) = 1`，所以 `mix` 在中心
 * 必然回到 1 —— 鏡面圈的密度**嚴格**不變，不是「差幾個百分點看不出來」。加法
 * 會讓中心變成 `1 + w`，還得再去歸一化。
 *
 *   偏離鏡面點   窄核     寬核     mix 後    亮格比例
 *      0°       1.000   1.000    1.000     40.0%   ← 與單核時相同
 *     10.1°     0.042   0.922    0.068      2.7%   ← 相機正下方
 *     25°       0       0.611    0.018      0.7%
 *     45°       0       0.215    0.006      0.3%
 *     60°       0       0.072    0.002      0.1%
 *     90°       0       0.005    0.0002    0.006%  ← 背對太陽
 *
 * 鏡面點對正下方的對比是 14.7×（單核時 23.8×）—— 選擇性還在，亮區不會跑到
 * 正下方。
 */
export const SPARKLE_TAIL_WEIGHT = 0.03
/** 完全對齊時有多少比例的格子會亮。 */
export const SPARKLE_DENSITY = 0.4

/**
 * **浪峰偏置**：白點在浪峰出現的機會比浪谷高多少。
 *
 * ```
 *   p *= 1 + SPARKLE_CREST_BIAS × clamp(高度 / SPARKLE_CREST_REF, −1, 1)
 * ```
 *
 * 0 = 關掉；0.8 = 浪峰 1.8 倍、浪谷 0.2 倍，比值 9:1。**上限是 1**（到 1
 * 浪谷歸零）。
 *
 * 【為什麼不是純美術】鏡面條件只看**坡度**，所以碎光原本落在浪的**側面**，
 * 峰與谷（坡度 0）機會相同。真實海面不是這樣：長浪會調變短波的能量，短波
 * 在浪峰與迎風面變密變陡、在浪谷被壓抑 —— 這叫流體動力調變，雷達拍得到海浪
 * 就是靠它。所以偏置補的是「模型裡沒有的那一層物理」，不是硬加的效果。
 *
 * 【總量不變】高度的均值是 0，而偏置對高度是**奇函數**，所以整片海的白點
 * 總數不變 —— 只是從浪谷搬到浪峰。`SPARKLE_DENSITY` 的觀感不受影響。
 *
 * 【幾乎不用錢】高度用的 `sin(ph)` 是 drift 那一行已經算過的，只多一次乘加。
 */
export const SPARKLE_CREST_BIAS = 0.8

/**
 * 見 `SPARKLE_CREST_BIAS`。偏置從浪谷過渡到浪峰的**半寬**，m。高度超過它
 * 就飽和成全峰或全谷。
 *
 * 【由波幅推導，不是定值】取 `WAVES` 高度 RMS（`√Σ(A²/2)` = 1.58 m）的一半
 * —— 浪一改大，過渡半寬跟著改大，偏置的**相對強度**才不會漂。
 *
 * 【為什麼要讓它飽和】實際高度典型 RMS 約 1.1 m（另外還吃浪群包絡
 * `WAVE_ENV_LO`），所以 ±0.79 m 之外會踩到 clamp —— 那是刻意的：不飽和的話
 * 偏置只是個很淺的漸層，量到的白點平均高度只搬 0.09 m；飽和之後搬 0.28 m，
 * 接近這個機制的上限。
 *
 * 【上限來自鏡面條件本身】再往下調參考也只到 0.30 m 就不動了。鏡面條件把
 * 機率壓在坡度大的**側面**，而側面的高度≈0、乘上偏置還是 1 —— 偏置只能在
 * 上側面與下側面之間搬，搬不到浪峰正上方。要再強就得動鏡面條件，那是另一
 * 件事。
 */
export const SPARKLE_CREST_REF
  = Math.sqrt(WAVES.reduce((s, w) => s + (w.amplitude * w.amplitude) / 2, 0)) / 2
/**
 * 重擲頻率，Hz。真實波的週期是 6～16 s，靠波自己動不會「閃」。
 *
 * 【它同時決定單次閃爍的長度】一輪就是一次完整的淡入淡出，長度是
 * `1 / (rate · twinkle)`，而 `rate` 每個面落在 0.6～1.4 —— 0.68 對應
 * **1.05～2.45 s**。這個範圍不分密度高低都一樣。
 */
export const SPARKLE_TWINKLE = 0.68
/** 亮面的亮度。> 1 會被截成純白 —— 那正是要的。 */
export const SPARKLE_STRENGTH = 0.6
/**
 * 淡入淡出包絡 `sin(u·π)` 的指數。1 就是純正弦；小於 1 更方（亮得久、進出
 * 較急），大於 1 更尖（只有中段看得見）。**值越大越不柔**，所以它叫指數而
 * 不叫柔化。
 *
 * 【它會平移 SPARKLE_DENSITY 與 SPARKLE_STRENGTH 的觀感】同時亮著的面的
 * 比例由機率 `p` 決定，但每個亮面的**平均亮度**由包絡決定：
 * `∫₀¹ sin(πu)^0.9 du = 0.657`。所以同一個 `SPARKLE_DENSITY` 在這個包絡下的
 * 總能量，比亮度均勻分佈（平均 0.5）的情形高 31%。三個常數都是待人工驗收的
 * 暫定值，驗收時要一起看。
 */
export const SPARKLE_ENVELOPE_POW = 0.9

/**
 * 逐面色調的擾動幅度。每個三角面依自己的 id 在 `1 ± FACE_TINT` 之間取一個
 * 亮度倍率。
 *
 * 【這是低多邊形的主要訊號，不是法線】相鄰面的法線只差約 12°（島是幾十度），
 * 海太平了 —— 光靠 flatShading 做不出稜角感，色調才做得出來。
 *
 * 【上界由「看得出是面」與「看起來像雜訊」夾出來】太小則面之間分不開、
 * 整片仍是一塊；太大則海變成馬賽克。0.06 是起始值，由截圖裁定。
 */
export const FACE_TINT = 0.09

/**
 * 浪峰提亮：面的重心高度換算成 `±FACE_CREST_LIFT` 的亮度偏置。
 *
 * 【與碎光的浪峰偏置是兩件事】那一個決定白點**出不出現**（機率），
 * 這一個是每個面都有的連續明暗，讓浪的形狀在沒有白點的地方也看得出來。
 * 兩者共用同一個 `SPARKLE_CREST_REF` 當尺度。
 */
export const FACE_CREST_LIFT = 0.10

/**
 * 碎光的淡出區間，m。
 *
 * 【它擋的不是「塊太小」，也不是法線混疊】前者由 LOD 負責 —— 塊的螢幕張角
 * 是常數，任何距離都是 18 px；後者由 footprint 淡出負責 ——
 * 地平線附近一個像素橫跨的距離範圍極大，所有波都會轉成 σ、`N` 收斂到 +Y，
 * 混疊自己就沒了。所以這一層不必砍在遠海剛開始的地方（遠海從 5 km 起），砍
 * 在那裡只會讓遠海上剩一條窄帶。
 *
 * 剩下的職責是**讓碎光在海天交界之前收乾淨**，免得地平線上壓著一條亮邊。
 *
 * 【它同時是效能的關卡】fragment 那一段一開始就先算 fade，等於 0 就整段跳過
 * ——見 SPARKLE_FRAGMENT 的註解。
 */
/**
 * 碎光隨距離變暗的區間與下限。**這一層不是淡出，是衰減到一個底線。**
 *
 * 【為什麼需要】海面 `fog: false`（見兩個材質的註解），所以碎光完全不吃大氣
 * 消光 —— 20 km 外的一塊反光和眼前那塊一樣白。真實的遠處反光要穿過整段大氣
 * 才到眼睛，散射把它稀釋掉，對比也被前向散射的氣柱壓平。
 *
 * 【為什麼不直接開霧】霧色由天空色推導，一開就是整片海往天空靠 —— 那正是
 * 2026-08-09 裁定 `fog: false` 要擋的「近到遠的顏色變化」。這一層只作用在
 * 碎光的加法項上，海的**基色**一個字都不動，所以那條裁定仍然成立。
 *
 * 【為什麼有下限而不是歸零】歸零是 `SPARKLE_FADE_*` 的職責，而它守的是海天
 * 交界。這一層要的是「遠方的反光沒那麼刺眼」，不是「遠方沒有反光」——
 * 0.25 之後仍看得見塊的形狀，只是不再搶戲。
 */
export const SPARKLE_ATTEN_NEAR = 2000
/** 見 `SPARKLE_ATTEN_NEAR`。 */
export const SPARKLE_ATTEN_FAR = 20000
/** 見 `SPARKLE_ATTEN_NEAR`。遠處保留的亮度倍率。 */
export const SPARKLE_FAR_DIM = 0.25

export const SPARKLE_FADE_START = 60000
export const SPARKLE_FADE_END = 250000

/**
 * 海面基色的方位明暗 —— `smoothstep` 的下端點。**暫定值，待人工驗收回填。**
 *
 * 【為什麼需要這一層】場景只有三盞燈（`scene.ts:69-73`），對海面全都是方位
 * 無關的常數：海面法線幾乎是 +Y，所以 `DirectionalLight` 的 N·L 恆為 0.80、
 * `HemisphereLight` 的垂直梯度取的恆是天頂那一端、`AmbientLight` 是常數，
 * 而且沒有 envMap。天空（`sky.ts`）也只吃 `vDir.y`、沒有方位角。整個世界在
 * 方位上是對稱的，唯一透露太陽在哪的只有陰影、微弱的 GGX 高光與碎光。
 *
 * （細浪面是 `flatShading`，面法線被浪斜到最多 5.00°，所以「恆是天頂那一端」
 * 對它是近似、對遠海才是精確。方位無關這個結論兩邊都成立。）
 *
 * 現實裡順光的海是深藍、逆光的海是銀白，兩個成因：大氣 Mie 散射的前向峰讓太陽
 * 那半邊的天空亮 5～15 倍，而海面是一面朝天的鏡子；水體懸浮粒子的散射相函數
 * 同樣是前向峰，順光看到的是較弱的後向散射。實拍上兩者疊起來約 1.5～3 倍，
 * 這裡取偏保守的那一端。
 *
 * 【必須用平坦法線，不能用波法線】拿解析波法線去調基色，整片海的顏色會跟著浪
 * 呼吸 —— 那是雜訊不是深淺差。平坦法線是 +Y，所以 `dot(vec3(0,1,0), H)` 就是
 * `H.y`：省一次 dot，而且在數學上就不可能抖。
 *
 * 【為什麼是 smoothstep 不是高斯】`H.y` 的實際動態範圍只有 0.446（俯角 0° 背
 * 對太陽）到 0.998（俯角 60° 面朝太陽），高斯在那一段太平 —— σ 60° 只拉得出
 * 12% 的明暗差。smoothstep 的兩個端點直接落在實際範圍上，可控得多。
 *
 * 【這組值是針對現在寫死的 SUN_DIR 校的】太陽仰角 53.0°。`ocean-glint` 的
 * Task 1 把太陽抽成 `sun.ts` 之後若讓它可動，這兩個端點要重驗。
 *
 * 【與 fog.ts 的關係】`fog.ts` 檔頭記著「方向相依的霧色，那是另一份 spec」——
 * 同一族的想法。海面 `fog: false`，所以這裡不會與霧打架。
 */
export const SEA_DIM_LO = 0.45
/** 見 `SEA_DIM_LO`。 */
export const SEA_DIM_HI = 0.95
/**
 * 背對太陽側的漫射倍率下限。**暫定值，待人工驗收回填。** 俯角 20° 下：
 *
 *   相機視線方位    H.y      倍率
 *   面朝太陽      0.959     1.00
 *   側 90°        0.715     0.83
 *   背對太陽      0.595     0.70
 *
 * 【只乘 diffuseColor，不乘 gl_FragColor】這樣調到的幾乎只有漫射：GGX 高光
 * 本來就有自己的方向性，碎光是在 `opaque_fragment` 之後才加上去的，兩者都不
 * 受影響。
 *
 * 【「幾乎」是因為 metalness 0.05】three 的 `lights_physical_fragment` 把 F0
 * 寫成 `mix(介電質項, diffuseColor.rgb, metalnessFactor)`，所以有 5% 的 F0
 * 來自 albedo。背光側的 F0 因此由 0.0227 掉到 0.0213（−6%）—— 量級上可忽略，
 * 但不是零。
 */
export const SEA_DIM_FLOOR = 0.62

/**
 * 塊與波的明暗增益 —— **目前是 0，這一層關閉。**
 *
 * 【為什麼關掉 —— 2026-08-25 人工判定】`N` 主要由波法線決定，而波是正弦的
 * 疊加，所以這一層的明暗會沿波形成**規則的橫條紋**。高空俯視最明顯：那裡短
 * 波全被 Nyquist 淡掉，只剩最長的幾道，圖樣最規則。專案負責人的判定是條紋
 * 比明暗的收益重要，海面只留黑白塊。
 *
 * 【要重新開啟的話】得先解決「明暗的尺度被波的規則性綁死」這件事 —— 例如讓
 * 它只吃 `tilt`（塊的尺度）而不吃波法線。直接調回 1.5 條紋就會回來。
 *
 * 以下是這一層原本要做的事，機制仍然成立：
 *
 * 【為什麼海面現在只會變亮不會變暗】three 的 PBR 用的是幾何法線。細浪面是
 * `flatShading`，面法線由 52 m 的三角面差分而來，傾角中位 1.82°／最大 5.00°
 * （見 `SEA_ROUGHNESS`）—— 水面的漫射因此幾乎是一個平面。而 `SPARKLE_FRAGMENT`
 * 裡那個帶著微波與塊傾斜的 `N` **從來沒有進過光照鏈**，它只餵給碎光的 align。
 * 於是唯一的變化是加法項：塊亮起來，但沒有任何一塊會暗下去。
 *
 * 【一階差就夠】不必把 `normal` 整個換掉（那要把波迴圈搬到
 * `normal_fragment_begin`，而那一段是每個像素都跑、沒有 fade 的 early-out）。
 * `dot(N, L) − L.y` 是「這塊相對於平坦水面多接收／少接收多少直射光」，乘上
 * 增益直接調變已經著色好的顏色即可。
 *
 * 【近處與遠處自動是兩件事，而式子只有一條】近處波全部解析，`N` 的變化來自
 * 波本身 —— 看到的是**浪的明暗面**，連續的。遠處波全部因 Nyquist 淡出、`N`
 * 的變化來自 `tilt` —— 看到的是**塊的明暗面**。
 *
 * 【量級】太陽仰角 53°、總坡度 RMS 11° 時 `dNL` 落在 −0.130～+0.100，1.5 的
 * 增益會給出 −20%～+15% 的明暗，整體平均暗 2.2%。
 */
export const SEA_SHADE_GAIN = 1.5

/**
 * 水面反射天空的 F0（垂直入射的反射率）。

 * 【為什麼是 0.020】菲涅耳的正入射反射率 `F0 = ((n1 − n2) / (n1 + n2))²`，
 * 空氣 1.000 對水 1.333 得 0.0204。**這是物理值，不是可調參數。**
 *
 * 【它與材質的 `specularIntensity = 0.5` 是兩件事】那一個管的是 three 的
 * PBR 高光（太陽的 GGX 反光），負責人 2026-08-11 裁定「少一半」。這裡管的是
 * **反射整片天空**，而那是海面在掠射角看起來的主要成分 —— 兩者疊在一起才是
 * 完整的水面反射。
 */
export const SEA_REFLECT_F0 = 0.020

/**
 * 天空反射的總量倍率。1 = 完整的菲涅耳。
 *
 * 【為什麼需要這個旋鈕】完整的菲涅耳在掠射角會逼近 1，海面幾乎變成鏡子。
 * 那在物理上正確，但這個專案的海是 low-poly 的深藍，整片翻成天空色會失去
 * 身分。這個倍率讓「亮起來多少」變成美術決定。
 */
export const SEA_REFLECT_STRENGTH = 0.7

/**
 * 海面大氣透視（aerial perspective）：遠處海色往**天空地平線色**靠攏，
 * 近深遠淺、柔和融入天空。
 *
 * 【推翻了什麼】2026-08-09 的「海面 `fog: false`、海天靠硬色差」是刻意的
 * low-poly 選擇；2026-08-25 負責人看了參考圖後裁定改走空氣感。這不是把
 * fog 改回 false 的理由，要改先問。
 *
 * near 之內幾乎不動（保留近處深海）、far 之外融滿。strength < 1 讓遠海
 * 接近但不完全等於天空色，留一點海的身分。三個值都靠試飛定。
 */
/**
 * 【用仰角，不是距離】漸層只該出現在**接近海天交界**那一條 —— 也就是視線
 * 掠射、幾乎貼著水面的地方。用距離做會把整片中遠海都糊成一層霧（實測
 * 2026-08-25：負責人回報「像貼了一層霧氣」）。`oceanV.y` 是視線與水平面
 * 夾角的 sin：HI 之上（較陡、往下看）完全不融，LO 之下（接近水平、掠向
 * 仰角驅動，只在最貼地平線那一條。0.052 ≈ 俯角 3°、LO = 0（融滿在地平線）：
 * 從地平線連續漸進到 3°。融向 uHorizonColor（#3d5975，接近海色的中深藍灰），
 * STRENGTH 0.3 壓淡 —— 對比小、含蓄。（大範圍「近深遠淺」2026-08-26 試過否決。）
 */
export const SEA_AERIAL_HI = 0.052
export const SEA_AERIAL_LO = 0.0
export const SEA_AERIAL_STRENGTH = 0

/** 最長那道波的波長，m。著色器的早退用 —— 見 `oceanWaveHeight`。 */
const LONGEST_WAVE = WAVES.reduce((a, w) => (w.wavelength > a ? w.wavelength : a), 0)

/**
 * 頂點與片段共用的宣告。兩個材質都要。
 *
 * 【為什麼波高是一支函數而不是兩段抄寫】頂點著色器要它算位移、片段著色器要它
 * 算面重心的高度（白點的浪峰偏置吃那一個）。兩份會漂開，而漂開的症狀是
 * 「白點跑到浪谷去」—— 沒有任何測試守得住。
 */
const SPARKLE_COMMON = /* glsl */ `
  uniform float uTime;
  uniform vec2 uOrigin;
  uniform vec2 uWaveDir[${WAVES.length}];
  uniform float uWaveAmp[${WAVES.length}];
  uniform float uWaveLen[${WAVES.length}];
  uniform float uWaveSpd[${WAVES.length}];
  uniform vec3 uSunDirection;
  uniform float uCrestBias;   // 見 SPARKLE_CREST_BIAS
  uniform float uCrestRef;
  uniform float uSigmaBase;
  uniform float uSigmaTail;
  uniform float uTailWeight;
  uniform float uDimLo;
  uniform float uDimHi;
  uniform float uDimFloor;
  uniform float uDensity;
  uniform float uTwinkle;
  uniform float uSparkleStrength;
  uniform float uEnvelopePow;
  uniform float uFaceTint;
  uniform float uFaceLift;
  uniform vec3 uSkyHorizon;
  uniform vec3 uSkyZenith;
  uniform float uSkyPower;
  uniform float uReflectF0;
  uniform float uReflectStrength;
  uniform vec3 uWarp;   // x: 振幅 m, y: 波數 A, z: 波數 B
  uniform float uWarpSpd;
  uniform vec3 uWarp2;  // x: 振幅 m, y: 波數 A, z: 波數 B
  uniform vec3 uEnv;    // x: 展幅, y: 波數 A, z: 波數 B
  uniform float uEnvLo;
  uniform float uBaseCell;
  uniform float uHalfSeg;
  uniform float uInvHalfSeg;
  uniform float uVertFadeLo;
  uniform float uVertFadeHi;
  uniform float uShadeGain;
  uniform float uAttenNear;
  uniform float uAttenFar;
  uniform float uFarDim;
  uniform float uFadeStart;
  uniform float uFadeEnd;
  uniform float uAerialHi;
  uniform float uAerialLo;
  uniform float uAerialStrength;
  uniform vec3 uHorizonColor;
  varying vec3 vOceanWorld;

  // 座標扭曲。**與 ocean.ts 的 waveWarp 必須逐字相同** —— 那是 CPU 的
  // 那一份，水柱與殘骸入水讀它。設計理由見 WAVE_WARP_AMP 與 WAVE_WARP2_AMP。
  vec2 oceanWarp(vec2 p, float time) {
    float t = time * uWarpSpd;
    return vec2(
      sin(p.y * uWarp.y + t * uWarp.y) * uWarp.x
        + sin(p.x * uWarp2.y - t * uWarp2.y + 1.7) * uWarp2.x,
      sin(p.x * uWarp.z - t * uWarp.z) * uWarp.x
        + sin(p.y * uWarp2.z + t * uWarp2.z + 4.1) * uWarp2.x
    );
  }

  // 浪高包絡的底層場，值域 [-1, 1]。**與 waveEnvField 必須逐字相同**
  float oceanEnvField(vec2 p, float time) {
    float t = time * uWarpSpd;
    return sin(p.x * uEnv.y + t * uEnv.y) * sin(p.y * uEnv.z - t * uEnv.z * 0.7);
  }

  // 第 i 道波的振幅倍率。**與 waveEnv 必須逐字相同**
  float oceanEnv(float g, float i) {
    float u = 0.5 + 0.5 * sin(g * uEnv.x + i * 2.399963);
    return uEnvLo + (1.0 - uEnvLo) * u;
  }

  /**
   * 這裡的格子多大。**由離中心的距離推得，不是查這個頂點屬於第幾層** ——
   * 兩層交界上同一點兩層算出同一個值，淡出量因此逐位元一致，交界不會有高低差。
   */
  float oceanVCell(vec2 local) {
    return max(uBaseCell, length(local) * uInvHalfSeg);
  }

  /**
   * 未位移座標 rawXZ 處的浪高。vCell 決定哪幾道波在這裡還表現得出來。
   *
   * 【網格表現不出來的波，從幾何裡拿掉】見 OCEAN_VERT_FADE_LO。上界 0.5 是
   * Nyquist（格子＝半波長），是硬上限不是美學選擇。
   */
  float oceanWaveHeight(vec2 rawXZ, float vCell) {
    // 【格子粗過最長那道波就一定是平的，先收】遠海的每一個片段都會走這裡
    // （逐面的重心高度），而淺俯角時遠海是大半個畫面。收掉之後那裡只剩
    // floor/fract 與兩次 hash，九次 sin 一次都不跑。
    if (vCell >= ${LONGEST_WAVE.toFixed(1)} * uVertFadeHi) return 0.0;
    vec2 p = rawXZ + oceanWarp(rawXZ, uTime);
    float envG = oceanEnvField(rawXZ, uTime);
    float h = 0.0;
    for (int i = 0; i < ${WAVES.length}; i++) {
      float k = 6.28318530718 / uWaveLen[i];
      float lod = 1.0 - smoothstep(
        uWaveLen[i] * uVertFadeLo, uWaveLen[i] * uVertFadeHi, vCell);
      h += uWaveAmp[i] * oceanEnv(envG, float(i)) * lod
        * sin(k * dot(uWaveDir[i], p) - uWaveSpd[i] * k * uTime);
    }
    return h;
  }

  /**
   * 【不用 sin 型的 hash】fract(sin(dot(p, k)) * 43758.5) 在大座標下會壞：
   * 格號到 10⁴ 時 sin 的引數約 4×10⁶，而 float32 在那裡的 ulp 是 0.25 ——
   * 引數本身已經量化，輸出會出現規則結構而不是噪聲。這一版（Hoskins）
   * 全程只用 fract 與乘法，不吃三角函數的相位精度。
   */
  float oceanHash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }
`

/**
 * 疊在 `color_fragment` 之後 —— **必須排在 `SPARKLE_FRAGMENT` 之前**。
 *
 * 【四個視線量刻意宣告在 block 外】碎光要用的是同一組值，而兩段都展開在
 * `main()` 裡，宣告在這裡後面就看得到 —— 省一次 length、一次除法、一次
 * normalize。半角向量兩邊**完全相同**：基色拿它對平坦法線（`oceanH.y`），
 * 碎光拿它對波法線（`dot(N, oceanH)`），差別只在跟誰內積。
 *
 * 【順帶擋掉一個靜默失效】若 three 日後把 `color_fragment` 改名，這裡的
 * `.replace()` 會 no-op，四個變數從未宣告，而 `SPARKLE_FRAGMENT` 引用它們
 * —— shader 編譯錯誤，會響。共用視線量把「基色悄悄消失」變成「整片海直接
 * 不編譯」，所以這三處注入不需要另外的防呆。
 *
 * 【為什麼沒有距離守衛】碎光可以在 `uFadeEnd` 之外整段跳過，基色不行：它是
 * 每一個海面像素都要的顏色。代價只有一次 smoothstep 與一次 mix。
 */
const SEA_DIM_FRAGMENT = /* glsl */ `
  vec3 oceanToEye = cameraPosition - vOceanWorld;
  float oceanDist = length(oceanToEye);
  vec3 oceanV = oceanToEye / max(oceanDist, 1e-4);
  vec3 oceanH = normalize(oceanV + uSunDirection);

  // 大氣透視的量。**在塊外宣告**，因為碎光那段（SPARKLE_FRAGMENT）也要用它
  // 把交界區的白點沖淡。**用仰角 oceanV.y 而不是距離**：只有視線掠向地平線
  // （oceanV.y 小）才融入天空，中遠海保持本色，不會整片糊成霧。見 SEA_AERIAL_HI。
  float oceanAerial = smoothstep(uAerialHi, uAerialLo, oceanV.y) * uAerialStrength;

  {
    // 平坦法線（+Y）下的半角對齊 —— dot(vec3(0, 1, 0), oceanH) 就是
    // oceanH.y。用波法線會讓整片海的顏色跟著浪呼吸，見 SEA_DIM_LO。
    float lit = smoothstep(uDimLo, uDimHi, oceanH.y);
    diffuseColor.rgb *= mix(uDimFloor, 1.0, lit);
    // 【大氣透視不在這裡】它移到 SPARKLE_FRAGMENT 末的**最終色**去 mix ——
    // 在 albedo 融會被 PBR 光照＋高粗糙度去飽和成灰。這裡只留方位漸層。
  }
`

/**
 * 疊在 `opaque_fragment` 之後（線性空間）。
 *
 * 【為什麼遠海也能用同一段】著色只吃世界座標，與幾何平不平無關 —— 遠海雖然
 * 只有兩個三角形，這裡照樣算得出真實的波法線與色塊。
 */
/**
 * 【`export` 是給測試的】`ocean.test.ts` 的「塊傾斜只餵給碎光」用字串比對
 * 守住哪一條法線餵給誰 —— 改錯不會壞任何數字、不會拋錯，只會讓畫面悄悄
 * 長回高爾夫球凹坑，沒有別的東西守得住。
 */
/**
 * 逐面底色與逐面白點。**兩個材質都用它。**
 *
 * ── 【近海的面是真的，遠海的面是虛擬的 —— 而那正是對的】────────────
 *
 * 近海這一段算出來的格子與 clipmap 實際切出來的三角形**逐一對應**，所以
 * 色塊落在真正的稜線上。
 *
 * 遠海是 128×128 的 PlaneGeometry，一格約 46.9 km —— 它自己的面大到沒有意義。
 * 但那裡本來就看不出高低起伏（浪早就淡光了，見 `OCEAN_VERT_FADE_LO`），
 * 所以**畫一片虛擬的面上去就夠了**：專案負責人 2026-08-28 的裁定。
 *
 * 【接縫是連續的，不必另外處理】`faceCell` 由**離中心的距離**推得，不是查
 * 這個片段屬於哪一層。在近海的外緣（30,720 m）它算出 480 m —— 正好是 L3 的
 * 格距；再往外每個 octave 加倍。虛擬的面因此接著真實的面長下去，同一條式子。
 *
 * 【所以「遠海長出 60 m 假色塊」那個顧慮不成立】那要在格距寫死成 uBaseCell
 * 的前提下才會發生。這裡是距離推的。
 *
 * ── 【`export` 是給測試的】────────────────────────────────────
 *
 * 兩件事沒有別的東西守得住：機率吃的是面的**重心**（用內插高度會把三角形切成
 * 半白半不白），以及對角線與幾何的切法一致。
 */
export const FACE_FRAGMENT = /* glsl */ `
    // ── 這個像素落在哪一個三角面 ────────────────────────────────
    //
    // 【格距要按距離算，不是一律 uBaseCell】四層共用同一顆材質，格距是
    // 60/120/240/480，遠海再往外加倍。一律除以 uBaseCell 的話，L1/L2/L3 的
    // 每一個真實三角形會被切成 4/16/64 個假色塊 —— 而那不會讓任何測試變紅。
    //
    // 【環是方的，所以用 Chebyshev 半徑】第 L 層是半寬 32c 到 64c 的方環
    // （c = uBaseCell × 2^L），所以 r / (uBaseCell × uHalfSeg) 取 log2 再
    // ceil 正好是層號。length() 是圓的，會在方環的角落選錯層。
    vec2 faceLocal = vOceanWorld.xz - uOrigin;
    float faceR = max(abs(faceLocal.x), abs(faceLocal.y));
    float faceCell = uBaseCell
      * exp2(ceil(log2(max(1.0, faceR / (uBaseCell * uHalfSeg)))));

    vec2 faceQ = vOceanWorld.xz / faceCell;
    vec2 faceCel = floor(faceQ);
    vec2 faceT = faceQ - faceCel;
    // 【對角線】clipmapLevelGeometry 的索引是 a,c,b 與 b,c,d，切線落在
    // tx + tz = 1。寫反的話色塊會與稜線錯開半格，看起來像兩層網格在打架，
    // 而那**不會讓任何測試變紅** —— 唯一守得住它的是截圖。
    float faceTri = step(1.0, faceT.x + faceT.y);
    float faceId = oceanHash(faceCel + faceTri * 0.5);

    // 【機率要用面的重心算，不能用內插的片段高度】vOceanWorld.y 在面內是
    // 內插的，所以機率會在面內變動，roll < p 就把一個三角形切成半白半不白
    // —— 那不是「整面變白」。重心在格內的局部座標是固定的。
    vec2 faceCen = (faceCel + mix(vec2(0.3333333), vec2(0.6666667), faceTri))
      * faceCell;
    float faceH = oceanWaveHeight(faceCen, oceanVCell(faceCen - uOrigin));

    // ── 逐面底色 ──────────────────────────────────────────────
    //
    // 【這是低多邊形的主角，不是法線】相鄰面的法線只差約 12°（島是幾十度），
    // 海太平了 —— 光靠法線做不出稜角感。訊號由每個面自己的色調帶。
    gl_FragColor.rgb *= 1.0
      + (faceId - 0.5) * 2.0 * uFaceTint
      + clamp(faceH / uCrestRef, -1.0, 1.0) * uFaceLift;

    if (fade > 0.0) {
      // ── 碎光：一個面亮或不亮 ────────────────────────────────
      //
      // 【雙核】窄核保住方向選擇性，寬核鋪出稀疏的尾巴，讓鏡面圈之外也有
      // 零星白點。用 mix 不用加法 —— 兩個高斯在鏡面點都是 exp(0) = 1，
      // 中心因此嚴格不變。見 SPARKLE_TAIL_WEIGHT。
      //
      // 【σ 是常數】面法線就是真實的幾何法線，沒有「解析不出來的坡度」要
      // 折進 σ —— 那是逐像素解析波形時才需要的補償。
      float cosNH = clamp(dot(oceanNormal, oceanH), 0.0, 1.0);
      float narrow = exp(-(1.0 - cosNH) / (uSigmaBase * uSigmaBase));
      float tail = exp(-(1.0 - cosNH) / (uSigmaTail * uSigmaTail));
      float align = mix(narrow, tail, uTailWeight);

      // 【浪峰偏置】鏡面條件只看坡度，所以白點原本落在浪的**側面**，峰與谷
      // 機會相同。真實海面的短波被長浪調變 —— 峰上密、谷裡稀。見
      // SPARKLE_CREST_BIAS。高度均值為 0 而偏置是奇函數，所以白點總數不變。
      // max 擋住 uCrestBias > 1 時浪谷變成負機率。
      float crest = clamp(faceH / uCrestRef, -1.0, 1.0);
      float p = max(align * uDensity * fade * (1.0 + uCrestBias * crest), 0.0);

      // 【閃爍】每個面自己一段相位與速率，所以整片不會同步呼吸。
      //
      // 【傳 p 而不是傳 1 - p】p 在尾巴區小到 1e-3 以下，而 float32 在 1.0
      // 附近的 ulp 是 6e-8 —— 用「1 減去它」的形式來回一趟，小 p 的相對
      // 精度就沒了。
      //
      // 【用 roll < p 而不是 step(roll, p)】p 會**恰好等於 0**：
      // dist >= uFadeEnd 時 fade 明確是 0，align 在大角度下也會 underflow
      // 成 0。step(roll, 0.0) 在 roll 剛好是 0 的那些面會回 1 —— 250 km 外
      // 那片早該全黑的海上會殘留零星亮面。roll < 0.0 恆為 false。
      float twPhase = oceanHash(faceCel + vec2(3.1, 7.7) + faceTri);
      float twRate = 0.6 + 0.8 * oceanHash(faceCel + vec2(17.3, 5.1) + faceTri);
      float cycle = twPhase + uTime * uTwinkle * twRate;
      float k = floor(cycle);
      float u = fract(cycle);
      float roll = oceanHash(vec2(faceId * 512.0 + k, faceId * 731.0 - k * 1.3));
      float on = roll < p ? 1.0 : 0.0;

      // 【max 那一層是 NaN 的保險】GLSL ES 明定 pow(x, y) 在 x == 0 且
      // y <= 0 時未定義；這裡 y = 0.9 > 0，所以 pow(0.0, 0.9) 有定義。但
      // on * pow(...) **擋不住** NaN —— 0.0 * NaN 還是 NaN，而 NaN 一旦進了
      // gl_FragColor，那一整片海會出現黑塊，而且是平台相依的。
      float lit = on * pow(max(sin(u * 3.14159265), 1e-6), uEnvelopePow);

      // 【遠處的反光要暗下來】海面不吃霧，所以碎光得自己補這段大氣消光 ——
      // 見 SPARKLE_ATTEN_NEAR。只乘在加法項上，海的基色不受影響。
      float atten = mix(1.0, uFarDim, smoothstep(uAttenNear, uAttenFar, oceanDist));
      // 【霧化區把白面沖淡】遠海融進天空後不該再有清楚的碎光。
      // oceanAerial 在 SEA_DIM_FRAGMENT 算好（排在本段之前）。
      gl_FragColor.rgb += lit * uSparkleStrength * atten * (1.0 - oceanAerial)
        * vec3(1.0, 0.98, 0.94);
    }
`

/**
 * 疊在 `opaque_fragment` 之後（線性空間）。**兩個材質都用這一段**；
 * 逐面的部分由參數插進來，遠海拿到的是空字串（見 `FACE_FRAGMENT`）。
 */
export const sparkleFragment = (face: string): string => /* glsl */ `
  {
    // 視線量在 SEA_DIM_FRAGMENT 就算好了 —— 那一段必須排在這之前。
    float fade = 1.0 - smoothstep(uFadeStart, uFadeEnd, oceanDist);

    // 水面法線 = **這個三角面自己的法線**。材質是 flatShading，所以 three
    // 給的 normal 已經是面法線，不是內插的頂點法線。
    //
    // 【一定要轉回世界空間】three 的 normal 是 **view space**，而
    // uSunDirection、oceanV、天空反射全部是世界空間。直接用的話漫射與反射
    // 會隨鏡頭旋轉 —— 而且只在某些視角才看得出來。
    //
    // 【為什麼在這裡算而不是在 SEA_DIM_FRAGMENT】那一段接在 color_fragment
    // 之後，而 three 的 normal 要到 normal_fragment_begin 才存在 —— 在那裡
    // 引用它是「undeclared identifier」，整片海不編譯。
    vec3 oceanNormal = normalize(inverseTransformDirection(normal, viewMatrix));

    // 【暗處】面法線從沒進過 three 的光照鏈，補一階 Lambert 差 ——
    // 見 SEA_SHADE_GAIN。**必須排在加碎光之前**，否則亮面也會被調暗。
    gl_FragColor.rgb *= 1.0
      + (dot(oceanNormal, uSunDirection) - uSunDirection.y) * uShadeGain;

${face}
    // ── 天空反射（菲涅耳）──────────────────────────────────────────
    //
    // 【為什麼這是海面最像水的那一項】從飛機上看海，掠射角佔了畫面絕大部分，
    // 而水在掠射角的反射率逼近 1 —— 那時看到的**幾乎全是天空**，不是水體的
    // 顏色。少了這一層，海就是一片死藍的板子，與天空硬碰硬。
    //
    // 【「近深遠淺」是這一段給的，不是大氣透視】SEA_AERIAL_STRENGTH 是 0。
    // 掠射（遠）反射率趨近 1、看到的是天空；俯視（近）F0 = 0.02、看到的是海
    // 自己的深色。**改壞這一段就是把近深遠淺弄掉**，而沒有測試守得住。
    //
    // 【它與碎光是同一件事的兩端】碎光是「反射到太陽」的那一小塊，這裡是
    // 「反射到整片天空」的其餘部分。兩者共用同一條面法線，所以浪的形狀會
    // 同時出現在反光與反射裡。
    //
    // 【Schlick 近似】F = F0 + (1 − F0)(1 − cosθ)⁵，θ 是視線與法線的夾角。
    // 掠射（cosθ → 0）時 F → 1，垂直俯視時 F → F0，也就是幾乎看不到反射、
    // 看到的是海自己的顏色。**那個由近到遠的明暗變化因此是算出來的，不是
    // 調出來的。**
    //
    // 【天空色與 sky.ts 用同一條公式】t = dirY × 0.5 + 0.5 再取冪，見
    // skyColorAt。差別只在方向：那邊是視線，這邊是**反射線**。
    //
    // 【排在大氣透視之前】大氣消光作用在「已經反射出來的光」上，順序反了
    // 就會變成先把海洗淡、再疊上完整強度的天空。
    {
      float cosVN = clamp(dot(oceanNormal, oceanV), 0.0, 1.0);
      float fres = uReflectF0 + (1.0 - uReflectF0) * pow(1.0 - cosVN, 5.0);
      vec3 refl = reflect(-oceanV, oceanNormal);
      float t = clamp(refl.y * 0.5 + 0.5, 0.0, 1.0);
      vec3 skyCol = mix(uSkyHorizon, uSkyZenith, pow(t, uSkyPower));
      gl_FragColor.rgb = mix(gl_FragColor.rgb, skyCol, fres * uReflectStrength);
    }

    // 【大氣透視在最終色，PBR 之後】所以淺色是純淺藍、不會被光照弄灰。
    // 在逐面那一段之外 —— 大氣透視是所有海面像素都有，遠海也要。
    gl_FragColor.rgb = mix(gl_FragColor.rgb, uHorizonColor, oceanAerial);
  }
`

export interface Ocean {
  /**
   * 細浪面。**一組以相機為中心的巢狀方環**（clipmap），不是單一網格。
   * 設計與各層的尺寸見 `OCEAN_BASE_CELL`。
   *
   * 【為什麼回 Group 而不是回陣列】呼叫端（`render/terrain.ts`）只要把它
   * 加進場景；層數是這個模組的內部決定，不該漏出去。`__gfx` 的消融也
   * 靠 traverse 走到葉子，不需要知道有幾層。
   */
  mesh: Group
  /**
   * 遠海。**平的、單色、只有兩個三角形**，墊在細浪面底下把海接到地平線。
   *
   * 見 `FAR_SEA_SIZE` / `FAR_SEA_Y` 與下方 `renderOrder` 的註解。
   */
  farMesh: Mesh
  /**
   * 波相位的原點（著色器的 `uOrigin`），已經吸附到格點。**與
   * `mesh.position.xz` 恆相等** —— 只吸附其中一份的話浪會相對網格滑動，
   * 症狀與完全不吸附一樣。
   *
   * 【為什麼要出現在介面上】`onBeforeCompile` 在 headless 測試裡不會被呼叫，
   * 從材質上讀不到 uniform。公開它是為了讓那一條守得住，沒有別的用途。
   */
  readonly origin: Vector2
  update(time: number, centerX: number, centerZ: number): void
  heightAt(x: number, z: number, time: number): number
  dispose(): void
}

/**
 * 建一層 clipmap 的幾何：`segments × segments` 格、每格 `cell` 公尺、以原點
 * 為中心、躺在 XZ 平面上。`hollow` 為真時挖掉中央的 `(segments/2)²` 格 ——
 * 那正好是內一層的覆蓋範圍（見 OCEAN_BASE_CELL 的推導）。
 *
 * 【為什麼自己建而不用 PlaneGeometry + 挖洞】挖洞要重寫索引，而 PlaneGeometry
 * 的頂點順序與繞向是它的實作細節。自己建三十行，而且**洞裡的頂點刻意留在
 * 緩衝區裡**：索引沒有引用它們，GPU 就不會取，等於免費 —— 換來的是所有層
 * 共用同一套「i, j → 頂點編號」的算式，讀起來直接。
 *
 * 【繞向】由上往下看要是逆時針（three 的預設 FrontSide 是 CCW），法線才朝
 * 上。x 往右、z 往前（螢幕的下方），所以 (i,j) → (i+1,j) → (i,j+1) 這個順序
 * 在 XZ 上是順時針，要反過來寫。
 */
function clipmapLevelGeometry(cell: number, segments: number, hollow: boolean): BufferGeometry {
  const n = segments + 1
  const half = (segments / 2) * cell
  const pos = new Float32Array(n * n * 3)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const o = (j * n + i) * 3
      pos[o] = i * cell - half
      pos[o + 1] = 0
      pos[o + 2] = j * cell - half
    }
  }
  // 洞的範圍：中央 segments/2 格，也就是索引 [segments/4, 3·segments/4)
  const holeLo = segments / 4
  const holeHi = segments - segments / 4
  const idx: number[] = []
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      if (hollow && i >= holeLo && i < holeHi && j >= holeLo && j < holeHi) continue
      const a = j * n + i
      const b = a + 1
      const c = a + n
      const d = c + 1
      idx.push(a, c, b, b, c, d)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  // 【法線一律 +Y】材質是 flatShading，three 會用導數自己算面法線，這個
  // attribute 只是為了讓 built-in 的 shader chunk 有東西可以綁
  const nrm = new Float32Array(n * n * 3)
  for (let k = 0; k < n * n; k++) nrm[k * 3 + 1] = 1
  g.setAttribute('normal', new BufferAttribute(nrm, 3))
  g.setIndex(idx)
  // 【自己設包圍球】頂點會被波位移，而 computeBoundingSphere 只看原始座標。
  // 反正這些網格 frustumCulled = false，這裡只是不讓 three 事後去算它。
  g.boundingSphere = new Sphere(new Vector3(0, 0, 0), half * Math.SQRT2 + 8)
  return g
}

export function createOcean(): Ocean {
  // clipmap 的四層。L0 實心，其餘挖掉中央 —— 那一塊由內一層負責
  const levelGeometries = Array.from({ length: OCEAN_LEVELS }, (_, i) =>
    clipmapLevelGeometry(OCEAN_BASE_CELL * 2 ** i, OCEAN_RING_SEGMENTS, i > 0))

  const material = new MeshPhysicalMaterial({
    color: SEA_COLOR,
    roughness: SEA_ROUGHNESS,
    metalness: 0.05,
    specularIntensity: SEA_SPECULAR,
    flatShading: true,
    // 【海面不吃霧，spec 2026-08-09 §4.2】海面的近遠色差**完全**來自霧，而
    // 霧色是由天空色推導的，所以遠海必然往天空靠 —— 接縫因此糊成一片：實測
    // 那一階只有 0.092，而海面自己近到遠就變了 0.109。專案負責人要的是
    // 「近到遠幾乎沒有顏色變化」。
    // **兩個材質必須一起關**，漏一個就會在 5 km 處出現一條色帶。
    fog: false,
  })

  const uTime = { value: 0 }
  const uOrigin = { value: new Vector2(0, 0) }

  /**
   * 碎光的 uniform。**細浪面與遠海共用同一組物件** —— 同 `SEA_COLOR` 的理由，
   * 兩份會漂開，症狀是近海與遠海的接縫兩側顏色不一樣。
   */
  const sparkle = {
    uWaveDir: { value: WAVES.map((w) => new Vector2(w.dirX, w.dirZ)) },
    uWaveAmp: { value: WAVES.map((w) => w.amplitude) },
    uWaveLen: { value: WAVES.map((w) => w.wavelength) },
    uWaveSpd: { value: WAVES.map((w) => w.speed) },
    uSunDirection: { value: new Vector3(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]) },
    uCrestBias: { value: SPARKLE_CREST_BIAS },
    uCrestRef: { value: SPARKLE_CREST_REF },
    uSigmaBase: { value: SPARKLE_SIGMA_BASE },
    uSigmaTail: { value: SPARKLE_SIGMA_TAIL },
    uTailWeight: { value: SPARKLE_TAIL_WEIGHT },
    uDimLo: { value: SEA_DIM_LO },
    uDimHi: { value: SEA_DIM_HI },
    uDimFloor: { value: SEA_DIM_FLOOR },
    uDensity: { value: SPARKLE_DENSITY },
    uTwinkle: { value: SPARKLE_TWINKLE },
    uSparkleStrength: { value: SPARKLE_STRENGTH },
    uEnvelopePow: { value: SPARKLE_ENVELOPE_POW },
    uFaceTint: { value: FACE_TINT },
    uFaceLift: { value: FACE_CREST_LIFT },
    uHalfSeg: { value: OCEAN_RING_SEGMENTS / 2 },
    // 【天空色直接取 sky.ts 的常數】海面反射的是那一片天，兩份會漂開。
    // `new Color(hex)` 出來就在線性空間，而這一段也在線性空間（PBR 之後、
    // colorspace_fragment 之前），所以不需要任何轉換
    uSkyHorizon: { value: new Color(SKY_HORIZON) },
    uSkyZenith: { value: new Color(SKY_ZENITH) },
    uSkyPower: { value: SKY_GRADIENT_POWER },
    uReflectF0: { value: SEA_REFLECT_F0 },
    uReflectStrength: { value: SEA_REFLECT_STRENGTH },
    uWarp: {
      value: new Vector3(
        WAVE_WARP_AMP, (Math.PI * 2) / WAVE_WARP_LEN_A, (Math.PI * 2) / WAVE_WARP_LEN_B),
    },
    uWarpSpd: { value: WAVE_WARP_SPEED },
    uWarp2: {
      value: new Vector3(
        WAVE_WARP2_AMP, (Math.PI * 2) / WAVE_WARP2_LEN_A, (Math.PI * 2) / WAVE_WARP2_LEN_B),
    },
    uEnv: {
      value: new Vector3(
        WAVE_ENV_SPREAD, (Math.PI * 2) / WAVE_ENV_LEN_A, (Math.PI * 2) / WAVE_ENV_LEN_B),
    },
    uEnvLo: { value: WAVE_ENV_LO },
    uBaseCell: { value: OCEAN_BASE_CELL },
    uInvHalfSeg: { value: 2 / OCEAN_RING_SEGMENTS },
    uVertFadeLo: { value: OCEAN_VERT_FADE_LO },
    uVertFadeHi: { value: OCEAN_VERT_FADE_HI },
    uNyqLo: { value: WAVE_FADE_LO },
    uNyqHi: { value: WAVE_FADE_HI },
    uShadeGain: { value: SEA_SHADE_GAIN },
    uAttenNear: { value: SPARKLE_ATTEN_NEAR },
    uAttenFar: { value: SPARKLE_ATTEN_FAR },
    uFarDim: { value: SPARKLE_FAR_DIM },
    uFadeStart: { value: SPARKLE_FADE_START },
    uFadeEnd: { value: SPARKLE_FADE_END },
    uAerialHi: { value: SEA_AERIAL_HI },
    uAerialLo: { value: SEA_AERIAL_LO },
    uAerialStrength: { value: SEA_AERIAL_STRENGTH },
    // 漸層融向的目標色 = 負責人 2026-08-26 指定的 #3d5975（rgb 61,89,117），
    // 一個接近海色的中深藍灰 —— 比天空淺藍暗得多，所以漸層對比小、不刺眼。
    // 在**最終色**（PBR 之後，見 SPARKLE_FRAGMENT 末）mix，不是 albedo。
    uHorizonColor: { value: new Color(0x3d5975) },
  }

  /**
   * 把碎光接上一個材質。`displace` 決定要不要同時做頂點位移 —— 遠海是平的，
   * 不位移，但**照樣算真實的波法線**（著色只吃世界座標，與幾何平不平無關）。
   */
  const applySparkle = (
    m: MeshStandardMaterial,
    displace: boolean,
    cacheKey: string,
  ): void => {
    m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uTime = uTime
      shader.uniforms.uOrigin = uOrigin
      Object.assign(shader.uniforms, sparkle)

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
${SPARKLE_COMMON}`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           ${displace
             ? `vec2 rawXZ = transformed.xz + uOrigin;
                // 【扭曲在算相位之前】見 WAVE_WARP_AMP。CPU 的 gerstnerHeight
                // 也做同一件事，兩者不一致就是「撞到看不見的浪」
                vec2 worldXZ = rawXZ + oceanWarp(rawXZ, uTime);
                // 【包絡吃未扭曲的座標】見 gerstnerHeight 的同一行
                float envG = oceanEnvField(rawXZ, uTime);

                // 【這個頂點所在的層有多粗】四層都以相機為中心，而第 L 層
                // 覆蓋到半徑 (段數/2)×格子(L) —— 所以「離中心多遠」直接
                // 換算得到「這裡的格子多大」。用的是**局部座標**，也就是
                // 離相機的水平距離，與世界座標無關。
                //
                // 【為什麼兩層交界不會有高低差】交界上的同一點，兩層算出
                // 來的 vCell 完全相同（都只吃離中心的距離），淡出量因此
                // 逐位元一致。
                float vCell = max(uBaseCell, length(transformed.xz) * uInvHalfSeg);

                float waveH = 0.0;
                for (int i = 0; i < ${WAVES.length}; i++) {
                  float k = 6.28318530718 / uWaveLen[i];
                  // 【網格表現不出來的波，從幾何裡拿掉】見 OCEAN_VERT_FADE_LO。
                  // 只影響幾何 —— 片段著色器的波坡度是解析的，不受影響
                  float lod = 1.0 - smoothstep(
                    uWaveLen[i] * uVertFadeLo, uWaveLen[i] * uVertFadeHi, vCell);
                  waveH += uWaveAmp[i] * oceanEnv(envG, float(i)) * lod
                    * sin(k * dot(uWaveDir[i], worldXZ) - uWaveSpd[i] * k * uTime);
                }
                transformed.y += waveH;`
             : ''}
           vOceanWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
        )

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${SPARKLE_COMMON}`)
        // 【順序非有不可】基色那一段宣告了碎光要用的視線量，見
        // SEA_DIM_FRAGMENT。color_fragment 在 opaque_fragment 之前展開。
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>\n${SEA_DIM_FRAGMENT}`,
        )
        // 【兩個材質都套逐面那一段】見 FACE_FRAGMENT 的「遠海的面是虛擬的」。
        .replace(
          '#include <opaque_fragment>',
          `#include <opaque_fragment>\n${sparkleFragment(FACE_FRAGMENT)}`,
        )
    }
    /**
     * 【非設不可】兩個材質的 `onBeforeCompile` 來自同一個 factory，而
     * `customProgramCacheKey` 的預設值就是 `onBeforeCompile.toString()`
     * （three `Material.js`）—— 兩邊會產生**完全相同的字串**而共用同一支
     * program，於是遠海拿到帶頂點位移的那一版（或反之）。症狀離成因極遠。
     */
    m.customProgramCacheKey = () => cacheKey
  }

  applySparkle(material, true, 'ocean-near-waves')

  const mesh = new Group()
  for (const g of levelGeometries) {
    const m = new Mesh(g, material)
    // 【一律不做視錐剔除】包圍球看不到頂點位移，而且四層全部以相機為
    // 中心 —— 能被剔除的只有整層都在畫面外的情形，那極少發生
    m.frustumCulled = false
    mesh.add(m)
  }

  // 遠海。用 MeshPhysicalMaterial 而不是 Basic：要跟細浪面接得上就得受同一
  // 組燈光。roughness / metalness 全部沿用細浪面的值。
  //
  // 【為什麼要細分成 128×128，不是一個大四邊形】碎光的取樣座標是片段的
  // vOceanWorld.xz，由頂點透視插值而來。整片 6000 km 若只有兩個三角形，
  // 頂點相距數千公里，插值出的世界座標在 float32 下量化誤差約 0.36 m，
  // 相機一移動就跳動 → 遠海白點 1 px 抖，且對角線兩側各自插值、各自抖
  //（實測 2026-08-25）。細分到 128 段後單格約 47 km，插值誤差降到約 2.8 mm，
  // 遠小於碎光 14 m 的格子，抖動消失。128² = 16,384 個頂點，farMesh 不做
  // 頂點位移（displace=false），建立一次、之後只平移，成本可忽略。
  const FAR_SEGMENTS = 128
  const farGeometry = new PlaneGeometry(FAR_SEA_SIZE, FAR_SEA_SIZE, FAR_SEGMENTS, FAR_SEGMENTS)
  farGeometry.rotateX(-Math.PI / 2)
  const farMaterial = new MeshPhysicalMaterial({
    color: SEA_COLOR,
    roughness: SEA_ROUGHNESS,
    metalness: 0.05,
    specularIntensity: SEA_SPECULAR,
    /**
     * 【為什麼是 Less 而不是預設的 LessEqual】遠海排在近海之後畫，所以深度
     * 平手時**後畫的勝出** —— 而深度量化 `Δz ≈ z²/2²⁴` 在浪還存在的距離上
     * 已經是公尺級（最長波撐到 12,160 m，那裡是 8.8 m），遠比近海與遠海相距
     * 的 5 m 大。平手會讓遠海蓋掉近海的逐面色。
     *
     * 遠海恆在近海之下，而且在 clipmap 的覆蓋範圍內恆在近海之後（同一條視線
     * 上更遠），所以真實深度恆為 `far >= near`；量化是單調的，量化後仍然
     * `far >= near`。**平手是唯一的失效模式**，`LessDepth` 拒絕相等就補完了。
     *
     * 這比「把遠海壓到量化階的三倍之下」更強：與距離、波長、振幅全都無關，
     * 而且不會讓接縫的落差自己變成一條看得見的線。
     */
    depthFunc: LessDepth,
    // 【與細浪面同一個理由，見上面】兩個一起關，漏一個就是 5 km 處的色帶
    fog: false,
  })
  applySparkle(farMaterial, false, 'ocean-far-flat')

  const farMesh = new Mesh(farGeometry, farMaterial)
  farMesh.frustumCulled = false // 隨鏡頭捲動，永遠可見
  // 建立時就擺好，讓「還沒 update 過」的狀態也是一致的（與 sky.ts 同一招）
  farMesh.position.y = FAR_SEA_Y
  /**
   * 【2026-08-26：由 −1（最先畫）改成 1（最後畫）】
   *
   * ── 【為什麼原本要先畫，以及那個理由現在為什麼不成立】────────────
   *
   * 原本的理由是深度平手：遠海與細浪面只相距 5 m，而深度量化
   * `Δz ≈ z²/2²⁴`（近平面 1 m）在 7,000 m 是 2.92 m、12,000 m 是 8.58 m。
   * 上帝視角爬高之後，整片細浪面（那時永遠是 ±5 km）與遠海分不出前後，
   * 而 `LessEqualDepth` 讓**後畫的贏** —— 遠海會把浪蓋掉。
   *
   * clipmap 上線之後，**浪只存在於相機周圍 3.6 km 之內**：頂點的頻帶限制
   * 讓最長的 140 m 波在 `vCell > 0.4 × 140 = 56 m` 時完全淡出，而 vCell 是
   * 距離的 1/64，所以 56 m 對應 3,584 m。那個距離上 `Δz = 0.77 m`，只有
   * 5 m 間隔的六分之一 —— **深度分得很開，平手不可能發生。**
   *
   * 3.6 km 之外兩者都是平的、用同一支著色器、同一組參數，誰贏都一樣：實測
   * 八個凍結姿態，反轉前後沒有任何帶狀接縫（差異只是碎光的顆粒換了位置，
   * 因為遠海在 y = −5 而 clipmap 在 y = 0，視線向量差了一點）。
   *
   * ── 【換來的：遠海變成免費】────────────────────────────────
   *
   * 先畫的話，被細浪面蓋掉的區域**無法**靠 early-Z 省掉，而遠海是全螢幕的。
   * 而 clipmap 鋪到 82 km，畫面上的海幾乎整片都被它蓋住 —— 等於昂貴的海面
   * 著色器跑了兩次全螢幕。
   *
   * 逐層消融（同一輪內背對背）：
   *
   *     關掉遠海省下的 p50      改前 −16.6%      改後 −0.6%
   *
   * **這一項的收益比 clipmap 本身還大。**
   */
  farMesh.renderOrder = 1

  return {
    mesh,
    farMesh,
    origin: uOrigin.value,
    update(time, centerX, centerZ) {
      uTime.value = time

      // 【中心必須吸附到格點】頂點在波場裡連續滑動的話，每一幀每個面的三個
      // 角都落在波的不同相位上 —— 面的形狀逐幀改變，畫面上是整片海在蠕動、
      // 稜線在爬。格子 2.5 m 時那個誤差遠小於一個像素，看不出來；60 m 時
      // 它**就是**外觀。
      //
      // 【為什麼吸附到最外層的格距】OCEAN_SNAP 被四層的格距整除，所以一次
      // 吸附讓四層同時落在各自的格點上 —— `uOrigin` 因此仍然只有一個，
      // 各層不必分家。代價是中心最多偏離相機半格（L0 的半寬是 3,840 m）。
      //
      // 【設在群組上，不是每一層】四層共用同一個中心，那正是它們不裂開的
      // 前提。設在群組上讓那件事是**結構保證**的，不是每幀記得同步的。
      //
      // 【uOrigin 必須吃同一個吸附後的值】它算的是波的相位，而 mesh.position
      // 決定頂點在哪 —— 只吸附其中一份的話浪會相對網格滑動，症狀與完全不
      // 吸附一樣，但只看 mesh.position 的測試抓不到。
      const snapX = Math.round(centerX / OCEAN_SNAP) * OCEAN_SNAP
      const snapZ = Math.round(centerZ / OCEAN_SNAP) * OCEAN_SNAP
      mesh.position.set(snapX, 0, snapZ)
      uOrigin.value.set(snapX, snapZ)
      // 【遠海不吸附】吸附是為了避免頂點在格點之間滑動造成面的形狀逐幀改變，
      // 而遠海是平的、沒有面可言。精確跟著相機走，才不會在極端座標下累積偏差。
      farMesh.position.set(centerX, FAR_SEA_Y, centerZ)
    },
    heightAt: gerstnerHeight,
    dispose() {
      for (const g of levelGeometries) g.dispose()
      material.dispose()
      farGeometry.dispose()
      farMaterial.dispose()
    },
  }
}
