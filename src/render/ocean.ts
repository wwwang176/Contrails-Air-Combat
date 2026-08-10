import {
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Vector2,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from 'three'

export interface WaveSpec {
  dirX: number
  dirZ: number
  amplitude: number
  /** 波長，公尺 */
  wavelength: number
  /** 相位速度，m/s */
  speed: number
}

/** 波參數的唯一權威來源：同時餵給 shader uniform 與 CPU 的 gerstnerHeight。 */
export const WAVES: readonly WaveSpec[] = [
  { dirX: 1.0, dirZ: 0.15, amplitude: 1.1, wavelength: 140, speed: 9.0 },
  { dirX: 0.55, dirZ: -0.84, amplitude: 0.7, wavelength: 78, speed: 7.2 },
  { dirX: -0.3, dirZ: 0.95, amplitude: 0.35, wavelength: 31, speed: 5.1 },
]

/**
 * CPU 端波高。必須與 shader 的頂點位移公式完全一致，
 * 否則會出現視覺與碰撞判定不一致。
 */
export function gerstnerHeight(x: number, z: number, time: number): number {
  let h = 0
  for (const w of WAVES) {
    const k = (Math.PI * 2) / w.wavelength
    h += w.amplitude * Math.sin(k * (w.dirX * x + w.dirZ * z) - w.speed * k * time)
  }
  return h
}

export const OCEAN_SIZE = 10000
export const OCEAN_SEGMENTS = 192

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
 * 【為什麼是負的】三道波的振幅和是 2.15 m，細浪面的最低點因此是 −2.15。
 * 遠海放在 0 會在波谷之間穿插、產生 z-fighting。放在 −3 保證它在 ±5 km
 * 的範圍內**永遠被細浪面蓋住**。
 *
 * 代價是接縫處有一道 3 m 的落差 —— 在 5 km 外張角 0.6 mrad（0.034°），
 * 而 1080p / 65° FOV 的一個像素是 0.06°。落在一個像素以內。
 */
export const FAR_SEA_Y = -3

/**
 * 海的基本色。細浪面與遠海**必須共用**這一個值 —— 兩份會漂開，而漂開的
 * 症狀是 5 km 處出現一條色帶。
 *
 * 【2026-08-10 壓深】專案負責人：「海再深色一點。」`0x1d3f5c`（L 0.060）→
 * `0x18344c`（L 0.041），色相與飽和不動，只降明度 32%。
 *
 * 同一次把天空的下半提亮（`sky.ts`），所以海天那一階由 0.371 變成 **0.454**
 * —— `fog.test.ts` 要求 > 0.25，更遠離門檻而不是更接近。
 *
 * 【這是 base color，不是畫面上的像素】海面走 `MeshPhysicalMaterial`，實際
 * 亮度還要過一次 PBR 著色，比這個值亮。要再深就繼續降這裡，測試那一側只會
 * 更寬鬆。
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
 * 太陽碎光白點的參數。**全部是待驗收的暫定值。**
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
 * 對齊的角度容差（弧度）。**這是方向選擇性，不只是「亮區多寬」。**
 *
 * 【開太大會讓亮區跑到正下方 —— 2026-08-11 實測】σ 12° 時，「相機正下方」與
 * 「真正的鏡面點」的 align 只差 1.4 倍：
 *
 *   σ      正下方   鏡面點   對比
 *   12°    0.703    1.000    1.4×   ← 選擇性沒了，亮區變成相機正下方的圓
 *    8°    0.453    1.000    2.2×
 *    5°    0.132    1.000    7.6×
 *    4°    0.042    1.000    23.8×
 *
 * 原因：對一台朝下的相機，正下方大片區域的 V 都近乎垂直，H 固定偏離 +Y
 * 18.5°；波法線最多斜 8.4°，所以夾角最小 10.1°。σ 一旦大到讓 10.1° 也算
 * 「對齊」，最亮的地方就變成「視線最垂直的位置」而不是鏡面點。
 */
export const SPARKLE_SIGMA = (4 * Math.PI) / 180
/** 完全對齊時有多少比例的格子會亮。 */
export const SPARKLE_DENSITY = 0.4
/**
 * 參考距離內的格子邊長，m —— 這決定白點的顆粒大小。
 *
 * 【改這個不會改總覆蓋率】覆蓋率 = 每單位面積的點數 x 每點面積
 * = (p / cellW²) x (π (r·cellW)²) = p·π·r² —— cellW 消掉了。所以縮小格子只是
 * 把同樣多的白分成更細的顆粒，不會變亮也不會變暗。
 *
 * 【螢幕上的大小是常數】LOD 交叉淡入之後格子邊長連續正比於距離，張角恆為
 * uCell/uCellRef。0.425/150 = 0.163°，1280 寬 / 65° 下約 3.2 px，而且 1 km
 * 與 500 km 一樣。再往下就會逼近單像素，混疊會回來。
 */
export const SPARKLE_CELL = 0.425
/** 超過這個距離，格子邊長開始隨距離加倍（壓次像素混疊）。 */
export const SPARKLE_CELL_REF = 150
/** 重擲頻率，Hz。真實波的週期是 6～16 s，靠波自己動不會「閃」。 */
export const SPARKLE_TWINKLE = 0.27
/** 白點的亮度。> 1 會被截成純白 —— 那正是要的。 */
export const SPARKLE_STRENGTH = 0.6
/**
 * 白點的半徑，格子邊長的比例。**0.5 是上限** —— 圓心夾在 [r, 1−r] 之內才不會
 * 被格線切半，r > 0.5 那個區間就是空的。要再糊只能加 SPARKLE_CELL。
 */
export const SPARKLE_DOT_RADIUS = 0.5
/** 亮滅的柔化區間。0 = 硬切（會有瞬間亮滅），越大淡入淡出越慢。 */
export const SPARKLE_SOFTNESS = 0.9
/**
 * 白點的淡出區間，m。
 *
 * 【它擋的不是「顆粒太小」—— 2026-08-11 修正】初版設 6→25 km，理由寫「遠處
 * 顆粒必然小於一個像素」。加了 LOD 交叉淡入之後那個理由**不成立**了：格子
 * 邊長變成連續地正比於距離，所以螢幕張角是常數 0.325°（約 6.4 px），
 * 1 km 與 500 km 完全一樣清楚。6→25 km 等於把碎光路砍在遠海剛開始的地方
 * （遠海從 5 km 起），遠海上只剩一條窄帶。
 *
 * 真正需要淡出的是**地平線附近**：視線幾乎與海面平行時，一個像素橫跨的距離
 * 範圍極大，LOD 在單一像素內劇烈變化，那裡的混疊沒救。所以在地平線之前收掉。
 */
export const SPARKLE_FADE_START = 60000
export const SPARKLE_FADE_END = 250000

/** 頂點與片段共用的宣告。兩個材質都要。 */
const SPARKLE_COMMON = /* glsl */ `
  uniform float uTime;
  uniform vec2 uWaveDir[${WAVES.length}];
  uniform float uWaveAmp[${WAVES.length}];
  uniform float uWaveLen[${WAVES.length}];
  uniform float uWaveSpd[${WAVES.length}];
  uniform vec3 uSunDirection;
  uniform float uSigma;
  uniform float uDensity;
  uniform float uCell;
  uniform float uCellRef;
  uniform float uTwinkle;
  uniform float uSparkleStrength;
  uniform float uDotRadius;
  uniform float uSoftness;
  uniform float uFadeStart;
  uniform float uFadeEnd;
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

  /**
   * 單一個顆粒層：給定格子邊長，回傳這個像素的白點強度 0..1。
   *
   * 抽成函數是為了讓呼叫端能同時算相鄰兩階再交叉淡入 —— 見 SPARKLE_FRAGMENT
   * 裡那段關於 LOD 環的說明。
   *
   * 【每格一個獨立的鋸齒相位 —— 不可以 mix 兩個隨機值】初版寫
   *   n = mix(hash(cell + floor(t)), hash(cell + floor(t) + 1.0), fract(t))
   * 有兩個各自獨立的錯：
   *
   * 1. fract(t) 對每一格都是同一個值。兩個均勻分佈 mix 出來的分佈在
   *    s = 0.5 時是三角形而不是均勻 —— 超過門檻 0.75 的比例從 25% 掉到
   *    12.5%。於是整片海的白點密度以 twinkle 的頻率一起脹縮，在密度最高的
   *    鏡面中心看起來就是「白點以固定頻率放大縮小」。
   * 2. cell + floor(t) 是把純量加到兩個分量上，等於每一步把整個圖案沿對角線
   *    平移一格 —— 那是「爬行」不是「重擲」。
   *
   * 鋸齒相位在任何時刻都是均勻分佈，所以亮的比例恆等於門檻所要求的比例；
   * 每格再乘一個不同的速率，格與格之間不會同步。
   */
  float sparkleLayer(vec2 wxz, float cellW, float thr, float t) {
    vec2 uv = wxz / cellW;
    vec2 cell = floor(uv);
    vec2 local = fract(uv);

    float phase = oceanHash(cell);
    float rate = 0.6 + 0.8 * oceanHash(cell + vec2(37.0, 91.0));
    float n = fract(phase + t * rate);

    // 【時間上的柔化】step 是硬性 0/1，白點會瞬間亮滅。改成在門檻上方
    // uSoftness 的區間內漸亮。min 是因為門檻本身可能已經貼近 1
    float lit = smoothstep(thr, min(thr + uSoftness, 1.0), n);

    // 【形狀上的柔化】格子是方的，整格上色邊緣就是直角。改成格內取一個隨機
    // 圓心、從圓心就開始漸層 —— 柔到底的圓，也比硬方塊好抗鋸齒。圓心夾在
    // [r, 1-r] 之內，免得靠邊的點被格線切掉半邊
    vec2 jitter = vec2(oceanHash(cell + vec2(5.0, 13.0)), oceanHash(cell + vec2(23.0, 41.0)));
    jitter = mix(vec2(uDotRadius), vec2(1.0 - uDotRadius), jitter);
    float d = length(local - jitter);
    float shape = 1.0 - smoothstep(0.0, uDotRadius, d);

    return lit * shape;
  }
`

/**
 * 疊在 `opaque_fragment` 之後（線性空間）。
 *
 * 【為什麼遠海也能用同一段】著色只吃世界座標，與幾何平不平無關 —— 遠海雖然
 * 只有兩個三角形，這裡照樣算得出真實的波法線與白點。
 */
const SPARKLE_FRAGMENT = /* glsl */ `
  {
    vec2 wxz = vOceanWorld.xz;

    // 解析波坡度。**與頂點位移用同一組波、同一個未正規化的 uWaveDir** ——
    // 不一致的話白點就會與浪的形狀分家
    vec2 g = vec2(0.0);
    for (int i = 0; i < ${WAVES.length}; i++) {
      float k = 6.28318530718 / uWaveLen[i];
      float c = uWaveAmp[i] * k * cos(k * dot(uWaveDir[i], wxz) - uWaveSpd[i] * k * uTime);
      g += c * uWaveDir[i];
    }
    vec3 N = normalize(vec3(-g.x, 1.0, -g.y));

    vec3 toEye = cameraPosition - vOceanWorld;
    float dist = length(toEye);
    vec3 V = toEye / max(dist, 1e-4);
    vec3 H = normalize(V + uSunDirection);

    // 【用 1 − cos 而不是 acos】acos 在接近 1 的地方數值極差，而鏡面附近
    // 正好全都在那裡。θ² ≈ 2(1 − cos θ)，所以高斯可以直接用 1 − cos 寫
    float cosNH = clamp(dot(N, H), 0.0, 1.0);
    float align = exp(-(1.0 - cosNH) / (uSigma * uSigma));

    float fade = 1.0 - smoothstep(uFadeStart, uFadeEnd, dist);
    float thr = 1.0 - align * uDensity * fade;

    // 【跨階交叉淡入，不然會看到一圈一圈的環 —— 2026-08-11 實測】
    //
    // 遠處的顆粒必然小於一個像素，所以格子邊長要隨距離放大。用 2 的冪整數階
    // （exp2(floor(...))）可以避免格線隨鏡頭爬動，但代價是**跳階**：邊長在
    // dist = 150 / 300 / 600 / 1200 m 這些距離上瞬間變兩倍。
    //
    // 那些等距離面在海上就是一圈圈的圓。相機高 h、水平距離 ρ 的點距離是
    // sqrt(h*h + ρ*ρ)，所以 h 降低時「距離 = 150」的 ρ 會變大 —— 環往外擴，
    // 環內顆粒細、環外顆粒粗。慢慢降高度就會看到一圈內圈往外長。
    //
    // 解法與貼圖的 trilinear mipmap 完全相同：同時算相鄰兩階，用小數部分
    // 交叉淡入。代價是這一段的 hash 算兩次。
    float f = max(0.0, log2(max(1.0, dist / uCellRef)));
    float lo = floor(f);
    float cellW = uCell * exp2(lo);
    float sparkle = mix(
      sparkleLayer(wxz, cellW, thr, uTime * uTwinkle),
      sparkleLayer(wxz, cellW * 2.0, thr, uTime * uTwinkle),
      f - lo
    );

    gl_FragColor.rgb += sparkle * uSparkleStrength * vec3(1.0, 0.98, 0.94);
  }
`

export interface Ocean {
  mesh: Mesh
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

export function createOcean(): Ocean {
  const geometry = new PlaneGeometry(OCEAN_SIZE, OCEAN_SIZE, OCEAN_SEGMENTS, OCEAN_SEGMENTS)
  geometry.rotateX(-Math.PI / 2)

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
    uSigma: { value: SPARKLE_SIGMA },
    uDensity: { value: SPARKLE_DENSITY },
    uCell: { value: SPARKLE_CELL },
    uCellRef: { value: SPARKLE_CELL_REF },
    uTwinkle: { value: SPARKLE_TWINKLE },
    uSparkleStrength: { value: SPARKLE_STRENGTH },
    uDotRadius: { value: SPARKLE_DOT_RADIUS },
    uSoftness: { value: SPARKLE_SOFTNESS },
    uFadeStart: { value: SPARKLE_FADE_START },
    uFadeEnd: { value: SPARKLE_FADE_END },
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
             ? `vec2 worldXZ = transformed.xz + uOrigin;
                float waveH = 0.0;
                for (int i = 0; i < ${WAVES.length}; i++) {
                  float k = 6.28318530718 / uWaveLen[i];
                  waveH += uWaveAmp[i] * sin(k * dot(uWaveDir[i], worldXZ) - uWaveSpd[i] * k * uTime);
                }
                transformed.y += waveH;`
             : ''}
           vOceanWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
        )

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${SPARKLE_COMMON}`)
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

  const mesh = new Mesh(geometry, material)
  mesh.frustumCulled = false // 隨玩家捲動，永遠可見

  // 遠海。用 MeshPhysicalMaterial 而不是 Basic：要跟細浪面接得上就得受同一
  // 組燈光。roughness / metalness 全部沿用細浪面的值。
  const farGeometry = new PlaneGeometry(FAR_SEA_SIZE, FAR_SEA_SIZE, 1, 1)
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
   * 【`renderOrder` 非設不可】遠海與細浪面只相距 3 m，而深度量化
   * `Δz ≈ z²·(f−n)/(n·f·2²⁴) ≈ z²/2²⁴`（近平面 1 m）在 7,000 m 是 2.92 m、
   * 12,000 m 是 8.58 m —— 上帝視角 7,000 m 以上，整片細浪面（永遠是 ±5 km）
   * 的深度都與遠海**分不出前後**。
   *
   * 平手時誰贏由繪製順序決定，而 three 的不透明排序是
   * `renderOrder → material.id → z`（`WebGLRenderLists.js` 的
   * `painterSortStable`）—— **`material.id` 排在 `z` 前面**。不設的話順序
   * 只是「誰先 new 材質」的巧合：細浪面的材質先建、id 較小、因此先畫，
   * 遠海後畫；而預設的 `depthFunc` 是 `LessEqualDepth`，於是**後畫的遠海
   * 勝出，把浪蓋掉**。
   *
   * −1 讓遠海先畫，平手時細浪面與參照物勝出（仍遠大於天空球的 −1000）。
   * 這不是把順序「排對」——那做不到，同 `assembly.ts` 那段關於曳光彈與
   * 模糊圓盤的討論 —— 而是把平手的倒向固定成正確的那一邊。成本是一次
   * 全螢幕 overdraw，兩個三角形，可忽略。
   */
  farMesh.renderOrder = -1

  return {
    mesh,
    farMesh,
    update(time, centerX, centerZ) {
      uTime.value = time
      // 以網格單元對齊捲動，避免頂點在格點間滑動造成抖動
      const cell = OCEAN_SIZE / OCEAN_SEGMENTS
      const sx = Math.round(centerX / cell) * cell
      const sz = Math.round(centerZ / cell) * cell
      mesh.position.set(sx, 0, sz)
      uOrigin.value.set(sx, sz)
      // 【遠海不做格點對齊】對齊是為了避免頂點在格點之間滑動造成波形抖動，
      // 而遠海沒有波。精確跟著中心走，才不會在極端座標下累積偏差。
      farMesh.position.set(centerX, FAR_SEA_Y, centerZ)
    },
    heightAt: gerstnerHeight,
    dispose() {
      geometry.dispose()
      material.dispose()
      farGeometry.dispose()
      farMaterial.dispose()
    },
  }
}
