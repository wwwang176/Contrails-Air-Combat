import { WAVES } from '../core/oceanWaves'
import { OCEAN_RING_SEGMENTS } from './oceanGeometry'

/** 最長那道波的波長，m。著色器的早退用 —— 見 `oceanWaveHeight`。 */
const LONGEST_WAVE = WAVES.reduce((a, w) => (w.wavelength > a ? w.wavelength : a), 0)

/**
 * 頂點與片段共用的宣告。兩個材質都要。
 *
 * 【為什麼波高是一支函數而不是兩段抄寫】頂點著色器要它算位移、片段著色器要它
 * 算面重心的高度（白點的浪峰偏置吃那一個）。兩份會漂開，而漂開的症狀是
 * 「白點跑到浪谷去」—— 沒有任何測試守得住。
 */
/**
 * 浪高：頂點位移用的那一支 `oceanWaveHeight` 與它要的 uniform 與函數。**海面與貼著
 * 海面的東西（船的航跡）共用這一段** —— 兩份會漂開，漂開的症狀是航跡被浪蓋掉或浮起來。
 * uniform 的物件由 `Ocean.heightUniforms` 給，同一組、同一個 uTime。
 */
export const OCEAN_HEIGHT_GLSL = /* glsl */ `
  uniform float uTime;
  uniform vec2 uOrigin;
  uniform vec2 uWaveDir[${WAVES.length}];
  uniform float uWaveAmp[${WAVES.length}];
  uniform float uWaveLen[${WAVES.length}];
  uniform float uWaveSpd[${WAVES.length}];
  uniform vec3 uWarp;   // x: 振幅 m, y: 波數 A, z: 波數 B
  uniform float uWarpSpd;
  uniform vec3 uWarp2;  // x: 振幅 m, y: 波數 A, z: 波數 B
  uniform vec3 uEnv;    // x: 展幅, y: 波數 A, z: 波數 B
  uniform float uEnvLo;
  uniform float uBaseCell;
  uniform float uInvHalfSeg;
  uniform float uVertFadeLo;
  uniform float uVertFadeHi;

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
`

export const SPARKLE_COMMON = /* glsl */ `
${OCEAN_HEIGHT_GLSL}
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
  uniform sampler2D uShoreMap;
  uniform float uShoreExtent;   // size × cell，見 FACE_FRAGMENT 的 uv 推導
  uniform float uShoreCell;
  uniform float uShoreDensity;
  uniform float uPMax;
  uniform vec3 uSkyHorizon;
  uniform vec3 uSkyZenith;
  uniform float uSkyPower;
  uniform float uReflectF0;
  uniform float uReflectStrength;
  uniform float uHalfSeg;
  uniform float uMaxLevel;
  uniform float uMorphStart;
  uniform float uSnap;
  uniform vec2 uCenter;   // 相機的水平位置，不吸附
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
   * 格距 cell 那一層在世界座標 world 處要往外一層過渡多少：0 = 自己，1 = 完全
   * 是外一層。見 OCEAN_MORPH_START。
   *
   * 【量的是離相機的距離，不是離吸附中心】吸附中心每 OCEAN_SNAP 跳一次，以它
   * 為準的話過渡量會跟著跳。以相機為準是連續的；終點再往內留半個吸附距離，
   * 所以不論中心跳到哪裡，走到這一層的外緣時都已經拉滿。
   *
   * 【最外一層不過渡】外面是平的遠海，沒有更粗的一層
   */
  float oceanMorph(float cell, vec2 world) {
    if (cell > uBaseCell * exp2(uMaxLevel) * 0.75) return 0.0;
    float ringHalf = cell * uHalfSeg;
    vec2 d = abs(world - uCenter);
    return smoothstep(uMorphStart * ringHalf, ringHalf - 0.5 * uSnap, max(d.x, d.y));
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
export const SEA_DIM_FRAGMENT = /* glsl */ `
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
 * 所以**畫一片虛擬的面上去就夠了**。
 *
 * 【接縫是連續的，不必另外處理】`faceCell` 由**離中心的距離**推得，不是查
 * 這個片段屬於哪一層。在近海的外緣（30,720 m）它算出 480 m —— 正好是 L3 的
 * 格距。虛擬的面因此接著真實的面長下去，同一條式子。
 *
 * 【遠海的格距封頂在最外層，不再加倍】加倍會讓遠處的面維持固定的角張角，
 * 看起來比近處的面還大。封住之後它是固定的世界尺寸，離得越遠在畫面上越小
 * —— 遠海就是一個白點。
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
    // 30/60/120/240，而遠海沿用最外層那一個。一律除以 uBaseCell 的話，L1/L2/L3 的
    // 每一個真實三角形會被切成 4/16/64 個假色塊 —— 而那不會讓任何測試變紅。
    //
    // 【環是方的，所以用 Chebyshev 半徑】第 L 層是半寬 64c 到 128c 的方環
    // （c = uBaseCell × 2^L），所以 r / (uBaseCell × uHalfSeg) 取 log2 再
    // ceil 正好是層號。length() 是圓的，會在方環的角落選錯層。
    //
    // 【min 把遠海的格距封在最外層】不封的話格距會一路加倍，遠處的面因此
    // 維持**固定的角張角**（約 0.45°）—— 永遠是那麼大一塊，看起來比近處的面
    // 還大。封住之後它是固定的世界尺寸，離得越遠在畫面上越小，自然變成一個
    // 白點：30 km 是 0.46°、100 km 0.14°、125 km 0.11°。
    //
    // 【不會有次像素閃爍】240 m 要掉到 2 px 得到 114 km，而碎光在
    // SPARKLE_FADE_END（125 km）就淡完了 —— 所以不需要像素地板。
    vec2 faceLocal = vOceanWorld.xz - uOrigin;
    float faceR = max(abs(faceLocal.x), abs(faceLocal.y));
    float faceLevel0 = min(uMaxLevel, ceil(log2(max(1.0, faceR / (uBaseCell * uHalfSeg)))));
    // 【過渡帶】與幾何過渡同一個量（oceanMorph）：幾何拉向外一層多少，面的
    // 底色與白點就換成外一層多少。0 = 只用這一層的面，1 = 全用外一層的面
    float faceBand = oceanMorph(uBaseCell * exp2(faceLevel0), vOceanWorld.xz);

    // ── 碎光的方向項 ──────────────────────────────────────────
    //
    // 【雙核】窄核保住方向選擇性，寬核鋪出稀疏的尾巴，讓鏡面圈之外也有
    // 零星白點。用 mix 不用加法 —— 兩個高斯在鏡面點都是 exp(0) = 1，
    // 中心因此嚴格不變。見 SPARKLE_TAIL_WEIGHT。
    //
    // 【σ 是常數】面法線就是真實的幾何法線，沒有「解析不出來的坡度」要
    // 折進 σ —— 那是逐像素解析波形時才需要的補償。
    //
    // 它只看這個像素的面法線，所以兩套面共用
    float align = 0.0;
    if (fade > 0.0) {
      float cosNH = clamp(dot(oceanNormal, oceanH), 0.0, 1.0);
      float narrow = exp(-(1.0 - cosNH) / (uSigmaBase * uSigmaBase));
      float tail = exp(-(1.0 - cosNH) / (uSigmaTail * uSigmaTail));
      align = mix(narrow, tail, uTailWeight);
    }

    // 第 0 套是這一層的面，第 1 套是外一層的面（只在過渡帶裡算）
    float tintA = 1.0;
    float tintB = 1.0;
    float litA = 0.0;
    float litB = 0.0;
    float pickB = 0.0;
    for (int facePass = 0; facePass < 2; facePass++) {
      if (facePass == 1 && faceBand <= 0.0) break;
      float faceLevel = faceLevel0 + float(facePass);
      float faceCell = uBaseCell * exp2(faceLevel);

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

      // ── 這個面離岸多近 ────────────────────────────────────────
      //
      // 【在面的重心取樣，不是在片段】與 faceH 完全同一個理由：vOceanWorld.xz
      // 在面內是內插的，逐片段取樣會把一個三角形切成半白半不白。
      //
      // 【uv 的偏移恰好是 0.5，不必另外傳】高度場的 col = x / cell +
      // (size − 1) / 2，而 GL 第 col 個 texel 的中心在 (col + 0.5) / size ——
      // 代進去化簡成 x / (size × cell) + 0.5。用 (size − 1) × cell 當尺會整張
      // 差半個 texel（20 m）。
      //
      // 【場外不必判斷邊界】島散布在 ±16.9 km 之內、場地半寬 20.48 km，所以
      // 邊緣的 texel 恆為 0，而 ClampToEdge 讓場外自然取到 0。
      //
      // 【一定要指定 LOD】遠海一個面 240 m 而浪花帶只有 200 m —— 逐點取樣時
      // 整條帶可能落在相鄰兩個重心之間，遠處的海岸會**完全沒有浪花**。取 mip
      // 讓這個面拿到的是「我涵蓋的範圍裡有多少比例是浪花帶」。
      float shoreLod = max(0.0, log2(faceCell / uShoreCell));
      float shore = textureLod(
        uShoreMap, faceCen / uShoreExtent + 0.5, shoreLod).r;

      // ── 逐面底色 ────────────────────────────────────────────
      //
      // 【這是低多邊形的主角，不是法線】相鄰面的法線只差約 12°（島是幾十度），
      // 海太平了 —— 光靠法線做不出稜角感。訊號由每個面自己的色調帶。
      float tint = 1.0
        + (faceId - 0.5) * 2.0 * uFaceTint
        + clamp(faceH / uCrestRef, -1.0, 1.0) * uFaceLift;

      // ── 碎光：一個面亮或不亮 ──────────────────────────────
      float faceLit = 0.0;
      if (fade > 0.0) {

        // 【浪峰偏置】鏡面條件只看坡度，沒有偏置時白點落在浪的**側面**，
        // 峰與谷機會相同。真實海面的短波被長浪調變 —— 峰上密、谷裡稀。見
        // SPARKLE_CREST_BIAS。高度均值為 0 而偏置是奇函數，所以白點總數不變。
        // max 擋住 uCrestBias > 1 時浪谷變成負機率。
        float crest = clamp(faceH / uCrestRef, -1.0, 1.0);
        float p = max(align * uDensity * fade * (1.0 + uCrestBias * crest), 0.0);

        // 【浪花是**加上去的一項**，不是把上面那一式改寫】所以 shore = 0 時
        // 純海面那條路是逐位元的恆等式。
        // 同樣吃 crest：浪在峰上碎。
        p += max(shore * uShoreDensity * fade * (1.0 + uCrestBias * crest), 0.0);
        p = min(p, uPMax);   // 見 SPARKLE_P_MAX

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
        faceLit = lit;
      }

      if (facePass == 0) {
        tintA = tint;
        litA = faceLit;
      } else {
        tintB = tint;
        litB = faceLit;
        // 【白點以外一層的大面擲骰】整塊大面一起換過去，形狀才不會被切碎。
        // faceBand 到 1 時恆為真 —— 走到外一層時與它完全相同
        pickB = oceanHash(faceCel + faceTri * 0.5 + vec2(9.7, 4.3)) < faceBand ? 1.0 : 0.0;
      }
    }

    gl_FragColor.rgb *= mix(tintA, tintB, faceBand);

    if (fade > 0.0) {
      // 【遠處的反光要暗下來】霧淡的時段霧不夠壓，碎光自己補這段大氣消光 ——
      // 見 SPARKLE_ATTEN_NEAR。只乘在加法項上，海的基色不受影響。
      float atten = mix(1.0, uFarDim, smoothstep(uAttenNear, uAttenFar, oceanDist));
      // 【霧化區把白面沖淡】遠海融進天空後不該再有清楚的碎光。
      // oceanAerial 在 SEA_DIM_FRAGMENT 算好（排在本段之前）。
      gl_FragColor.rgb += mix(litA, litB, pickB) * uSparkleStrength * atten
        * (1.0 - oceanAerial) * vec3(1.0, 0.98, 0.94);
    }
`

/**
 * 逐面量的表為每一層多留幾格。
 *
 * 【為什麼非留不可】片段推得的格號是由**內插出來的座標**取整數來的，格子
 * 邊上的像素可能落到相鄰那一格。留了邊界，那些像素照樣查得到值；沒留的話
 * 就得在著色器裡加一段「查不到就自己算」，而那個分支在 D3D 上會被攤平成
 * 兩邊都算，省下的工全部還回去。
 */
const TABLE_MARGIN = 2

/** 一層在表上佔的邊長，格 */
const TABLE_TILE = OCEAN_RING_SEGMENTS + 2 * TABLE_MARGIN

/** 格號換算成表上的位置時要加的偏移（中心那一格在正中間） */
const TABLE_BIAS = OCEAN_RING_SEGMENTS / 2 + TABLE_MARGIN

/** 四層排成 2 × 2；左右兩半分別是格子裡的兩個三角形 */
export const FACE_TABLE_WIDTH = TABLE_TILE * 4

export const FACE_TABLE_HEIGHT = TABLE_TILE * 2

/**
 * 每幀把每一格兩個三角形的逐面量畫進一張浮點貼圖：重心波高、閃爍骰值、
 * 閃爍包絡、面 id。**算式與 `FACE_FRAGMENT` 逐字相同**，只是把格號從
 * 「像素自己推」換成「由表上的位置推」。
 *
 * 【發亮的是另一批面，那是預期內的】閃爍骰子的雜湊輸入是
 * `格號 + vec2(3.1, 7.7) + 三角形`，兩次加法 —— 浮點加法不滿足結合律，
 * 兩支程式可以用不同的順序結合而差一個最低位，雜湊再把它放大成完全不同的
 * 值。**機率、密度、閃爍節奏一個字都沒改**，換的只是骰子本身；換一張顯卡
 * 也會有同樣的效果。
 *
 * 代價是海面不能再用「截圖逐像素相同」驗回歸：那條路對這一版本來就不成立。
 * 波高與面 id 的輸入只有一次加法，實測逐位元相同。
 *
 * 【為什麼這樣畫面不會變】片段那邊「我屬於哪一格」的判斷一個字都沒動，
 * 換掉的只是那一格的答案從哪裡來。存的是 32 位元浮點，所以查到的值與
 * 當場算出來的逐位元相同。
 *
 * 【岸邊浪花不在表裡】它留在片段著色器，見 `FACE_FRAGMENT` 的取樣那一段。
 */
export const FACE_TABLE_FRAGMENT = /* glsl */ `
  // 【要自己宣告輸出】three 的 ShaderMaterial 在 GLSL3 下不補 gl_FragColor，
  // 少了這一行整支編不過，而症狀是近海查到一張空貼圖
  layout(location = 0) out vec4 faceOut;

  void main() {
    int tx = int(gl_FragCoord.x);
    int ty = int(gl_FragCoord.y);
    float tri = float(tx / ${TABLE_TILE * 2});
    int lx = tx - (tx / ${TABLE_TILE * 2}) * ${TABLE_TILE * 2};
    int level = lx / ${TABLE_TILE} + (ty / ${TABLE_TILE}) * 2;
    int ix = lx - (lx / ${TABLE_TILE}) * ${TABLE_TILE};
    int iy = ty - (ty / ${TABLE_TILE}) * ${TABLE_TILE};
    float cell = uBaseCell * exp2(float(level));
    vec2 originCel = floor(uOrigin / cell + 0.5);
    vec2 cel = originCel + vec2(float(ix), float(iy)) - ${TABLE_BIAS.toFixed(1)};

    vec2 faceCen = (cel + mix(vec2(0.3333333), vec2(0.6666667), tri)) * cell;
    float faceH = oceanWaveHeight(faceCen, oceanVCell(faceCen - uOrigin));
    float faceId = oceanHash(cel + tri * 0.5);
    float twPhase = oceanHash(cel + vec2(3.1, 7.7) + tri);
    float twRate = 0.6 + 0.8 * oceanHash(cel + vec2(17.3, 5.1) + tri);
    float cycle = twPhase + uTime * uTwinkle * twRate;
    float k = floor(cycle);
    float u = fract(cycle);
    float roll = oceanHash(vec2(faceId * 512.0 + k, faceId * 731.0 - k * 1.3));
    float env = pow(max(sin(u * 3.14159265), 1e-6), uEnvelopePow);
    faceOut = vec4(faceH, roll, env, faceId);
  }
`

/** 預繪那一趟的頂點段：一個蓋滿的四邊形。`vOceanWorld` 只是為了對上宣告 */
export const FACE_TABLE_VERTEX = /* glsl */ `
  void main() {
    vOceanWorld = vec3(0.0);
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

/** 換掉 `src` 裡恰好一處 `from`；沒找到或不只一處就拋錯 —— 靜默 no-op 會讓近海悄悄走回逐片段 */
function swapOnce(src: string, from: string, to: string): string {
  const at = src.indexOf(from)
  if (at < 0 || src.indexOf(from, at + 1) >= 0) {
    throw new Error(`FACE_FRAGMENT 找不到唯一的一段：${from}`)
  }
  return src.slice(0, at) + to + src.slice(at + from.length)
}

/**
 * 近海的逐面片段段：與 `FACE_FRAGMENT` 相同，只把逐面不變的四個量改成查
 * `FACE_TABLE_FRAGMENT` 畫好的那張表。**選層、格號、重心、岸圖取樣一個字
 * 都沒動** —— 逐面量以外的一切因此不變。
 */
export const FACE_FRAGMENT_TABLE = ([
  ['      float faceId = oceanHash(faceCel + faceTri * 0.5);',
    `      // 這一格的逐面量每幀先畫進 uFaceTable，見 FACE_TABLE_FRAGMENT。
      // 過渡帶裡外一層的面查的是外一層的分頁 —— 那一頁涵蓋得到這一層
      int faceLv = int(faceLevel);
      vec2 faceOrigCel = floor(uOrigin / faceCell + 0.5);
      ivec2 faceTexel = ivec2(faceCel - faceOrigCel) + ${TABLE_BIAS}
        + ivec2(int(faceTri) * ${TABLE_TILE * 2}
            + (faceLv - (faceLv / 2) * 2) * ${TABLE_TILE},
          (faceLv / 2) * ${TABLE_TILE});
      vec4 faceRow = texelFetch(uFaceTable, faceTexel, 0);
      float faceId = faceRow.w;`],
  ['      float faceH = oceanWaveHeight(faceCen, oceanVCell(faceCen - uOrigin));',
    '      float faceH = faceRow.x;'],
  [`        float twPhase = oceanHash(faceCel + vec2(3.1, 7.7) + faceTri);
        float twRate = 0.6 + 0.8 * oceanHash(faceCel + vec2(17.3, 5.1) + faceTri);
        float cycle = twPhase + uTime * uTwinkle * twRate;
        float k = floor(cycle);
        float u = fract(cycle);
        float roll = oceanHash(vec2(faceId * 512.0 + k, faceId * 731.0 - k * 1.3));`,
  '        float roll = faceRow.y;'],
  ['        float lit = on * pow(max(sin(u * 3.14159265), 1e-6), uEnvelopePow);',
    '        float lit = on * faceRow.z;'],
] as const).reduce((src, [from, to]) => swapOnce(src, from, to), FACE_FRAGMENT)

/**
 * 疊在 `opaque_fragment` 之後（線性空間）。**兩個材質都用這一段**，而且
 * 逐面那一段兩邊也都插進去 —— 遠海的面是虛擬的，見 `FACE_FRAGMENT`。
 *
 * 【參數化留著】它讓「哪一段給誰」在呼叫點看得見，而不是藏在字串裡。
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
