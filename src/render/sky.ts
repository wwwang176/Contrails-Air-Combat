import { BackSide, Mesh, ShaderMaterial, SphereGeometry, Color, Vector3 } from 'three'
// 【只匯入型別】`timeOfDay.ts` 要用這裡的 `SKY_HORIZON` 等常數，值匯入會成環
import type { DayPalette } from './timeOfDay'

/**
 * 天空球半徑，m。
 *
 * 【與相機遠平面的關係】遠平面是 `CAMERA_FAR`（`render/scene.ts`）。天空球
 * 跟著相機走，所以它永遠在視野正中央，只要半徑落在近平面與遠平面之間即可。
 *
 * 【為什麼遠海比它還大卻沒問題】遠海半邊 3,000 km，遠大於這顆球。但天空的
 * 頂點著色器把深度推到遠平面（`gl_Position.z = gl_Position.w`）而且
 * `depthWrite: false` —— 深度是最遠的 1.0、又不寫回去，所以任何真實幾何都
 * 蓋得過它。它是背景不是物件。
 */
export const SKY_RADIUS = 40000

/**
 * 天空的繪製次序。**比場上任何不透明物都大。**
 *
 * 【為什麼是最後而不是最先】先畫的話整個螢幕被天空著色一次，再被地面與海
 * 整片蓋掉 —— 那一整份全螢幕的片段著色器是白花的。最後畫，只有真正看得到
 * 的天空像素才付錢。
 *
 * 【它仍然在不透明那一批】three 先畫 opaque 再畫 transparent，`renderOrder`
 * 只在批內排序。天空的材質不是 `transparent`，所以一個大的 renderOrder 把
 * 它排到不透明的最後、粒子與曳光彈之前 —— 那正是要的位置。
 *
 * 場上其他用到 renderOrder 的：遠海 `FAR_SEA_RENDER_ORDER`（1）、螺旋槳
 * 圓盤 `PROP_DISC_RENDER_ORDER`（10）。`main.ts` 的 `__gfx` 靠這個常數找
 * 天空，所以它匯出。
 */
export const SKY_RENDER_ORDER = 1000

/**
 * 天空球的地平色與天頂色。
 *
 * 【這兩個不是畫面上看到的顏色】`t = dirY × 0.5 + 0.5`，所以畫面上的地平線
 * （`dirY = 0`）落在漸層的**正中間**，實際是 `#89accd`（L 0.431）；
 * `SKY_ZENITH` 出現在正上方（`#4d84b8`，L 0.277）；而 `SKY_HORIZON`
 * （L 0.702）只出現在 `dirY = −1`，那裡被海擋著，畫面上永遠看不到。
 *
 * 【調亮下半球要兩個旋鈕一起動】`SKY_HORIZON` 抬高整個下半球，指數決定
 * **淡的部分往上延伸多遠**。只動前者會連 45° 一起提亮 0.03 以上；只動後者
 * 則受限於「`SKY_HORIZON` 本身不得出現在地平線上」那條測試（0.95 就只剩
 * 0.020 餘裕）。兩者各走一半時 45° 只動 0.020 而地平線動 0.064 —— 那才是
 * 「只有接近地面變淡」。
 *
 * 【天頂會拖著地平線一起走】`t(dirY = 0) = 0.5^0.8 = 0.574`，所以畫面上的
 * 地平線是**混了六成天頂色**的 —— 壓深天頂會把地平線一起拉低：
 *
 * ```
 *   天頂常數   地平線 L   天頂 L   海天差   地平−天頂
 *    0.277      0.4946   0.2768   0.454    0.218
 *    0.235      0.4707   0.2351   0.430    0.236   ← 現值
 * ```
 *
 * 【天頂還能再深多少】擋住的是 `fog.test.ts` 的「天頂 > 0.20」。L 0.21 時
 * 餘裕只剩 0.009，實質是上限；現值 0.235 留了 0.035 的餘裕。**再往下要先
 * 重新定值那條門檻，而那是負責人的決定，不是實作者的。**
 *
 * 海天的明暗關係由 `test/unit/fog.test.ts` 釘住，而它比的是**海色**與
 * **地平線上的**天空色，不是這兩個常數。同一份測試也釘住下面 `createSky`
 * 的 uniform 真的餵了這三個值 —— 否則 CPU 那一份與著色器可以各走各的。
 */
export const SKY_HORIZON = 0xd6e9f4
export const SKY_ZENITH = 0x477aab

/**
 * 漸層的指數。`< 1` 讓地平色的範圍變窄、天頂色往下壓；愈接近 1 愈線性，
 * 也就是下半球愈淡。
 *
 * 【它不是明度倍率】這是漸層曲線的**指數**，與明度無關。
 *
 * 【上界不是 1，是那條測試】`SKY_HORIZON` 這個常數必須明顯亮於畫面上的地平線
 * （`fog.test.ts` 要求差 0.2 以上），否則「拿 `SKY_HORIZON` 當地平線顏色」
 * 那個錯誤就不再有反證。指數 0.95 時餘裕只剩 0.020，0.80 有 0.094。
 */
export const SKY_GRADIENT_POWER = 0.8

/**
 * 天空在某個視線仰角上的顏色，**CPU 的那一份**。
 *
 * 【為什麼要有它】著色器裡的漸層測不到，而霧色必須比**地平線上的天空**暗
 * 才看得出地平線（見 `fog.ts` 的 `FOG_COLOR`）。
 *
 * **兩份必須一致** —— 這是上面 `FRAG` 那兩行的 JS 版。
 *
 * 【`dirY = 0` 才是地平線，不是 `SKY_HORIZON`】`t = dirY × 0.5 + 0.5`，所以
 * 地平線落在漸層的**正中間**（`t = 0.5`），已經往天頂色混了六成。
 * `SKY_HORIZON` 這個顏色只出現在 `dirY = −1`（正下方）—— 而那裡被海擋著，
 * 畫面上永遠看不到。拿它當「地平線的顏色」是錯的。
 */
export function skyColorAt(dirY: number, out: Color): Color {
  const t = Math.pow(Math.min(Math.max(dirY * 0.5 + 0.5, 0), 1), SKY_GRADIENT_POWER)
  return out.lerpColors(SKY_HORIZON_COLOR, SKY_ZENITH_COLOR, t)
}

const SKY_HORIZON_COLOR = new Color(SKY_HORIZON)
const SKY_ZENITH_COLOR = new Color(SKY_ZENITH)

const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    // 【深度推到最遠】球半徑只有 40 km 而遠海半邊 3,000 km。天空最後畫又
    // 開著深度測試的話，球面的深度（近平面 1 m 下約 0.99998）比遠海小，
    // 它會反過來把遠海蓋掉。z = w 之後深度恰好是 1.0 —— 深度緩衝的清除值
    // 也是 1.0，而預設的 LessEqual 讓平手通過，所以「什麼都沒畫的地方」
    // 仍然畫得到天空，畫過東西的地方一律輸。
    gl_Position.z = gl_Position.w;
  }
`

/**
 * 【指數為什麼是 uniform 而不是寫死的字面值】寫死的話它與
 * `SKY_GRADIENT_POWER` 是兩份各自獨立的 0.8，改一份忘了另一份畫面與霧色
 * 就分家，而 `fog.test.ts` 只釘得住 uniform —— 測不到字串裡的字面值。
 *
 * 【`#include <colorspace_fragment>` 非有不可】天空球是**自寫的
 * `ShaderMaterial`**，而 three **不會**替自寫的片段著色器呼叫
 * `linearToOutputTexel` —— 那是 built-in 材質才有的 chunk。少了它，天空把
 * 線性值原樣寫進 sRGB 緩衝區，螢幕上比常數所表達的暗一大截（地平線
 * L 0.495 → 0.241、天頂 0.277 → 0.101），而**沒有任何測試會紅**：
 * `fog.test.ts` 斷言的是常數。症狀是「天空常數怎麼調都不夠亮」。
 *
 * 霧色一併受影響：`FOG_COLOR` 由 `skyColorAt(0)` 推導，而霧作用在飛機／
 * 殘骸／煙霧上，那些走 built-in 材質、**本來就有**做轉換。少了這個
 * include，遠處的飛機會往一個比背後天空更亮的顏色化開。
 *
 * 【不要順手加 `tonemapping_fragment`】renderer 是 `NoToneMapping`，那個
 * chunk 會展開成空字串；但真要開 tone mapping 時，天空該不該吃是一個
 * **設計決定**（天空是背景不是物件）。
 */
const FRAG = /* glsl */ `
  uniform vec3 horizon;
  uniform vec3 zenith;
  uniform float power;
  uniform float stars;
  varying vec3 vDir;

  /**
   * 【一定要用這一支，不要寫 fract(p * vec2(大數)) 那種】對整數輸入
   * fract(n * 127.31) 等於 fract(n * 0.31)，沿座標軸強相關 —— 星點會排成
   * 一列一列的直行。這是 Hoskins 的 hash13，三個分量互相混過。
   */
  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  void main() {
    // 【改這兩行就要同步改 skyColorAt】那是這段的 CPU 版，霧色靠它推導
    float t = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 col = mix(horizon, zenith, pow(t, power));
    // 【星點只在 stars > 0 時算】正午與清晨走這個分支之外，輸出與加星之前
    // 逐位元相同 —— 既有的畫面基準線因此不受影響
    if (stars > 0.0) {
      vec3 dir = normalize(vDir);
      /**
       * 【網格建在方向向量上，不是方位角×仰角】球座標的格子在天頂會擠成
       * 一點，而且經度線在畫面上本來就是直的 —— 兩者都讓星點看起來有結構。
       * 半徑 150 的球殼切一個單位立方格，格子的角尺寸約 0.38°，
       * 遠大於星點本身。
       */
      vec3 cell = floor(dir * 150.0) + 0.5;
      // 約 0.55% 的格子有星，整顆天球約 2,300 顆 —— 肉眼可見的量級
      if (hash13(cell) > 0.9945) {
        vec3 jit = vec3(hash13(cell + 11.3), hash13(cell + 27.7), hash13(cell + 41.1));
        vec3 star = normalize(cell + (jit - 0.5) * 0.9);
        float ang = acos(clamp(dot(dir, star), -1.0, 1.0));
        /**
         * 【核心要小又要不閃爍】0.0021 rad 是 0.12°，1080p 下約兩個像素。
         * 平方一次把邊緣收緊 —— 只留外圈當抗鋸齒，不然點會在鏡頭轉動時
         * 一閃一閃地跳。
         */
        float core = smoothstep(0.0021, 0.0, ang);
        core *= core;
        // 【亮度偏暗】三次方讓絕大多數是暗星、少數幾顆明顯亮，才像星空
        float h = hash13(cell + 5.9);
        float mag = 0.18 + 0.82 * h * h * h;
        // 地平線附近淡出：那裡大氣消光最強，也避開海天接縫
        float alt = smoothstep(0.0, 0.28, dir.y);
        col += vec3(0.86, 0.90, 1.0) * (core * mag * alt * stars);
      }
    }
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`

/**
 * 漸層天空球。深度推到遠平面、不寫深度、最後畫。
 *
 * 【天空球必須跟著相機走】它半徑 40 km 而相機遠平面是 60 km。固定在原點的
 * 話，飛出 40 km 就會**從殼外面看它**，而場景沒有設定 clear color ——
 * 球以外的方向全部是黑的。更早出現的症狀是「破洞」：接近殼壁時近平面
 * （1 m）會切過球面，被切掉的那幾塊沒有任何東西畫上去。
 *
 * 海面本來就會跟著相機重新置中（見 ocean.ts 的 `update`），天空是漏的
 * 那一個。
 *
 * 【為什麼用 onBeforeRender 而不是叫 main.ts 每幀設一次】天空跟著相機是
 * 它自己的不變量，不是呼叫端要記得做的事。寫在這裡，任何人把它加進場景
 * 都自動成立。
 */
export function createSky(): Mesh {
  const material = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      horizon: { value: new Color(SKY_HORIZON) },
      zenith: { value: new Color(SKY_ZENITH) },
      power: { value: SKY_GRADIENT_POWER },
      stars: { value: 0 },
    },
    side: BackSide,
    depthWrite: false,
  })
  const mesh = new Mesh(new SphereGeometry(1, 24, 16), material)
  mesh.frustumCulled = false
  mesh.renderOrder = SKY_RENDER_ORDER
  mesh.scale.setScalar(SKY_RADIUS)
  mesh.matrixAutoUpdate = false
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    followCamera(mesh, camera.position)
  }
  // 建立時就擺好，讓「還沒 render 過」的狀態也是一致的
  followCamera(mesh, ORIGIN)
  return mesh
}

const ORIGIN = new Vector3()

/**
 * 把天空球移到 `eye`，並自行更新世界矩陣。
 *
 * `matrixAutoUpdate` 關掉是因為 three 在 `onBeforeRender` **之前**就走完了
 * 場景圖的矩陣更新 —— 只設 `position` 的話這一幀還是用舊矩陣畫，天空會
 * 落後一幀。落後一幀在 200 m/s 下是 3.3 m，遠小於 40 km 的半徑因此看不
 * 出來；但它是一個會在別處咬人的壞習慣，直接更新掉。
 */
function followCamera(mesh: Mesh, eye: Vector3): void {
  mesh.position.copy(eye)
  mesh.updateMatrix()
  mesh.updateMatrixWorld(true)
}

/**
 * 換掉天空球的漸層與星點。
 *
 * 【呼叫端不要自己去摸 uniform 的名字】那三個名字同時被 `fog.test.ts` 綁著；
 * 集中在這裡，改名只會壞一個地方。
 */
export function applySkyPalette(sky: Mesh, p: DayPalette): void {
  const u = (sky.material as ShaderMaterial).uniforms
  ;(u.horizon!.value as Color).setHex(p.skyHorizon)
  ;(u.zenith!.value as Color).setHex(p.skyZenith)
  u.power!.value = p.skyPower
  u.stars!.value = p.stars
}
