import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
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
 * 【方向要對 180° 取模來看】正弦波的 `+k` 與 `−k` 只差一個相位，所以
 * `(1.0, 0.15)` 與 `(−1.0, −0.15)` 是同一道波。判斷方向分不分散，要看的是
 * 模 180° 之後的分佈。
 *
 * 【五道波、方向間隔 40°】前一組是 8.5° / 123° / 107°，模 180 之後擠成兩群、
 * 45°～105° 一片空白，而振幅最大的那道在 8.5° —— 高空看不見短波（全被
 * Nyquist 淡掉），畫面就被那一道主導，浪紋全部朝同一個方向。
 *
 * 現在五道均勻鋪在 0° / 40° / 80° / 120° / 160°，而 `RIPPLE_WAVES` 的四道
 * 交錯插在 20° / 60° / 100° / 140° —— 九道波每 20° 一道，沒有留白也沒有兩道
 * 擠在一起。
 *
 * 【振幅比也放平了】舊的 1.65 : 1.05 : 0.525 是 3.1 : 2 : 1，最長那道太
 * 主導。現在 1.0 : 0.8 : 0.65 : 0.45 : 0.325 的比例（實際值是它的 1.45 倍，
 * 見下）。
 *
 * ── 【2026-08-26 振幅 ×1.45、速度改用真色散】────────────────────
 *
 * **人工指定：「起伏大一點（+1 m ~ −1 m）」「浪走快一點」。**
 *
 * 振幅：原本量到的高度範圍是 −2.24 … +2.29 m，×1.45 之後是 −3.2 … +3.3 m
 * —— 正好是要求的兩側各加一公尺。比例一個字沒動，所以方向分佈與各道波的
 * 相對主導關係完全不變。
 *
 * 速度：原本是 `√λ` 上的線性內插，係數落在真實深水色散的 0.61～0.73 倍
 * —— 也就是說浪一直走得比它們該有的慢。現在直接用色散關係本身：
 *
 *     c = √(gλ / 2π)      g = 9.81 m/s²
 *
 *   波長 140 m → 14.78 m/s      舊值 9.00（0.61 倍）
 *        105 m → 12.80          舊值 8.05（0.63）
 *         78 m → 11.03          舊值 7.20（0.65）
 *         55 m →  9.27          舊值 6.29（0.68）
 *         31 m →  6.96          舊值 5.10（0.73）
 *
 * 快了約 1.5 倍，而且**長波比短波快**這個關係更明顯了 —— 那是海面看起來
 * 有「湧」的原因：長浪從短浪底下穿過去。
 *
 * `RIPPLE_WAVES` 的速度由最短那道乘 `√(λ/λ_ref)` 推導，同一條色散關係，
 * 所以它們自動跟著加快，不必另外改。
 *
 * 【連帶必須動的】振幅和由 3.225 m 變成 4.673 m，所以 `FAR_SEA_Y` 要跟著
 * 下降（見該常數）。`SHADE_SLOPE_RMS` 的預算也被吃掉更多，`RIPPLE_WAVES`
 * 的振幅因此自動縮到 0.86 倍 —— 那是設計好的：總坡度守恆，浪變陡就該讓
 * 微波退讓。
 *
 * 【速度沿用既有的色散關係】舊的三道在 `√λ` 上大致成線性，新增的兩道就在
 * 那條線上內插 —— 兩組之間不會有一道波跑得明顯不對。
 *
 * 【加道數的代價】`crash.ts` 的入水判定、`splash`、`wrecks` 全部走
 * `heightAt`，這裡每多一道就是每次呼叫多一次 `sin`。五道仍在可忽略的量級。
 */
export const WAVES: readonly WaveSpec[] = [
  { dirX: 1.0, dirZ: 0.0, amplitude: 1.45, wavelength: 140, speed: 14.78 },
  { dirX: 0.766, dirZ: 0.643, amplitude: 1.16, wavelength: 105, speed: 12.80 },
  { dirX: 0.174, dirZ: 0.985, amplitude: 0.943, wavelength: 78, speed: 11.03 },
  { dirX: -0.5, dirZ: 0.866, amplitude: 0.653, wavelength: 55, speed: 9.27 },
  { dirX: -0.94, dirZ: 0.342, amplitude: 0.467, wavelength: 31, speed: 6.96 },
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
export const WAVE_WARP_AMP = 40
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
export const WAVE_WARP2_AMP = 9
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
 *   二、往上調等於偷偷提高整體浪高，而浪高牽動 SHADE_SLOPE_RMS 的預算
 *       （RIPPLE_WAVES 的振幅由它反推）—— 那是另一個決定。
 *
 * 代價是平均浪高降到約 67%。要補回來得動 WAVES 的振幅，而那要連
 * RIPPLE_WAVES 一起重算。
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
 * ── 【海面的 LOD：同心環 clipmap】────────────────────────────────
 *
 * 細浪面不是一張均勻的網格，而是一組以相機為中心的巢狀方環。每一層的格子
 * 是內層的兩倍大、覆蓋範圍也是兩倍，所以**每一層在畫面上佔的角度大致相同**
 * —— 三角形跟著像素走，不跟著公尺走。
 *
 * 【為什麼要換掉均勻網格】改動前是 ±5 km 鋪 512×512 格（一格 19.5 m、26 萬
 * 個四邊形）。兩頭都不對：
 *
 *   近處太粗   31 m 的波只有 1.59 點／波長，低於 Nyquist，畫出來是混疊
 *   遠處太細   1 km 之外浪本來就不到 4 px，六成的三角形是白畫的
 *
 * 現在（基礎格 2.5 m、每層 128×128、十層）：
 *
 *   層   格子       覆蓋半徑      四邊形
 *   L0    2.5 m      160 m        16,384（實心）
 *   L1    5 m        320 m        12,288（空心環）
 *   L2    10 m       640 m        12,288
 *   L3    20 m       1.28 km      12,288
 *   L4    40 m       2.56 km      12,288
 *   L5    80 m       5.12 km      12,288
 *   L6   160 m      10.24 km      12,288
 *   L7   320 m      20.48 km      12,288
 *   L8   640 m      40.96 km      12,288
 *   L9  1280 m      81.92 km      12,288
 *                                ───────
 *                                126,976（改動前 262,144）
 *
 * **三角形少一半，近處的格子細 7.8 倍，覆蓋範圍大 16 倍。** 31 m 的波在 L0
 * 拿到 12.4 點／波長，終於畫得出來。
 *
 * 【接縫推到 82 km】遠海與細浪面的 5 m 落差，改動前在 5 km 處是 1.27 px；
 * 現在在 81.92 km 處是 0.08 px，看不見了。
 *
 * ── 【三個關鍵設計】────────────────────────────────────────────
 *
 * 一、**不做格點對齊。** 改動前細浪面要對齊到格點，否則頂點在格點之間滑動
 *     會讓波形抖動 —— 那是因為它沒有做頻帶限制，19.5 m 的格子在取樣 31 m
 *     的波，滑動就是混疊。現在每個頂點按**它離相機多遠**把解析不出來的波
 *     淡掉（見 OCEAN_VERT_FADE_LO），取樣就永遠在 Nyquist 之內，滑動只造成
 *     內插誤差（振幅的 3% 量級），不會抖。
 *
 *     這也讓十層可以共用同一個中心 —— 全部直接設在相機的 XZ 上。
 *
 * 二、**淡出吃的是「離相機的距離」，不是「這一層的格子大小」。** 兩層的交界
 *     上，兩邊算出來的淡出量因此**完全相同**，共用的頂點高度逐位元一致，
 *     不會有高低差。（交界上細層多出來的中點仍然是 T 形接點，見下。）
 *
 * 三、**空洞的大小是推導出來的，不是調的。** 第 L 層的洞必須正好等於第
 *     L−1 層的外緣：`(段數/2) × 格子(L−1) = (段數/4) × 格子(L)`，也就是
 *     中央 (段數/2)² 個四邊形。段數必須是 4 的倍數。
 */
export const OCEAN_BASE_CELL = 2.5
/**
 * 見 OCEAN_BASE_CELL。每一層的邊各切幾格。**必須是 4 的倍數**（空洞是中央
 * 的 (段數/2)²，而那要能整除）。
 *
 * 【128 怎麼來的】它同時決定兩件事：每層的四邊形數（128² − 64² = 12,288）
 * 與每層覆蓋的半徑（64 × 格子）。128 讓十層剛好接到 82 km，而總量仍比改動
 * 前的均勻網格少一半。
 */
export const OCEAN_RING_SEGMENTS = 128
/**
 * 見 OCEAN_BASE_CELL。層數。每多一層，覆蓋半徑加倍、四邊形加 12,288。
 *
 * 【為什麼是 10】最外層要遠到讓「遠海接縫」的 5 m 落差進次像素。81.92 km
 * 處是 0.08 px；九層（41 km）是 0.16 px，也夠，但十層只多 1.4% 的三角形。
 */
export const OCEAN_LEVELS = 10

/**
 * 細浪面**整體**的邊長，m。由 clipmap 推導，不是可調參數。
 *
 * 【它現在只有一個用途】`ocean.test.ts` 拿它與 FAR_SEA_SIZE 比，確認遠海
 * 真的遠大於細浪面。
 */
export const OCEAN_SIZE
  = OCEAN_BASE_CELL * 2 ** (OCEAN_LEVELS - 1) * OCEAN_RING_SEGMENTS

/**
 * 頂點位移的頻帶限制窗，單位是波長的倍數。**與片段著色器的 WAVE_FADE_LO/HI
 * 是兩回事**：那一個看的是像素的 footprint（畫面上分不分得出來），這一個看
 * 的是**網格的格子**（幾何上表現不表現得出來）。
 *
 * 【為什麼幾何要比著色更保守】著色的取樣點是像素，密度由螢幕決定；幾何的
 * 取樣點是頂點，密度由這一層的格子決定，而格子之間是**線性內插**。正弦波
 * 用直線接起來，要五個點以上才看不出折角，兩個點（Nyquist 極限）看起來是
 * 三角波。0.2 / 0.4 表示：格子小於 0.2λ（五點）完全保留，大於 0.4λ
 * （2.5 點）完全拿掉。
 *
 * 【拿掉的波去哪了】**只從幾何拿掉，著色不受影響。** 片段著色器算的是解析
 * 的波坡度，與網格細不細無關 —— 所以遠處的海仍然有完整的波紋光影，只是那
 * 片水面在幾何上是平的。而那正是對的：1.45 m 的浪在 5 km 外只有 0.37 px。
 *
 * 【與碰撞判定的差異】`gerstnerHeight`（CPU）**不做**這個淡出，它永遠是完整
 * 的五道波。相機附近（L0、L1）淡出量是 0，兩者逐位元相同；遠處才分家，而
 * 那裡的差異最多 3.3 m，在 5 km 外是 0.8 px。撞海判定用的是飛機自己的位置，
 * 而相機永遠跟著玩家 —— 玩家那一架永遠落在「完全相同」的那一區。
 */
export const OCEAN_VERT_FADE_LO = 0.2
/** 見 OCEAN_VERT_FADE_LO。 */
export const OCEAN_VERT_FADE_HI = 0.4

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
 * 著色法線的目標坡度 RMS（弧度）。`RIPPLE_WAVES` 的振幅由它反推。
 *
 * 【為什麼要拉高】`WAVES` 三道波的坡度 RMS 只有 0.0731（4.19°），而真實海面
 * 在 7 m/s 風速下是 11°（Cox-Munk）。差這麼多的後果是**遠處根本達不到鏡面
 * 條件**：相機 1 km 高看 30 km 外的海，視線仰角只有 1.9°，半角向量偏離 +Y
 * 25.5° —— 波法線最多斜 8.4°，差 17° 以上，align 掉到 0.018。有顆粒時離散性
 * 還能撐住（1.6% 的格子亮到 0.6，看得見），一旦收斂成連續場就攤平成 0.0015，
 * 整片海變成死平的一塊。
 *
 * 11° 就是 Cox-Munk 在 7 m/s 下的值。`WAVES` 的振幅提高之後它自己貢獻了
 * 6.28°，剩下的餘量仍夠 `RIPPLE_WAVES` 分四道 —— 但這兩個常數是連動的：
 * `WAVES` 再往上加，微波的振幅就會被擠掉。
 */
export const SHADE_SLOPE_RMS = (11 * Math.PI) / 180

/**
 * 一個像素的張角，弧度。決定哪些波還解析得出來（見 `SPARKLE_FRAGMENT` 的波
 * 迴圈）。
 *
 * 【這是複本，不是權威 —— 同 `SUN_DIR` 的處境】權威是 `scene.ts:46` 的
 * `CAMERA_FOV_DEG`（65，垂直）與實際的畫布高度。這裡按 1080 定值：
 * `65° / 1080 = 0.0602°`。視窗高度不同時 footprint 會偏，症狀是波的淡出距離
 * 跟著偏 —— 那是漸進的，不會有硬邊。真要精確就得每 frame 從相機餵進來，而
 * `update()` 的簽名為此改動不值得。
 *
 * 【為什麼不用 dFdx —— 2026-08-25 量測】硬體導數看似更對（自動涵蓋解析度、
 * FOV 與掠射角），但它是在 **2x2 的 quad** 上算的：footprint 在一個 quad 內
 * 是常數，quad 與 quad 之間跳變，所以自帶 2 px 的階梯。那個階梯經由
 * 「淡出權重 w → 波梯度 g → 法線 N → 明暗」一路傳到畫面上。對實機截圖的
 * 海面做 FFT，主頻是**週期 2.25 px、方向 88.3° 的水平條紋，強度佔絕對主導**
 * —— 2 px 正是 Nyquist 極限，那是混疊的指紋，不可能是任何真實的波。
 *
 * 解析式沒有這個問題：`oceanDist` 與 `oceanV` 都由插值的 varying 算出，逐
 * 像素連續。掠射角那一半由 `1 / oceanV.y` 補回來（`oceanV.y` 就是視線與海面
 * 夾角的 sin）。
 */
export const PIXEL_ANGLE = ((65 * Math.PI) / 180) / 1080

/**
 * **微波專用的細座標扭曲**：兩層的振幅（m）與各自的兩道波長（m）。
 *
 * ── 【它在解什麼：少數幾道正弦永遠是準週期的】───────────────────────
 *
 * `WAVE_WARP_*` 已經把長浪的波峰弄彎了，但它的尺度是幾百到幾千公尺 ——
 * 對 11 m 的微波來說那是一個幾乎均勻的平移，波峰照樣是筆直的長峰。於是
 * 微波那一階不管切成幾道，疊出來的都是一個**規則的晶格**：一道時晶格退化
 * 成條紋，四道時它是斑點。自相關一路到邊都不衰減，兩者都不像海。
 *
 * 【為什麼扭曲解得掉，而多切幾道解不掉】規律性的量度是**相關長度**，而它
 * 由波數帶的寬度決定 —— 一階就是一個窄帶，塞再多方向都還是窄帶。座標扭曲
 * 讓局部波長跟著扭曲的梯度伸縮，等於**把一階自己攤成寬頻**：
 *
 *     梯度 = 振幅 × 2π/波長 ≈ 0.4  →  局部波長在 λ/1.4 ~ λ/0.6 之間跑
 *     相位擾動 = k·振幅 ≈ π        →  波峰會斷、會錯開，長度變成有限的
 *
 * 【為什麼只給微波、而且只在片段著色器裡】微波不進頂點位移、不進碰撞，
 * 所以這一份沒有 CPU 的對應版本，也不必與 `waveWarp` 保持逐字相同。把它
 * 加進 `oceanWarp` 的話 140 m 的長浪會跟著被 60 m 的尺度扭爛，而 `crash.ts`
 * 讀的 `gerstnerHeight` 得跟著改 —— 那是完全不同量級的一件事。
 *
 * 【為什麼要兩層、而且四個波長互質】單層的話扭曲自己就是週期的，相關性會
 * 在一個扭曲波長之後**整個復活** —— 等於把重複推到 60 m，比原本的條紋還糟。
 * 兩層互質之後復活點被推到最小公倍數，遠在任何一個畫面之外。
 *
 * 【梯度不能到 1】到 1 座標映射就會摺疊，症狀是焦散般的硬亮線。兩層加起來
 * 每個分量約 0.4，離摺疊有餘裕。
 */
export const RIPPLE_WARP_AMP = 6.0
/** 見 `RIPPLE_WARP_AMP`。取質數。 */
export const RIPPLE_WARP_LEN_A = 149
/** 見 `RIPPLE_WARP_AMP`。 */
export const RIPPLE_WARP_LEN_B = 103
/** 見 `RIPPLE_WARP_AMP`。第二層：更短、更淺，負責把波峰真的切斷。 */
export const RIPPLE_WARP2_AMP = 2.4
/** 見 `RIPPLE_WARP_AMP`。取質數，與第一層互質。 */
export const RIPPLE_WARP2_LEN_A = 61
/** 見 `RIPPLE_WARP_AMP`。 */
export const RIPPLE_WARP2_LEN_B = 43

/**
 * `RIPPLE_WAVES` 的形狀。振幅與速度由 `SHADE_SLOPE_RMS` 與色散關係推導。
 *
 * 【階梯，不是清單】每個 `share` 加起來為 1 的群組是**一階**，一階分到一份
 * 相等的坡度預算（Phillips 譜下坡度能量在每個 octave 大致相等）。所以在一階
 * 裡多切幾道波不會讓那個尺度變粗糙 —— 只是把同樣的能量攤到更多方向。
 *
 * 【11 m 那一階為什麼是四道：它是唯一畫得出來的一階】比它短的三階被
 * `shadeScale` 的地板整個砍掉（見 `RIPPLE_RESOLVED`），永遠只進 σ。於是
 * 畫面上**最細的那層確定性結構只剩這一階** —— 單獨一道長峰正弦，症狀就是
 * 整片海布滿同一個走向的細紋。
 *
 * 【間隔 45° 不是隨便取的】波峰是**軸向**的：20° 與 200° 是同一條線，所以
 * 「有沒有主方向」要看**倍角**的合成向量。四道間隔 45°，倍角就均勻分佈在
 * 整圈上、合成向量趨近 0 —— 沒有任何方向勝出。散佈不夠寬會留下殘餘的主
 * 方向：25° 間隔的三道實測方向性 0.357，只比單一道的 0.409 好一點點。
 *
 * 【四道與 `RIPPLE_WARP_*` 缺一不可 —— 兩者治的是不同的病】截圖量到的自相關
 * 遠端次峰（±14–25 m，數字愈小愈不規則）：
 *
 *   一道、不扭曲   0.334   長峰正弦 → **條紋**
 *   四道、不扭曲   0.274   四道交叉 → **規則的斑點晶格**（顆粒）
 *   一道、扭曲     0.189   波峰被弄彎了，但沒斷 → 條紋照樣在，只是變彎
 *   四道、扭曲     0.148   短峰、不規則 ← 現在的樣子
 *
 * 拆分處理「只有一個方向」，扭曲處理「波峰無限長」。少任何一邊都會留下一個
 * 看得出來的規則圖樣。
 *
 * 【波長要靠得近】13.1 / 11.3 / 10.2 / 8.9 —— 四道的淡出窗因此幾乎重疊，
 * 方向散佈一路撐到整階淡光為止。拉開的話短的先死，遠處又剩單一方向，
 * 細紋回來。比值刻意不等，免得四道之間的拍頻自己變成一個規則圖樣。
 */
const RIPPLE_SHAPE: readonly {
  dirX: number; dirZ: number; wavelength: number; share: number
}[] = [
  { dirX: 0.966, dirZ: 0.259, wavelength: 13.1, share: 1 / 4 },
  { dirX: 0.5, dirZ: 0.866, wavelength: 11.3, share: 1 / 4 },
  { dirX: -0.259, dirZ: 0.966, wavelength: 10.2, share: 1 / 4 },
  { dirX: -0.866, dirZ: 0.5, wavelength: 8.9, share: 1 / 4 },
  { dirX: 0.5, dirZ: 0.866, wavelength: 4.7, share: 1 },
  { dirX: -0.174, dirZ: 0.985, wavelength: 1.9, share: 1 },
  { dirX: -0.766, dirZ: 0.643, wavelength: 0.77, share: 1 },
]

/**
 * **只給著色法線用的微波。幾何與碰撞一個字都不碰。**
 *
 * 【為什麼不能加進 WAVES】`crash.ts` 的入水判定、`splash`、`wrecks` 全部走
 * `heightAt`（= `gerstnerHeight`），而網格是 52 m 的面 —— 連 31 m 的波都畫
 * 不出來，0.77 m 的更不可能。這是 spec §4.3 那個取捨的延伸：**遠處的小浪本
 * 來就是次像素的，你看不到它的起伏，只看得到它造成的反光變化。**
 *
 * 【波長為什麼是這幾個】四階落在 11 / 4.7 / 1.9 / 0.77，比值約 2.4，刻意不成
 * 整數比。純正弦的疊加是準週期的，比值成整數比時週期短到肉眼抓得到，症狀
 * 就是「太陽反光處的皺褶很重複」。階數多、比值互質，準週期就長到看不出來。
 *
 * 【每一階貢獻相等的坡度】Phillips 譜下坡度的能量在每個 octave 大致相等，
 * 所以四階等分 `SHADE_SLOPE_RMS` 扣掉 `WAVES` 之後的餘量，階內再按 `share`
 * 分。振幅因此是 `ak / (k·|dir|)`，最短那階只有 12 mm —— 它對**高度**毫無
 * 貢獻，對**坡度**卻和 11 m 那階一樣重。
 *
 * 【速度延續既有的色散關係】`WAVES` 的三道大致落在深水色散的 0.61～0.73 倍
 * （藝術選擇，不是物理）。這裡從最短的那一道往下用 `√λ` 外插，兩組之間就不
 * 會有一道波跑得明顯不對。
 */
export const RIPPLE_WAVES: readonly WaveSpec[] = (() => {
  const slopeVar = (w: WaveSpec): number => {
    const ak = w.amplitude * ((Math.PI * 2) / w.wavelength) * Math.hypot(w.dirX, w.dirZ)
    return (ak * ak) / 2
  }
  const need = Math.max(0, SHADE_SLOPE_RMS ** 2 - WAVES.reduce((s, w) => s + slopeVar(w), 0))
  // 一階的坡度變異數。階內每道拿 share 那一份，所以總和恆等於 need ——
  // **在一階裡多切幾道波不會改變總坡度**，只會改變它散在幾個方向上。
  const perLevel = need / RIPPLE_SHAPE.reduce((s, r) => s + r.share, 0)
  // 拿最短的那一道當色散的錨點，而不是「最後一個」—— 順序不該有語義。
  const ref = WAVES.reduce((a, b) => (b.wavelength < a.wavelength ? b : a))
  return RIPPLE_SHAPE.map((r) => ({
    dirX: r.dirX,
    dirZ: r.dirZ,
    wavelength: r.wavelength,
    amplitude: Math.sqrt(2 * r.share * perLevel)
      / (((Math.PI * 2) / r.wavelength) * Math.hypot(r.dirX, r.dirZ)),
    speed: ref.speed * Math.sqrt(r.wavelength / ref.wavelength),
  }))
})()

/**
 * 微觀粗糙度的基底（弧度）—— **比最短那道微波（0.77 m）還細的所有東西**。
 * 毛細波、風紋、破碎的浪頭，那些永遠不會進法線。
 *
 * 【σ 現在是動態的】實際用的是 `sqrt(uSigmaBase² + 未解析的坡度變異數)`。
 * 每一道波按「這個像素還分不分得出它」淡出（見 `SPARKLE_FRAGMENT` 的波
 * 迴圈），淡出的部分不是消失，而是把它的坡度變異數加進 σ。這就是 spec §4.4
 * 說的「比 31 m 更細的浪不進法線，改成統計性的粗糙度」，只是做成了隨距離的。
 *
 * 於是同一套式子涵蓋兩端：近處只有 11 m 那一階解析得出來、σ = 7.5°，碎光跟著
 * 細波的形狀；30 km 外連那一階也淡光、σ 到 11°（就是 `SHADE_SLOPE_RMS`），
 * 掠射角也中得了鏡面條件，連續場因此不會是死平的一塊。
 *
 * 【近處的 σ 不是基底】比 `SHADE_SCALE_FLOOR` 還細的三階在任何距離都淡光，
 * 常數 7.39° 是它們貢獻的 —— 見 `RIPPLE_STATIC_VAR`。基底本身只有 1.5°，
 * 在平方和裡幾乎不佔份量；它守的是「三階全都被拿掉時 σ 不會歸零」。
 *
 * 【為什麼基底要這麼小】σ 為常數時的實測（2026-08-11）：
 *
 *   σ      正下方   鏡面點   對比
 *   12°    0.703    1.000    1.4×   ← 選擇性沒了，亮區變成相機正下方的圓
 *    8°    0.453    1.000    2.2×
 *    5°    0.132    1.000    7.6×
 *    4°    0.042    1.000    23.8×
 *
 * 對一台朝下的相機，正下方大片區域的 V 都近乎垂直，H 固定偏離 +Y 18.5°。σ
 * 一旦大到讓那個角度也算「對齊」，最亮的地方就變成「視線最垂直的位置」而不
 * 是鏡面點。近處必須維持選擇性，所以基底要小；遠處的 σ 之所以能大，是因為
 * 那裡的方向性本來就該由統計接手。
 */
export const SPARKLE_SIGMA_BASE = (1.5 * Math.PI) / 180
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
 * 參考距離內的格子邊長，m —— 這決定色塊的大小。
 *
 * 【改這個不會改總覆蓋率，只會改塊的數量】覆蓋率 = 每單位面積的塊數 x 每塊
 * 面積 = (p / cellW²) x (cellW² · E[形狀]) = p · E[形狀] —— cellW 消掉了。
 * 所以縮小格子只是把同樣多的白分成更多更小的塊：**邊長減半，螢幕上的亮塊
 * 數量就是四倍，而總亮度一個字都不變。**
 *
 * 【14 m 是真實浪的尺度，而且它是世界尺寸不是螢幕尺寸】`SPARKLE_CELL_REF`
 * 之內格子邊長就是這個值，不隨距離變 —— 所以塊在畫面上**近大遠小**：
 *
 *   距離        14 m/2 km     4 m/571 m     2 m/571 m（現值）
 *   120 m        111 px         31.7 px        15.9 px
 *   300 m         44 px         12.7 px         6.3 px
 *   571 m         23 px          6.67 px ←鎖    3.33 px ←鎖
 *     2 km       6.67 px ←鎖     6.67 px         3.33 px
 *     5 km       6.67 px         6.67 px         3.33 px
 *
 * ── 【2026-08-26 由 14 m / 2 km 縮到 2 m / 571 m】────────────────
 *
 * **人工回報：「白點近距離確實像漂浮的紙片」。** 14 m 的塊在 120 m 高度
 * 貼海飛時佔 111 px —— 那個尺寸的白色多邊形讀起來就是水面上的紙片，而不是
 * 反光。
 *
 * 【兩個常數各管一件事】遠處的螢幕大小 = SPARKLE_CELL ÷ SPARKLE_CELL_REF；
 * 近處的世界尺寸 = SPARKLE_CELL。所以：
 *
 *   兩個一起等比縮   近處變小，遠處**一個字都不變**
 *   只縮 SPARKLE_CELL 遠近**一起**變小
 *
 * 先做了第一件（14/2000 → 4/571，遠處鎖定仍是 6.67 px），人工試看之後指定
 * 「不管遠近尺寸都砍半」，於是再做第二件（4 → 2，鎖定變成 3.33 px）。
 *
 * 【反鋸齒的餘裕還剩多少】邊緣寬度是 SPARKLE_EDGE 個像素換算回格子單位，
 * 也就是 uEdge × 像素張角 × (CELL_REF / CELL)。塊縮小，這個比例就變大：
 * 4 m 時是 0.225，2 m 時是 0.360，而程式裡的上限是 0.40。**再砍一半就會
 * 撞到那個 clamp**，屆時塊會開始糊成連續的雜訊而不是一顆一顆。
 *
 * 【代價是透視的區間變短】原本 2 km 之內都有近大遠小，現在只到 571 m。
 * 571 m 到 2 km 那一段由「會縮」變成「鎖定 6.67 px」，所以那個距離帶的塊
 * 比改動前小 —— 實測（.shots/sea/quar-dive.png 對 big-dive.png）在 3 km 的
 * 俯衝視角上看不出來，因為那裡絕大部分的海本來就在鎖定區之外。
 *
 * 【為什麼不能讓螢幕大小恆定】那正是「近看像髒污」的成因。塊在所有距離都是
 * 同樣的像素數時，它不隨距離縮、不隨飛行掠過，大腦讀不出它在水面上，就讀成
 * 貼在鏡頭玻璃上的東西。透視縮放是「這東西在遠方的水面上」唯一的線索。
 * **所以這次是把整條律等比縮小，不是把它拉平** —— 近處仍然有透視，只是
 * 塊本身小了三倍半。
 *
 * 【為什麼是塊不是點 —— low-poly】這個遊戲的幾何是 low-poly：海面
 * `flatShading: true`，52 m 的面在 5 km 處螢幕上有 10 px 寬。次像素的碎光點
 * 與那個風格是打架的，而且稀疏的次像素噪聲讀起來就是粒子（星空），不是水。
 * 放大到面的量級之後，碎光讀作「一片片亮起來的水面」而不是「散落的白點」。
 *
 * 【絕對座標的上限 —— Codex 2026-08-11 審查的 Minor】上面那個「LOD 讓相對
 * 精度不變」的論證只在**絕對世界座標與視距同量級**時成立。vOceanWorld 是
 * 絕對座標，而 LOD 只看距離 —— 玩家若朝單一方向一路飛遠，世界座標會遠大於
 * 眼前的視距，LOD 不會放大近處的格子來補償。
 *
 * 絕對座標約 117,440 km 時 float32 的 ULP 才追上 14 m 的格子（Hoskins hash
 * 本身也在格號 10^7 左右開始退化）。症狀是近處碎光鎖成條帶或隨鏡頭抖動。
 *
 * 【為什麼不處理】那大約是 700 km/h 直線飛 6 小時。而這個遊戲的戰場是有界的
 * （參照物散佈半徑 9 km，撤退令本身就有把戰鬥拉回戰場的護欄），實際座標不會
 * 到那個量級。真要處理得改用「相對於某個週期性對齊原點」的座標，而那會在
 * 原點跳動時讓整片碎光圖案跳一次 —— 代價比問題大。記錄下來就好。
 */
export const SPARKLE_CELL = 2
/**
 * 透視縮放的終點，m。**之內塊是固定的世界尺寸、會隨距離縮；之外 LOD 接手，
 * 螢幕張角鎖定。**
 *
 * 【為什麼是 571 m】塊在這裡剛好縮到 6.7 px —— 與改動前的 2 km 完全相同，
 * 因為兩個常數是一起等比縮的（見 SPARKLE_CELL）。再遠就要進次像素、混疊會
 * 回來，所以在這裡把它鎖住。
 *
 * 【這個數字不能單獨動】它與 SPARKLE_CELL 的**比值**才是有意義的量：
 * 4 / 571 = 7.0 mrad 就是鎖定之後的角張度。只改一個，遠處的塊大小就變了。
 */
export const SPARKLE_CELL_REF = 571

/**
 * `shadeScale` 的地板 —— 著色法線分辨得出來的最小世界尺度。
 *
 * 【它為什麼是 `SPARKLE_CELL`】Voronoi 的塊是**單色**的，比一塊還小的波在塊
 * 內看不到形狀。真讓它進 `g` 的話 align 會在塊內劇烈變化，而亮塊的門檻是逐
 * 像素的 `roll < p` —— 一塊會被撕成好幾片。所以片段著色器取
 * `max(oceanFoot, cellNominal)`，而 `cellNominal` 在近處就是這個值。
 */
export const SHADE_SCALE_FLOOR = SPARKLE_CELL

/**
 * 微波裡**還畫得出形狀**的那幾道 —— 只有它們進片段著色器的迴圈。
 *
 * 【為什麼要分割】每道波按 `0.15λ → 0.4λ` 隨 `shadeScale` 淡出，而
 * `shadeScale` 有 `SHADE_SCALE_FLOOR` 這個地板、且只隨距離變大。所以
 * `0.4λ ≤ 地板` 的那幾道**在任何距離都是 w = 0**：對 `g` 一個字都不寫，
 * 只把自己的坡度變異數倒進 σ —— 而那是個**常數**。
 *
 * 於是它們沒有理由留在逐像素的迴圈裡。常數在 `RIPPLE_STATIC_VAR` 先加好，
 * 迴圈只跑剩下的。畫面逐位元相同（GLSL 的 `smoothstep` 會夾住，w 嚴格為 0），
 * 迴圈短一圈。
 *
 * 【它跟著常數走，不是寫死的】把 `SPARKLE_CELL` 調小、或把某階的波長拉長，
 * 該道就自動回到迴圈裡。`ocean.test.ts` 守著「至少還有一道」。
 */
export const RIPPLE_RESOLVED: readonly WaveSpec[]
  = RIPPLE_WAVES.filter((w) => w.wavelength * WAVE_FADE_HI > SHADE_SCALE_FLOOR)

/**
 * 見 `RIPPLE_RESOLVED`。永遠解析不出來的那幾道的坡度變異數總和，直接當
 * `slopeVar` 的初值餵進片段著色器。
 */
export const RIPPLE_STATIC_VAR: number = RIPPLE_WAVES
  .filter((w) => w.wavelength * WAVE_FADE_HI <= SHADE_SCALE_FLOOR)
  .reduce((sum, w) => {
    const ak = w.amplitude * ((Math.PI * 2) / w.wavelength) * Math.hypot(w.dirX, w.dirZ)
    return sum + (ak * ak) / 2
  }, 0)
/**
 * 碎光取樣座標的水平漂移倍率。1.0 = Gerstner 波的真實質點位移。
 *
 * 【為什麼需要】幾何只做垂直位移，所以水面上的「質點」在世界座標上是不動的
 * —— 而 Voronoi 的格柵釘在世界座標上，塊因此只會原地明滅。真實海面的閃光是
 * 隨波傳播的，原地明滅的隨機塊看起來像雜訊。把取樣座標加上 Gerstner 的水平
 * 項，塊就附著在水面上而不是釘在世界上。
 *
 * 位移量是振幅級（五道波合計最大 3.225 m），而格子是 14 m —— 塊只漂 0.23 格。
 * **塊放大到浪的尺度之後，這一層幾乎看不出來了**：水面的動感改由塊自己的
 * 法線傾斜（`SPARKLE_TILT_SHARE`，平滑轉動）與亮塊的閃爍撐著。留著是因為
 * 它是免費的（相位與波梯度共用同一個迴圈），而且塊一旦調小就會重新生效。
 *
 * 【與頂點位移不一致是刻意的】頂點只做垂直位移，而 `WAVES` 一個字都不能動
 * （`crash.ts` 的入水判定、`splash`、`wrecks` 全部走 `heightAt`）。碎光走水平
 * 位移，視覺上是碎光在水面上滑動。
 */
export const SPARKLE_DRIFT = 1.0
/**
 * 重擲頻率，Hz。真實波的週期是 6～16 s，靠波自己動不會「閃」。
 *
 * 【它同時決定單次閃爍的長度】一輪就是一次完整的淡入淡出，長度是
 * `1 / (rate · twinkle)`，而 `rate` 每格落在 0.6～1.4 —— 0.68 對應
 * **1.05～2.45 s**。這個範圍不分密度高低都一樣，見 `sparkleLight`。
 */
export const SPARKLE_TWINKLE = 0.68
/** 亮塊的亮度。> 1 會被截成純白 —— 那正是要的。 */
export const SPARKLE_STRENGTH = 0.6
/**
 * 有可見暗度的塊佔多少比例。
 *
 * 【暗塊不吃 align，亮塊吃】這是兩者最重要的差別。亮塊是 sun glitter，只在
 * 鏡面條件附近成立，所以密度 `p = align · density · fade`。暗塊是**波的背光
 * 面**，整片海都有 —— 乘上 align 的話，遠離太陽那半邊就又回到死平的一塊。
 *
 * 【暗塊不閃】反光會閃是因為波面瞬間對準太陽；背光面是水面的形狀，它隨波
 * 移動但不會明滅。所以這裡用每塊一個固定的 hash 值，靠 `SPARKLE_DRIFT` 帶著
 * 它漂 —— 省掉第二輪擲骰與包絡，只多一次 hash。
 *
 * 【為什麼是 smoothstep 而不是 step】硬門檻會讓塊非黑即白。
 * `smoothstep(1 − q, 1, h)` 在 h 均勻時，超過門檻的比例恰好是 q，而且值從 0
 * 連續漲到 1 —— 有些塊只是微暗，少數才是全黑。
 */
export const SPARKLE_DARK_DENSITY = 0.35
/**
 * 全黑的那些塊剩多少亮度：`1 − 這個值`。0.15 表示最暗掉到 85%。
 *
 * 【為什麼壓得這麼低】暗塊的對比一高就讀作「污漬」而不是「背光的水面」——
 * 白塊有反光這個現成的解釋，暗塊沒有，全靠形狀與強度去暗示。
 */
export const SPARKLE_DARK_STRENGTH = 0.15
/**
 * 暗塊格子的邊長，相對於亮塊的倍率。**暗塊走自己的 Voronoi。**
 *
 * 【兩種尺度是刻意的】暗塊是水面的形狀（波的背光面），亮塊是打在它上面的
 * 反光點 —— 尺度本來就不同。√2 讓暗塊的面積正好是亮塊的兩倍，而每單位面積
 * 的塊數是一半（塊數 ∝ 邊長⁻²），所以**總覆蓋率一個字都不變**，只是同樣多
 * 的暗分成更少、更大的塊。
 *
 * 【代價是多一次 Voronoi】9 次 hash22 加上鄰域搜尋，而且遠海是全螢幕
 * overdraw。這是這個著色器裡最貴的一筆。
 *
 * 【塊的法線傾斜跟著暗塊走】`tilt` 用的是暗塊的格號 —— 大面決定朝向，小的
 * 反光點分佈在上面。於是亮塊會沿著朝光的大面聚集，而不是與明暗各走各的。
 */
export const SPARKLE_DARK_SCALE = Math.SQRT2
/**
 * 塊邊緣的漸層寬度，**單位是像素**。這是抗鋸齒的寬度，不是柔化。
 *
 * low-poly 要的是硬邊：1.2 px 剛好夠讓邊緣不鋸齒，又不會糊成一團光暈。
 *
 * 【為什麼是像素而不是格子比例】塊的螢幕大小現在**隨距離變**（見
 * `SPARKLE_CELL`）—— 500 m 處 38 px、2 km 處 9.5 px。固定的格子比例會讓近處
 * 的邊糊成 4～5 px、遠處只剩半個像素。片段裡用 `oceanDist · uPixelAngle /
 * cellW` 換算回格子單位，任何距離都是同樣的像素數。
 */
export const SPARKLE_EDGE = 1.2
/**
 * Voronoi 特徵點在格內的隨機幅度。0 = 特徵點釘在格心（規則的方形鑲嵌），
 * 1 = 格內完全隨機。
 *
 * 【為什麼要 Voronoi 而不是格內畫一個圓】圓點不管放多大都還是「散落的點」。
 * 而且圓心要 jitter 就得把半徑壓在 0.5 以下（否則圓會被格線切半），半徑一到
 * 上限、夾持區間 [r, 1−r] 就塌成一個點 —— 圓心全部釘在格心，色塊排成規則的
 * 方形網點，讀起來像壁紙。Voronoi 把整個平面**鑲嵌**成不規則多邊形：塊與塊
 * 之間沒有空隙、形狀各不相同、大小也不一樣。那才是 low-poly 水面的樣子。
 *
 * 【1.0 的代價】3×3 鄰域搜尋在 jitter 接近 1 時偶爾會漏掉真正最近的特徵點
 * （它可能落在兩格之外）。標準做法是壓到 0.5 以保證正確，但那也讓塊的形狀
 * 規則得多。這裡選 1.0：漏掉的機率低，而且症狀只是某一塊的邊界稍微歪掉 ——
 * 在一個刻意要不規則的圖樣上，那看不出來。
 */
export const SPARKLE_JITTER = 1.0
/**
 * 未解析的坡度變異數裡，交給**塊的法線傾斜**的比例；剩下的留給 σ。
 *
 * 【這是「浪也要不規則」那一半】σ 是統計的 —— 它讓碎光散開，但不會讓任何一
 * 塊水面真的朝向別的方向。把一部分變異數變成每塊一個顯式的法線傾斜之後，
 * 塊就真的是「一片片朝向不同方向的水面」，亮不亮由它自己的法線決定，而不是
 * 純靠擲骰。那是 low-poly 水面的核心。
 *
 * 【能量不會重複計算】拿走多少就從 σ 扣多少 —— `sigma² = base² + slopeVar
 * − tiltVar`。0 就完全退回上一版的純統計模型。
 *
 * 【它一路延伸到地平線】塊的螢幕張角由 LOD 鎖成常數（見 `SPARKLE_CELL`），
 * 所以遠處的塊不會縮成次像素 —— 沒有「必須收斂成連續場」的距離。遠處反而是
 * 這一層最有用的地方：那裡所有的波都因 Nyquist 淡出、`g` 趨近 0，若沒有塊
 * 傾斜，整片海就會是死平的一塊同色。
 */
export const SPARKLE_TILT_SHARE = 0.6
/**
 * 淡入淡出包絡 `sin(u·π)` 的指數。1 就是純正弦；小於 1 更方（亮得久、進出
 * 較急），大於 1 更尖（只有中段看得見）。**值越大越不柔**，所以它叫指數而
 * 不叫柔化。
 *
 * 【它會平移 SPARKLE_DENSITY 與 SPARKLE_STRENGTH 的觀感】同時亮著的格子比例
 * 恆等於 `1 - thr`（見 `sparkleLight`），但每顆點的**平均亮度**由包絡決定：
 * `∫₀¹ sin(πu)^0.9 du = 0.657`。所以同一個 `SPARKLE_DENSITY` 在這個包絡下的
 * 總能量，比亮度均勻分佈（平均 0.5）的情形高 31%。三個常數都是待人工驗收的
 * 暫定值，驗收時要一起看。
 */
export const SPARKLE_ENVELOPE_POW = 0.9

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

/** 頂點與片段共用的宣告。兩個材質都要。 */
const SPARKLE_COMMON = /* glsl */ `
  uniform float uTime;
  uniform vec2 uWaveDir[${WAVES.length}];
  uniform float uWaveAmp[${WAVES.length}];
  uniform float uWaveLen[${WAVES.length}];
  uniform float uWaveSpd[${WAVES.length}];
  uniform vec3 uSunDirection;
  uniform vec2 uRipDir[${RIPPLE_RESOLVED.length}];
  uniform float uRipAmp[${RIPPLE_RESOLVED.length}];
  uniform float uRipLen[${RIPPLE_RESOLVED.length}];
  uniform float uRipSpd[${RIPPLE_RESOLVED.length}];
  uniform float uRipStaticVar;
  uniform float uSigmaBase;
  uniform float uDrift;
  uniform float uSigmaTail;
  uniform float uTailWeight;
  uniform float uDimLo;
  uniform float uDimHi;
  uniform float uDimFloor;
  uniform float uDensity;
  uniform float uCell;
  uniform float uCellRef;
  uniform float uTwinkle;
  uniform float uSparkleStrength;
  uniform float uEdge;
  uniform float uDarkDensity;
  uniform float uDarkStrength;
  uniform float uDarkScale;
  uniform float uJitter;
  uniform float uTiltShare;
  uniform float uEnvelopePow;
  uniform float uPixelAngle;
  uniform vec3 uSkyHorizon;
  uniform vec3 uSkyZenith;
  uniform float uSkyPower;
  uniform float uReflectF0;
  uniform float uReflectStrength;
  uniform vec3 uWarp;   // x: 振幅 m, y: 波數 A, z: 波數 B
  uniform float uWarpSpd;
  uniform vec3 uWarp2;  // x: 振幅 m, y: 波數 A, z: 波數 B
  uniform vec3 uRipWarp;   // 同上，微波專用。見 RIPPLE_WARP_AMP
  uniform vec3 uRipWarp2;
  uniform vec3 uEnv;    // x: 展幅, y: 波數 A, z: 波數 B
  uniform float uEnvLo;
  uniform float uBaseCell;
  uniform float uInvHalfSeg;
  uniform float uVertFadeLo;
  uniform float uVertFadeHi;
  uniform float uNyqLo;
  uniform float uNyqHi;

  // 座標扭曲。**與 ocean.ts 的 waveWarp 必須逐字相同** —— 那是 CPU 的
  // 那一份，碰撞判定讀它。設計理由見 WAVE_WARP_AMP 與 WAVE_WARP2_AMP。
  vec2 oceanWarp(vec2 p, float time) {
    float t = time * uWarpSpd;
    return vec2(
      sin(p.y * uWarp.y + t * uWarp.y) * uWarp.x
        + sin(p.x * uWarp2.y - t * uWarp2.y + 1.7) * uWarp2.x,
      sin(p.x * uWarp.z - t * uWarp.z) * uWarp.x
        + sin(p.y * uWarp2.z + t * uWarp2.z + 4.1) * uWarp2.x
    );
  }

  // 微波專用的細扭曲。**沒有 CPU 的對應版本** —— 微波不進頂點位移、不進
  // 碰撞判定，所以這一份不必與 waveWarp 一致。設計理由見 RIPPLE_WARP_AMP。
  vec2 oceanRippleWarp(vec2 p, float time) {
    float t = time * uWarpSpd;
    return vec2(
      sin(p.y * uRipWarp.y + t * uRipWarp.y + 2.3) * uRipWarp.x
        + sin(p.x * uRipWarp2.y - t * uRipWarp2.y + 0.9) * uRipWarp2.x,
      sin(p.x * uRipWarp.z - t * uRipWarp.z + 5.1) * uRipWarp.x
        + sin(p.y * uRipWarp2.z + t * uRipWarp2.z + 3.4) * uRipWarp2.x
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

  /** 同一族的 hash22 —— 一次取兩個值，Voronoi 每格只付一次 hash 的成本。 */
  vec2 oceanHash2(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    q += dot(q, q.yzx + 33.33);
    return fract((q.xx + q.yz) * q.zy);
  }

  /**
   * 3x3 鄰域的 Voronoi。回傳 (最近特徵點的格號, F1, F2)。
   *
   * 【F2 - F1 是到塊邊界的距離】兩個特徵點的中垂線上 F1 == F2，往塊心走差值
   * 線性增加。拿它做 smoothstep 就是一條寬度固定的抗鋸齒邊，而且**塊與塊之間
   * 沒有空隙** —— 這是它和「格內畫一個圓」最本質的差別。
   *
   * 【為什麼不用 F1 當形狀】F1 是到特徵點的距離，等值線是圓 —— 用它畫出來的
   * 還是圓點，只是圓心被 jitter 推開了。整個 Voronoi 的意義就在鑲嵌。
   */
  vec4 oceanVoronoi(vec2 uv) {
    vec2 base = floor(uv);
    vec2 f = fract(uv);
    vec2 best = base;
    float f1 = 8.0;
    float f2 = 8.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 nb = vec2(float(i), float(j));
        vec2 cell = base + nb;
        vec2 pt = nb + mix(vec2(0.5), oceanHash2(cell), uJitter);
        float d = length(pt - f);
        if (d < f1) {
          f2 = f1;
          f1 = d;
          best = cell;
        } else if (d < f2) {
          f2 = d;
        }
      }
    }
    return vec4(best, f1, f2);
  }

  /**
   * 亮塊：這個像素的反光強度 0..1。擲骰決定亮不亮、包絡決定亮多久。
   *
   * 抽成函數是為了讓呼叫端能同時算相鄰兩階再交叉淡入 —— 見 SPARKLE_FRAGMENT
   * 裡那段關於 LOD 環的說明。
   *
   * 【時間模型：每輪擲一次骰，亮就走完一整個包絡】每格有自己的相位與速率，
   * 把時間切成一輪一輪。每輪開頭擲一次骰決定這格這一輪亮不亮，機率恰好是傳
   * 進來的 p；亮的話就走完一個 sin(u·π) 的包絡 —— 對稱的淡入淡出，長度是一
   * 整輪。任一時刻「亮著的格子」的比例仍然是 p，所以密度的定義完全沒變。
   * （每顆點的**平均亮度**倒是被包絡改寫了，見 SPARKLE_ENVELOPE_POW。）
   *
   * 【為什麼不是「鋸齒相位超過門檻就亮」】那個寫法把空間密度與單次閃爍的
   * 長度綁死了 —— 一格亮的時間比例恆等於 p，密度一低每次閃爍就短。尾巴區的
   * p 只有 0.015，單次只剩 0.056 s（三個 frame），而且鋸齒在頂端 fract 回 0
   * 是**瞬滅**。看起來就是電視雜訊。擲骰把兩件事拆開：密度仍由 p 決定，長度
   * 由包絡決定，互不影響。
   *
   * 【骰子的 key 不可以是 cell + k】那等於每一輪把整張圖沿對角線平移一格，
   * 是「爬行」不是「重擲」。這裡先用 cell 取一個固定種子，再拿種子與輪號去
   * hash —— 兩個分量對 k 的係數不成比例，圖案不會平移。
   *
   * 【也不可以 mix 兩個隨機值】曾經寫成
   *   n = mix(hash(cell + floor(t)), hash(cell + floor(t) + 1.0), fract(t))
   * 兩個均勻分佈 mix 出來的分佈在 s = 0.5 時是三角形而不是均勻 —— 超過門檻
   * 0.75 的比例從 25% 掉到 12.5%。於是整片海的白點密度以 twinkle 的頻率一起
   * 脹縮，在密度最高的鏡面中心看起來就是「白點以固定頻率放大縮小」。
   */
  /**
   * 這個距離下的格子邊長。
   *
   * 【LOD：隨機挑一階，不要混兩階 —— Codex 2026-08-11 審查的 Important】
   *
   * 塊逼近次像素時格子邊長要隨距離放大。用 2 的冪整數階可以避免格線隨鏡頭
   * 爬動，但代價是跳階：邊長在 dist = 150 / 300 / 600 / 1200 m … 瞬間變兩倍，
   * 而等距離面在海上是一圈圈的圓 —— 相機降高度時 sqrt(h*h + rho*rho) = 150
   * 的 rho 變大，就看到一圈內圈往外擴。
   *
   * 前一版仿 trilinear mipmap 同時算兩階再 mix。那**修掉了環，卻換來另一個
   * 問題**：mix 兩個近似獨立的 0/1 分佈，平均值不變（所以不是先前那個密度
   * 脹縮的 bug），但變異數掉一半 —— 「拿到完整強度」的機率從 p 掉到 p²
   * （中心 0.4 → 0.16）。症狀是每個 LOD 中點附近亮塊變少、碎光發灰，形成按
   * 二倍距離重複的低對比同心帶。
   *
   * 改成**以粗階格號為單位隨機挑一階**：每個像素拿到的都是完整強度的一層，
   * 分佈完全不變；階與階的過渡用空間抖動化開。而且只算一層，成本減半。用
   * 粗階格號當 key 是為了讓同一格內的像素挑到同一階（不然一塊會被撕成兩半），
   * 而且與時間無關 —— 不會閃。
   */
  float oceanCellWidth(vec2 swxz, float dist) {
    float f = max(0.0, log2(max(1.0, dist / uCellRef)));
    float lo = floor(f);
    float coarse = uCell * exp2(lo + 1.0);
    float pick = step(oceanHash(floor(swxz / coarse) + vec2(7.7, 3.3)), f - lo);
    return uCell * exp2(lo + pick);
  }

  float sparkleLight(vec4 vor, float p, float t, float edge) {
    vec2 cell = vor.xy;

    float phase = oceanHash(cell);
    float rate = 0.6 + 0.8 * oceanHash(cell + vec2(37.0, 91.0));
    float cycle = phase + t * rate;
    float k = floor(cycle);
    float u = fract(cycle);

    // 【傳 p 而不是傳 1 - p】p 在尾巴區小到 1e-3 以下，而 float32 在 1.0
    // 附近的 ulp 是 6e-8 —— 用「1 減去它」的形式來回一趟，小 p 的相對精度
    // 就沒了。呼叫端也是直接算出 p 的。
    //
    // 【用 roll < p 而不是 step(roll, p)】p 會**恰好等於 0**：dist >=
    // uFadeEnd 時 fade 明確是 0，align 在大角度下也會 underflow 成 0。
    // step(roll, 0.0) 在 roll 剛好是 0 的那些格子會回 1 —— 250 km 外那片
    // 早該全黑的海上會殘留零星亮塊。roll < 0.0 恆為 false。
    float seed = oceanHash(cell + vec2(5.9, 11.3));
    float roll = oceanHash(vec2(seed * 512.0 + k, seed * 731.0 - k * 1.3));
    float on = roll < p ? 1.0 : 0.0;

    // 對稱的淡入淡出。
    //
    // 【max 那一層是 NaN 的保險】GLSL ES 明定 pow(x, y) 在 x == 0 且 y <= 0
    // 時未定義；這裡 y = 0.9 > 0，所以 pow(0.0, 0.9) 有定義、等於 0。但
    // on * pow(...) **擋不住** NaN —— 0.0 * NaN 還是 NaN，而 NaN 一旦進了
    // gl_FragColor，那一整片海會出現黑塊，而且是平台相依的。夾一個下限就
    // 不必賭驅動的實作。
    float lit = on * pow(max(sin(u * 3.14159265), 1e-6), uEnvelopePow);

    // 【整塊填滿，只在邊界留一個像素的抗鋸齒】low-poly 要的是硬邊，而 Voronoi
    // 塊本來就無縫鑲嵌 —— 亮起來就是整塊亮。F2 - F1 在塊的邊界上是 0。
    return lit * smoothstep(0.0, edge, vor.w - vor.z);
  }

  /**
   * 暗塊：每塊一個固定的暗度，**不擲骰、不吃 p、也不閃**。
   *
   * 它是水面的形狀不是反光 —— 見 SPARKLE_DARK_DENSITY。塊隨 drift 漂，所以
   * 靜態的值看起來照樣在動。走的是自己那套較粗的格柵，見 SPARKLE_DARK_SCALE。
   */
  float sparkleDark(vec4 vor, float edge) {
    float dark = smoothstep(1.0 - uDarkDensity, 1.0, oceanHash(vor.xy + vec2(71.3, 19.7)));
    return dark * smoothstep(0.0, edge, vor.w - vor.z);
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
 * 【`oceanFoot` 也在這裡算】它只吃 `oceanDist` 與 `oceanV`，兩個都在這一段
 * 就有了 —— 順手算完，碎光那一段直接用。
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

  // 這個像素在世界上的 footprint。**解析式，不用 dFdx** —— 硬體導數在 2x2
  // quad 內是常數，那 2 px 的階梯會一路傳成畫面上的混疊條紋。見 PIXEL_ANGLE。
  //
  // oceanV.y 是視線與海面夾角的 sin：掠射時趨近 0，footprint 沿視線被放大，
  // 那正是地平線附近需要的。下限 0.02 把放大倍率封在 50 倍。
  float oceanFoot = oceanDist * uPixelAngle / max(oceanV.y, 0.02);

  // 大氣透視的量。**在塊外宣告**，因為碎光那段（SPARKLE_FRAGMENT）也要用它
  // 把交界區的白點沖淡。**用仰角 oceanV.y 而不是距離**：只有視線掠向地平線
  // （oceanV.y 小）才融入天空，中遠海保持本色，不會整片糊成霧。見 SEA_AERIAL_HI。
  float oceanAerial = smoothstep(uAerialHi, uAerialLo, oceanV.y) * uAerialStrength;

  // 水面法線。**在塊外宣告**，因為天空反射那一段排在碎光的 fade 守衛之外
  // —— 地平線附近（距離 > uFadeEnd）正是反射最強的地方，不能跟著碎光一起
  // 被 early-out 掉。預設是平坦的 +Y，碎光那一段解析得出波形時再覆蓋它。
  vec3 oceanNormal = vec3(0.0, 1.0, 0.0);

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
const SPARKLE_FRAGMENT = /* glsl */ `
  {
    // 視線量在 SEA_DIM_FRAGMENT 就算好了 —— 那一段必須排在這之前。
    float fade = 1.0 - smoothstep(uFadeStart, uFadeEnd, oceanDist);

    // 【先算淡出、能收就收 —— Codex 2026-08-11 審查的 Important】
    // 遠海 renderOrder = -1（先畫），所以近海覆蓋掉的區域**無法**靠 early-Z
    // 省掉遠海的 fragment，而遠海是全螢幕的。uFadeEnd（250 km）之外佔了遠海
    // 絕大部分的面積，在這裡收掉就跳過九次 cos、五次 sin、兩次 exp、六次
    // hash，以及二十次 hash22（兩套 Voronoi 各九次、塊傾斜兩次）。
    if (fade > 0.0) {
      vec2 wxz = vOceanWorld.xz;

      // 【每一道波按「這個像素還分不分得出它」淡出】分不出來的波不是丟掉，
      // 是把它的坡度變異數交給 σ —— 見 SPARKLE_SIGMA_BASE。w 用平方進 slopeVar
      // 是因為變異數是二次量：解析到 w 的振幅，剩下的能量就是 1 - w²。
      //
      // 【門檻是 Nyquist，不是波長本身】取樣間隔要小於 λ/2 才不混疊，所以
      // foot 到 λ/2 就必須完全淡出，λ/4 開始收。用 λ→2λ 會讓每一道波在
      // [λ/2, 2λ] 那整段都還在貢獻 —— 規則的波配上接近其頻率的像素格柵，
      // 症狀就是太陽反射區的摩爾紋。
      // 【解析的尺度下限是「像素」與「塊」的較大者】比一個塊還小的波，在塊內
      // 看不到形狀 —— 塊是單色的。讓它們也轉成 σ，否則 align 在塊內劇烈變化，
      // 而亮塊的門檻是逐像素的 roll < p，一塊就會被撕成好幾片。
      //
      // 名目塊寬不含 LOD 的 pick（那需要 drift 後的座標，而 drift 正是這個
      // 迴圈算出來的）。差一階對「哪些波該轉成統計」沒有影響。
      float cellNominal = uCell * exp2(max(0.0, log2(max(1.0, oceanDist / uCellRef))));
      float shadeScale = max(oceanFoot, cellNominal);

      // 【與頂點位移同一個扭曲】見 WAVE_WARP_AMP。碎光的取樣座標（swxz）
      // 刻意**不**扭曲 —— 那是塊的鋪法，與浪的形狀是兩件事。
      vec2 pwxz = wxz + oceanWarp(wxz, uTime);
      // 【包絡吃未扭曲的座標】見 gerstnerHeight 的同一行
      float envG = oceanEnvField(wxz, uTime);

      vec2 g = vec2(0.0);
      vec2 drift = vec2(0.0);
      // 【不是 0】比 shadeScale 的地板還細的那幾道微波在任何距離都淡光，
      // 貢獻是個常數 —— 見 RIPPLE_RESOLVED。
      float slopeVar = uRipStaticVar;

      // 解析波坡度與質點的水平位移。**與頂點位移用同一組波、同一個未正規化
      // 的 uWaveDir** —— 不一致的話亮塊就會與浪的形狀分家。兩者共用同一個
      // 相位，所以合在一個迴圈裡算。
      //
      // drift 不淡出：它只在顆粒還在的近處有意義，而那裡三道波都完全解析。
      for (int i = 0; i < ${WAVES.length}; i++) {
        float k = 6.28318530718 / uWaveLen[i];
        float ph = k * dot(uWaveDir[i], pwxz) - uWaveSpd[i] * k * uTime;
        float w = 1.0 - smoothstep(uWaveLen[i] * uNyqLo, uWaveLen[i] * uNyqHi, shadeScale);
        float ak = uWaveAmp[i] * k * length(uWaveDir[i]);
        // 【包絡只進振幅，不進導數】包絡在 900 m 的尺度上變化而波長是
        // 140 m —— dA/dx 那一項比 A·k 小一個量級。忽略它讓 CPU 與 GPU
        // 三份公式維持逐字相同，代價是坡度在包絡邊界差幾個百分點
        float env = oceanEnv(envG, float(i));
        ak *= env;
        g += w * uWaveAmp[i] * env * k * cos(ph) * uWaveDir[i];
        drift -= uWaveAmp[i] * env * sin(ph) * uWaveDir[i];
        slopeVar += (1.0 - w * w) * ak * ak * 0.5;
      }

      // 只給法線的微波 —— 不進頂點位移、不進 drift、不進碰撞判定。
      // 見 RIPPLE_WAVES。**只有還畫得出形狀的那幾道**，見 RIPPLE_RESOLVED。
      //
      // 【多一層細扭曲】微波的尺度是 10 m 級，而 oceanWarp 的尺度是幾百到
      // 幾千公尺 —— 對它們來說那只是平移，波峰照樣筆直。見 RIPPLE_WARP_AMP。
      vec2 rwxz = pwxz + oceanRippleWarp(pwxz, uTime);
      for (int i = 0; i < ${RIPPLE_RESOLVED.length}; i++) {
        float k = 6.28318530718 / uRipLen[i];
        float ph = k * dot(uRipDir[i], rwxz) - uRipSpd[i] * k * uTime;
        float w = 1.0 - smoothstep(uRipLen[i] * uNyqLo, uRipLen[i] * uNyqHi, shadeScale);
        float ak = uRipAmp[i] * k;
        g += w * ak * cos(ph) * uRipDir[i];
        slopeVar += (1.0 - w * w) * ak * ak * 0.5;
      }
      // 【碎光的取樣座標跟著水面走】見 SPARKLE_DRIFT。Voronoi 與 LOD 的選階
      // 都用同一個座標 —— 分家的話同一塊會被撕成兩階。
      vec2 swxz = wxz + drift * uDrift;

      // Voronoi 塊、以及每塊自己的法線傾斜。**一路到地平線都有塊** —— LOD
      // 把塊的螢幕張角鎖成常數（見 SPARKLE_CELL），所以遠處的塊不會縮成次
      // 像素，沒有「必須收斂成連續場」的距離。
      float cellW = oceanCellWidth(swxz, oceanDist);
      vec4 vor = oceanVoronoi(swxz / cellW);
      vec4 vorDark = oceanVoronoi(swxz / (cellW * uDarkScale));

      // 【每塊自己的法線傾斜 —— low-poly 的「面」】幅度取自未解析的坡度
      // 變異數，見 SPARKLE_TILT_SHARE。每塊一組獨立的相位與速率，所以整片
      // 不會同步呼吸；用 sin 而不是重擲，塊才會平滑地轉向而不是跳。
      //
      // 兩個分量各給變異數 tiltVar/2，合起來 E[|tilt|²] = tiltVar —— 與
      // slopeVar 同一個慣例（那也是總坡度的變異數，不分軸）。
      float tiltVar = slopeVar * uTiltShare;
      vec2 tp = oceanHash2(vorDark.xy + vec2(61.3, 7.9)) * 6.28318530718;
      vec2 tr = 0.4 + 0.7 * oceanHash2(vorDark.xy + vec2(13.7, 83.1));
      vec2 tilt = sin(tp + uTime * uTwinkle * tr) * sqrt(tiltVar);

      // 【碎光用帶塊傾斜的法線，天空反射用不帶的】兩者要的東西相反：
      //
      //   碎光   要的是「這一小塊有沒有正好對準太陽」—— 塊各自亂轉才會
      //          一顆一顆閃，那正是 low-poly 碎光的樣子
      //   反射   反的是**整片天空**。未解析的坡度在物理上該讓反射**變糊**
      //          （往平均法線收斂），不是讓每塊各反一塊天
      //
      // 用同一條的話，地平線附近會整片高頻雜訊：那裡波全被 Nyquist 淡掉、
      // slopeVar 最大、於是 tilt 也最大，而塊的螢幕張角被 LOD 鎖成常數 ——
      // 亂數不隨距離收斂，畫面就永遠是一片跳動的花。
      oceanNormal = normalize(vec3(-g.x, 1.0, -g.y));
      vec3 N = normalize(vec3(-g.x + tilt.x, 1.0, -g.y + tilt.y));

      // 【用 1 - cos 而不是 acos】acos 在接近 1 的地方數值極差，而鏡面附近
      // 正好全都在那裡。theta^2 約等於 2(1 - cos theta)，所以高斯可以直接用
      // 1 - cos 寫。sigma 4 度時相對誤差 0.02%，8 度 0.33%，12 度 1.7%
      //
      // oceanH 在 SEA_DIM_FRAGMENT 就算好了 —— 與基色用的是同一個向量。
      float cosNH = clamp(dot(N, oceanH), 0.0, 1.0);

      // 【雙核】窄核保住方向選擇性，寬核鋪出稀疏的尾巴，讓鏡面圈之外也有零星
      // 白點。用 mix 不用加法 —— 兩個高斯在鏡面點都是 exp(0) = 1，中心因此
      // 嚴格不變。見 SPARKLE_TAIL_WEIGHT。
      // 【σ = 基底 + 沒解析到的波】見 SPARKLE_SIGMA_BASE。近處 slopeVar 就是
      // uRipStaticVar、σ 約 7.5°，碎光跟著 11 m 那一階的形狀；遠處連那一階
      // 也淡出，σ 長到 11°，掠射角才中得了鏡面條件。
      // 塊傾斜拿走多少就從這裡扣多少，總能量守恆 —— 見 SPARKLE_TILT_SHARE。
      // max 只是浮點的保險：uSigmaBase 為正，理論上不會到 0。
      float sigma = sqrt(max(uSigmaBase * uSigmaBase + slopeVar - tiltVar, 1e-8));

      float narrow = exp(-(1.0 - cosNH) / (sigma * sigma));
      float tail = exp(-(1.0 - cosNH) / (uSigmaTail * uSigmaTail));
      float align = mix(narrow, tail, uTailWeight);
      float p = align * uDensity * fade;


      // 【暗處】塊與波的法線從沒進過 three 的光照鏈，補一階 Lambert 差
      // —— 見 SEA_SHADE_GAIN。**必須排在加碎光之前**，否則亮塊也會被調暗。
      gl_FragColor.rgb *= 1.0 + (dot(N, uSunDirection) - uSunDirection.y) * uShadeGain;

      // 【遠處的反光要暗下來】海面不吃霧，所以碎光得自己補這段大氣消光 ——
      // 見 SPARKLE_ATTEN_NEAR。只乘在加法項上，海的基色不受影響。
      float atten = mix(1.0, uFarDim, smoothstep(uAttenNear, uAttenFar, oceanDist));

      // 【黑先畫、白疊上】白是加法項而且排在後面，所以同一塊同時中了暗與亮
      // 時，白蓋過黑 —— 不會出現「暗塊上有半截白斑」。
      // 【邊緣寬度從像素換算回格子單位】uEdge 的單位是像素，而塊的螢幕大小
      // 隨距離變 —— 見 SPARKLE_EDGE。這裡用**不含掠射放大**的 footprint
      // （oceanDist · uPixelAngle），因為抗鋸齒要的是螢幕上的寬度，不是沿
      // 視線的世界距離。clamp 的上界擋住掠射時邊緣糊掉整塊。
      float edgeWorld = uEdge * oceanDist * uPixelAngle;
      float edgeLight = clamp(edgeWorld / cellW, 0.005, 0.4);
      float edgeDark = clamp(edgeWorld / (cellW * uDarkScale), 0.005, 0.4);

      // 【霧化區把黑白塊一起沖淡】遠海融進天空後不該再有清楚的碎光。
      // oceanAerial 在 SEA_DIM_FRAGMENT 算好（排在本段之前）。
      float sparkleKeep = 1.0 - oceanAerial;
      gl_FragColor.rgb *= 1.0 - sparkleDark(vorDark, edgeDark) * uDarkStrength * fade * sparkleKeep;
      gl_FragColor.rgb += sparkleLight(vor, p, uTime * uTwinkle, edgeLight) * uSparkleStrength * atten * sparkleKeep * vec3(1.0, 0.98, 0.94);
    }
    // ── 天空反射（菲涅耳）──────────────────────────────────────────
    //
    // 【為什麼這是海面最像水的那一項】從飛機上看海，掠射角佔了畫面絕大部分，
    // 而水在掠射角的反射率逼近 1 —— 那時看到的**幾乎全是天空**，不是水體的
    // 顏色。少了這一層，海就是一片死藍的板子，與天空硬碰硬（2026-08-26 的
    // 五張姿態截圖就是這個症狀）。
    //
    // 【它與碎光是同一件事的兩端】碎光是「反射到太陽」的那一小塊，這裡是
    // 「反射到整片天空」的其餘部分。兩者共用同一條 oceanNormal，所以波
    // 的形狀會同時出現在反光與反射裡 —— 那正是水面深淺波紋的來源。
    //
    // 【Schlick 近似】F = F0 + (1 − F0)(1 − cosθ)⁵，θ 是視線與法線的夾角。
    // 掠射（cosθ → 0）時 F → 1，垂直俯視時 F → F0 = 0.02，也就是幾乎看不到
    // 反射、看到的是海自己的顏色。**那個由近到遠的明暗變化因此是算出來的，
    // 不是調出來的。**
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
    // 在 if(fade) 外 —— 大氣透視是所有海面像素都有，不受碎光範圍限制。
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
  // clipmap 的十層。L0 實心，其餘挖掉中央 —— 那一塊由內一層負責
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
   * 兩份會漂開，症狀是 5 km 接縫兩側的白點密度不一樣。
   */
  const sparkle = {
    uWaveDir: { value: WAVES.map((w) => new Vector2(w.dirX, w.dirZ)) },
    uWaveAmp: { value: WAVES.map((w) => w.amplitude) },
    uWaveLen: { value: WAVES.map((w) => w.wavelength) },
    uWaveSpd: { value: WAVES.map((w) => w.speed) },
    uSunDirection: { value: new Vector3(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]) },
    uRipDir: { value: RIPPLE_RESOLVED.map((w) => new Vector2(w.dirX, w.dirZ)) },
    uRipAmp: { value: RIPPLE_RESOLVED.map((w) => w.amplitude) },
    uRipLen: { value: RIPPLE_RESOLVED.map((w) => w.wavelength) },
    uRipSpd: { value: RIPPLE_RESOLVED.map((w) => w.speed) },
    uRipStaticVar: { value: RIPPLE_STATIC_VAR },
    uSigmaBase: { value: SPARKLE_SIGMA_BASE },
    uDrift: { value: SPARKLE_DRIFT },
    uSigmaTail: { value: SPARKLE_SIGMA_TAIL },
    uTailWeight: { value: SPARKLE_TAIL_WEIGHT },
    uDimLo: { value: SEA_DIM_LO },
    uDimHi: { value: SEA_DIM_HI },
    uDimFloor: { value: SEA_DIM_FLOOR },
    uDensity: { value: SPARKLE_DENSITY },
    uCell: { value: SPARKLE_CELL },
    uCellRef: { value: SPARKLE_CELL_REF },
    uTwinkle: { value: SPARKLE_TWINKLE },
    uSparkleStrength: { value: SPARKLE_STRENGTH },
    uEdge: { value: SPARKLE_EDGE },
    uDarkDensity: { value: SPARKLE_DARK_DENSITY },
    uDarkStrength: { value: SPARKLE_DARK_STRENGTH },
    uDarkScale: { value: SPARKLE_DARK_SCALE },
    uJitter: { value: SPARKLE_JITTER },
    uTiltShare: { value: SPARKLE_TILT_SHARE },
    uEnvelopePow: { value: SPARKLE_ENVELOPE_POW },
    uPixelAngle: { value: PIXEL_ANGLE },
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
    uRipWarp: {
      value: new Vector3(
        RIPPLE_WARP_AMP, (Math.PI * 2) / RIPPLE_WARP_LEN_A, (Math.PI * 2) / RIPPLE_WARP_LEN_B),
    },
    uRipWarp2: {
      value: new Vector3(
        RIPPLE_WARP2_AMP, (Math.PI * 2) / RIPPLE_WARP2_LEN_A, (Math.PI * 2) / RIPPLE_WARP2_LEN_B),
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
           uniform vec2 uOrigin;
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

                // 【這個頂點所在的層有多粗】十層都以相機為中心，而第 L 層
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
        .replace(
          '#include <opaque_fragment>',
          `#include <opaque_fragment>\n${SPARKLE_FRAGMENT}`,
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
    // 【一律不做視錐剔除】包圍球看不到頂點位移，而且十層全部以相機為
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
    update(time, centerX, centerZ) {
      uTime.value = time
      // 【十層共用同一個中心，而且不做格點對齊】對齊本來是為了避免頂點在
      // 格點之間滑動造成波形抖動 —— 那是沒有頻帶限制時才會發生的混疊。
      // 現在每個頂點按離相機的距離把解析不出來的波淡掉（見
      // OCEAN_VERT_FADE_LO），取樣永遠在 Nyquist 之內，滑動只剩內插誤差。
      //
      // 不對齊還換來一件事：十層可以共用同一個 uOrigin。對齊的話每層要各自
      // 對到自己的格子，中心就會分家，交界處也跟著錯開。
      // 【設在群組上，不是每一層】十層共用同一個中心，那正是它們不裂開的
      // 前提。設在群組上讓那件事是**結構保證**的，不是每幀記得同步的
      mesh.position.set(centerX, 0, centerZ)
      uOrigin.value.set(centerX, centerZ)
      // 【遠海不做格點對齊】對齊是為了避免頂點在格點之間滑動造成波形抖動，
      // 而遠海沒有波。精確跟著中心走，才不會在極端座標下累積偏差。
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
