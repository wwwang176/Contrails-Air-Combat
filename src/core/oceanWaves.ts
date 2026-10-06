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
 * 那也是 SEA_SHADE_GAIN 關著的原因（見該常數的註解：「明暗會沿波形成規則
 * 的橫條紋」）。不畫明暗躲得掉一次，但天空反射一上來，同一個格柵又會從
 * 反射裡浮出來。
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
 * ── 【為什麼要這麼長】────────────────────────────────────
 *
 * 扭曲自己有週期。900 與 1100 的最小公倍數是 9,900 m，而 6,000 m 高空
 * 正俯視時畫面涵蓋約 7.6 km —— 那個圖樣在同一張畫面裡重複七、八次，比它
 * 要打散的波還好認，從高空看非常明顯。
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
 * 【為什麼它與天空反射綁在一起】沒有天空反射時波法線對顏色的影響極小
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
