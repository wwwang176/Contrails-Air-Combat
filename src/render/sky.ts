import { BackSide, Mesh, ShaderMaterial, SphereGeometry, Color, Vector3 } from 'three'

/**
 * 天空球半徑，m。
 *
 * 【與相機遠平面的關係】遠平面是 `CAMERA_FAR`（`render/scene.ts`）。天空球
 * 跟著相機走，所以它永遠在視野正中央，只要半徑落在近平面與遠平面之間即可。
 *
 * 【為什麼遠海比它還大卻沒問題】遠海半邊 3,000 km，遠大於這顆球。但天空球
 * `depthWrite: false` 而且 `renderOrder = −1000` —— 先畫、不寫深度，所以
 * 任何東西都蓋得過它。它是背景不是物件。
 */
export const SKY_RADIUS = 40000

/**
 * 天空球的地平色與天頂色。
 *
 * 【這兩個不是畫面上看到的顏色】`t = dirY × 0.5 + 0.5`，所以畫面上的地平線
 * （`dirY = 0`）落在漸層的**正中間**，實際是 `#89accd`（L 0.431）；
 * `SKY_ZENITH` 出現在正上方（`#4d84b8`，L 0.277）；而 `SKY_HORIZON`
 * （L 0.702）只出現在 `dirY = −1`，那裡被海擋著，畫面上永遠看不到。
 *
 * 【2026-08-09 提亮】專案負責人試飛後要求「天空整體顏色淡一點」。地平線上的
 * 天空由 L 0.261 提到 0.431，天頂由 0.115 提到 0.277 —— 天頂到地平線的落差
 * 由 0.146 變成 0.154，「頂部比較深」這個關係維持。
 *
 * 【2026-08-10 只提亮下半】專案負責人：「天空的頂部顏色不動，接近地面再淡
 * 一點。」`SKY_ZENITH` 因此**一位元都沒動** —— `dirY = 1` 時 `t = 1`，混色
 * 直接取天頂色，與 `SKY_HORIZON` 和指數都無關，所以頂部不動是**恆等**而不
 * 是調出來的。
 *
 * 兩個旋鈕一起動，因為它們管的是同一個形狀的兩件事：
 *
 * ```
 *              地平線 L   45° L   天頂 L   地平線−天頂
 * 改前 c6dfec/0.65   0.431   0.318   0.277      0.154
 * 改後 d6e9f4/0.80   0.495   0.338   0.277      0.218
 * ```
 *
 * 【2026-08-11 把天頂壓深】專案負責人：「天空的頂部我覺得要再深一點。」
 * `SKY_ZENITH` 由 `0x4d84b8`（L 0.277）降到 `0x477aab`（L 0.235），色相與
 * 飽和一位元都沒動，只降明度 15%。
 *
 * 【注意天頂會拖著地平線一起走】`t(dirY = 0) = 0.5^0.8 = 0.574`，所以畫面上的
 * 地平線是**混了六成天頂色**的 —— 壓深天頂會把地平線一起拉低：
 *
 * ```
 *              地平線 L   天頂 L   海天差   地平−天頂
 * 壓深前  0.277   0.4946   0.2768   0.454    0.218
 * 壓深後  0.235   0.4707   0.2351   0.430    0.236
 * ```
 *
 * 四條門檻全部仍然綠，而且「地平−天頂」這一條反而更寬（0.218 → 0.236）。
 *
 * 【還能再深多少】擋住的是 `fog.test.ts` 的「天頂 > 0.20」。L 0.21 時餘裕只剩
 * 0.009，實質是上限。也就是說從原值最多再壓 24% 左右 —— **再往下要先重新
 * 裁定那條門檻，而那是專案負責人的決定，不是實作者的**。
 *
 * 這一次的 0.235 留了 0.035 的餘裕。
 *
 * `SKY_HORIZON` 抬高整個下半球，指數決定**淡的部分往上延伸多遠**。只動前者
 * 會連 45° 一起提亮 0.03 以上；只動後者則受限於
 * 「`SKY_HORIZON` 本身不得出現在地平線上」那條測試（0.95 就只剩 0.020 餘裕）。
 * 兩者各走一半，45° 只動 0.020，而地平線動了 0.064 —— 那正是「接近地面」。
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
 * 【它不是明度倍率】曾經有一個 `FOG_SKY_DARKEN` 也是 0.65，兩者常被搞混。
 * 那個已於 2026-08-09 移除（霧色不再壓暗，見 `fog.ts`），這裡是漸層曲線的
 * **指數**，與明度無關。
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
  }
`

/**
 * 【指數為什麼是 uniform 而不是寫死的字面值】它原本是 `pow(t, 0.65)`，與
 * `SKY_GRADIENT_POWER` 是兩份各自獨立的 0.65。改一份忘了另一份，畫面與霧色
 * 就會分家，而 `fog.test.ts` 只釘得住兩個顏色 uniform —— 測不到字串裡的字面
 * 值。改成 uniform 之後那個縫就不存在了，而且測得到。
 *
 * 【`#include <colorspace_fragment>` 非有不可 —— 2026-08-10 量到、2026-08-11 修】
 * 天空球是**自寫的 `ShaderMaterial`**，而 three **不會**替自寫的片段著色器呼叫
 * `linearToOutputTexel` —— 那是 built-in 材質才有的 chunk。少了它，天空把線性
 * 值原樣寫進 sRGB 緩衝區，螢幕上比常數所表達的暗一大截：
 *
 *   常數要求（`fog.test.ts` 斷言的）  地平線 L 0.495   天頂 L 0.277
 *   螢幕上實際                        地平線 L 0.241   天頂 L 0.101
 *
 * **所以 2026-08-09 的「天空整體淡一點」與 08-10 的「接近地面再淡一點」兩次
 * 調整都沒有真正生效** —— 畫面確實有變，但遠遠不到常數所表達的程度。專案
 * 負責人抱怨兩次的那件事，成因有一部分就在這裡。
 *
 * 順帶修好的：霧色 `FOG_COLOR` 由 `skyColorAt(0)` 推導，而霧作用在飛機／殘骸／
 * 煙霧上，那些走 built-in 材質、**本來就有**做轉換。所以在這條 bug 之下，遠處
 * 的飛機一直是往一個比背後天空更亮的顏色化開的 —— `fog.ts` 註解裡寫的「霧色
 * 就該是地平線上的天空色」從來沒有真正成立過。
 *
 * 【常數一個都不動】專案負責人 2026-08-10 裁定走「甲」：補轉換、常數不動，
 * 天空跳到常數本來就要求的亮度。另一條路（換算常數以保持現在的畫面）會讓
 * `fog.test.ts` 的兩條門檻紅掉（地平線 0.314 < 0.35、天頂 0.101 < 0.20），
 * 而那兩條正是 2026-08-09 因為「天空太暗」才加上的。
 *
 * 【不要順手加 `tonemapping_fragment`】renderer 目前是 `NoToneMapping`，那個
 * chunk 會展開成空字串；但真要開 tone mapping 時，天空該不該吃是一個**設計
 * 決定**（天空是背景不是物件），不在這次的範圍。
 */
const FRAG = /* glsl */ `
  uniform vec3 horizon;
  uniform vec3 zenith;
  uniform float power;
  varying vec3 vDir;
  void main() {
    // 【改這兩行就要同步改 skyColorAt】那是這段的 CPU 版，霧色靠它推導
    float t = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
    gl_FragColor = vec4(mix(horizon, zenith, pow(t, power)), 1.0);
    #include <colorspace_fragment>
  }
`

/**
 * 漸層天空球。關閉深度寫入並設定 renderOrder，永遠在最遠處。
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
    },
    side: BackSide,
    depthWrite: false,
  })
  const mesh = new Mesh(new SphereGeometry(1, 24, 16), material)
  mesh.frustumCulled = false
  mesh.renderOrder = -1000
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
