/**
 * 一種爆炸的配方。
 *
 * 【為什麼每一種粒子都有自己的錐角】火球是往上竄的一團、塵土是往外掀的一圈
 * ——同一個角度做不出兩者的差別。
 */
export interface BlastParams {
  /** 火球顆數 */
  fireCount: number
  /** 火球初速，m/s */
  fireSpeed: number
  /** 火球尺寸倍率。1 = `FIREBALL_SIZE_FROM`／`TO` 那一組（一架飛機的擊墜） */
  fireSize: number
  /** 火球噴出的錐半角，rad。軸恆是世界上方 */
  fireCone: number
  smokeCount: number
  smokeSpeed: number
  smokeSize: number
  smokeCone: number
  /** 揚塵。落水恆為 0 */
  dustCount: number
  dustSpeed: number
  dustSize: number
  dustCone: number
  /** **每一根水柱**的柱腳噴幾顆水花。墜地恆為 0 */
  sprayCount: number
  spraySpeed: number
  sprayCone: number
  /** 水柱根數。墜地恆為 0 */
  jetCount: number
  /** 水冠的散佈半徑，m。柱子撒在這個圓內 */
  jetSpread: number
  /** 中央那一根的高度，m。往外照 `jetFalloff` 遞減 */
  jetHeight: number
  /** 中央那一根的底部半徑，m */
  jetRadius: number
  /** 一根水柱塌下時留幾團水霧 */
  mistPerJet: number
  /** 水霧的尺寸相對水柱的半徑 */
  mistSize: number
  /**
   * 光暈的尺寸，佔火球直徑的倍率。**0 = 不畫光暈。**
   *
   * 【它是加法混合的圓片，不是光源】不會照亮地面或旁邊的飛機，只是在畫面
   * 上那個位置加一片亮色。真的照明要走後製 bloom 或動態光源。
   */
  glowSize: number
  /** 光暈出生時的不透明度 */
  glowAlpha: number
}

/**
 * 墜地。**起始值，由試飛裁定。**
 *
 * 【塵比火多】500 lb 落在土地上，看得最久的是那一團土 —— 火球 0.5 s 就沒了。
 *
 * 【尺度的量尺是樹】針葉樹 `TREE_HEIGHT` 是 30 m。火球的團徑要與一棵樹相當
 * （真實的 500 lb 是 25–30 m）。初速就是為此 —— 團的大小由「單塊尺寸 +
 * 擴散」決定，光放大單塊只會糊成一坨。
 *
 * 【塵與煙都不得大過火球】爆炸是主角。塵團比火球寬的話，畫面上讀到的是
 * 一團土裡面有一點火。
 */
export const LAND_BLAST: BlastParams = {
  fireCount: 10,
  fireSpeed: 55,
  fireSize: 2.2,
  fireCone: (75 * Math.PI) / 180,
  smokeCount: 31,
  smokeSpeed: 21,
  smokeSize: 2.9,
  smokeCone: (75 * Math.PI) / 180,
  dustCount: 22,
  dustSpeed: 12,
  dustSize: 0.8,
  dustCone: (58 * Math.PI) / 180,
  sprayCount: 0,
  spraySpeed: 0,
  sprayCone: 0,
  jetCount: 0,
  jetSpread: 0,
  jetHeight: 0,
  jetRadius: 0,
  mistPerJet: 0,
  mistSize: 0,
  glowSize: 1.5,
  glowAlpha: 0.55,
}

/**
 * 落水。**起始值，由試飛裁定。**
 *
 * 【沒有火、沒有黑煙】水面下的爆炸看不到火 —— 整個效果就是水冠：一叢粗
 * 水柱瞬間衝起、塌下時淡出，體積交給白色的水霧。
 */
export const WATER_BLAST: BlastParams = {
  fireCount: 0,
  fireSpeed: 0,
  fireSize: 0,
  fireCone: 0,
  smokeCount: 0,
  smokeSpeed: 0,
  smokeSize: 0,
  smokeCone: 0,
  dustCount: 0,
  dustSpeed: 0,
  dustSize: 0,
  dustCone: 0,
  sprayCount: 8,
  spraySpeed: 17,
  sprayCone: (62 * Math.PI) / 180,
  jetCount: 13,
  jetSpread: 6.5,
  jetHeight: 34,
  jetRadius: 3.2,
  mistPerJet: 5,
  mistSize: 4.2,
  glowSize: 0,
  glowAlpha: 0,
}

/**
 * 魚雷命中。**水柱＋爆炸。** 起始值，由試飛裁定。
 *
 * 【比落水的水冠更窄更高】魚雷在船側水線下引爆，水沿著艦身噴上去，是一道
 * 貼著船的水牆而不是散開的水冠。柱數少一點、間距收一半、高度加三成。
 *
 * 【與 `WATER_BLAST` 的差別就是那團火】落水的那一顆是自己在水裡炸，看不到
 * 火；打中船的這一顆炸的是船 —— 燃料、彈藥與艦體本身都在燒。所以火與煙
 * 都有，但比墜地那一組小：水吞掉大半的能量，冒出水面的只是其中一部分。
 *
 * 【火比水柱矮】火球團徑約 12 m，水柱 46 m —— 讀起來要是「一道水牆，根部
 * 有一團火」，而不是「一團火，旁邊有水」。
 *
 * 【撞岸也用這一份】岸邊的爆炸仍然是水柱 —— 為它另開一張表要先有一個真的
 * 分得出來的畫面。
 */
export const TORPEDO_BLAST: BlastParams = {
  fireCount: 7,
  fireSpeed: 24,
  fireSize: 1.7,
  fireCone: (68 * Math.PI) / 180,
  smokeCount: 15,
  smokeSpeed: 13,
  smokeSize: 2.4,
  smokeCone: (70 * Math.PI) / 180,
  dustCount: 0,
  dustSpeed: 0,
  dustSize: 0,
  dustCone: 0,
  sprayCount: 10,
  spraySpeed: 19,
  sprayCone: (58 * Math.PI) / 180,
  jetCount: 9,
  jetSpread: 4.0,
  jetHeight: 46,
  jetRadius: 3.6,
  mistPerJet: 6,
  mistSize: 4.2,
  glowSize: 1.4,
  glowAlpha: 0.5,
}

/**
 * 飛機殘骸落水。**只有水冠，沒有火** —— 殘骸的火在空中就放過了，砸進水裡的是
 * 一團金屬。起始值，由試飛裁定。
 *
 * 【比炸彈落水小】一架戰鬥機三、四噸砸進水裡，水冠要讀得出來，但不能跟 500 lb
 * 的水柱一樣高 —— 高度約六成、柱數約一半。水霧由水柱塌下時自己留（`blastJets`
 * 的 `onFade`），不必另外噴。
 *
 * 【水花是逐根算的】每一根柱腳噴 `sprayCount` 顆，七根共 35 顆，疊在殘骸入水本來
 * 那一圈（`WRECK_SPRAY_COUNT`）上。
 */
export const WRECK_WATER_BLAST: BlastParams = {
  fireCount: 0,
  fireSpeed: 0,
  fireSize: 0,
  fireCone: 0,
  smokeCount: 0,
  smokeSpeed: 0,
  smokeSize: 0,
  smokeCone: 0,
  dustCount: 0,
  dustSpeed: 0,
  dustSize: 0,
  dustCone: 0,
  sprayCount: 5,
  spraySpeed: 15,
  sprayCone: (60 * Math.PI) / 180,
  jetCount: 7,
  jetSpread: 4.5,
  jetHeight: 20,
  jetRadius: 2.4,
  mistPerJet: 5,
  mistSize: 4.2,
  glowSize: 0,
  glowAlpha: 0,
}

/**
 * 空中擊墜。**沒有塵、沒有水冠** —— 那兩樣都是地面的東西。
 *
 * 【比墜地小】一架飛機的油箱不是 500 lb 的裝藥。火球團徑約 20 m，煙也少
 * 一半 —— 墜地那一組的規模留給炸彈。
 */
export const AIR_BLAST: BlastParams = {
  fireCount: 8,
  fireSpeed: 34,
  fireSize: 1.5,
  fireCone: (75 * Math.PI) / 180,
  smokeCount: 18,
  smokeSpeed: 16,
  smokeSize: 2.1,
  smokeCone: (75 * Math.PI) / 180,
  dustCount: 0,
  dustSpeed: 0,
  dustSize: 0,
  dustCone: 0,
  sprayCount: 0,
  spraySpeed: 0,
  sprayCone: 0,
  jetCount: 0,
  jetSpread: 0,
  jetHeight: 0,
  jetRadius: 0,
  mistPerJet: 0,
  mistSize: 0,
  glowSize: 1.5,
  glowAlpha: 0.55,
}

/**
 * 船上火災的**迷你爆炸**，每 0.3 秒一朵（`render/shipFires.ts`）。
 *
 * 【為什麼是 `AIR_BLAST` 的縮小版】燒的東西一樣 —— 甲板上的燃料與彈藥，
 * 所以不揚土也不掀水冠。差別只在規模：這是持續燃燒中的一次小爆燃，
 * 不是一枚 500 kg 落下。
 *
 * 【這裡完全不出煙】煙全部交給 `createShipFireSmoke` 那個池。爆炸的煙是
 * **錐狀噴出去**的（`smokeCone`），噴完就被 2.5 秒的壽命收掉；混在一起的話
 * 它會在數量上壓過真正往上長的那一份，整叢煙就不往上走了。
 *
 * **起始值，待試飛。**
 */
export const FIRE_BLAST: BlastParams = {
  fireCount: 4,
  fireSpeed: 11,
  fireSize: 1.1,
  fireCone: (60 * Math.PI) / 180,
  smokeCount: 0,
  smokeSpeed: 0,
  smokeSize: 0,
  smokeCone: 0,
  dustCount: 0,
  dustSpeed: 0,
  dustSize: 0,
  dustCone: 0,
  sprayCount: 0,
  spraySpeed: 0,
  sprayCone: 0,
  jetCount: 0,
  jetSpread: 0,
  jetHeight: 0,
  jetRadius: 0,
  mistPerJet: 0,
  mistSize: 0,
  glowSize: 0.7,
  glowAlpha: 0.5,
}

/**
 * 高砲砲彈在空中引爆的**小爆炸**：一瞬間的閃光加幾顆小火球，半秒內收掉；
 * 黑雲由 `render/flakBursts.ts` 那個池另外出，掛在原地四秒。
 *
 * 【為什麼不出煙】與 `FIRE_BLAST` 同一個理由 —— 錐狀噴出去的煙會壓過
 * 真正要留在那裡的黑雲。
 *
 * 【尺度】火球 `fireSize` 1.0 是 3 → 8 m 的球塊，與船火的迷你爆燃同一級；
 * 光暈放大到火球直徑的 1.4 倍 —— 遠處看得到的是那一下閃光，不是球。
 */
export const FLAK_BLAST: BlastParams = {
  fireCount: 3,
  fireSpeed: 18,
  fireSize: 1.0,
  fireCone: Math.PI,
  smokeCount: 0,
  smokeSpeed: 0,
  smokeSize: 0,
  smokeCone: 0,
  dustCount: 0,
  dustSpeed: 0,
  dustSize: 0,
  dustCone: 0,
  sprayCount: 0,
  spraySpeed: 0,
  sprayCone: 0,
  jetCount: 0,
  jetSpread: 0,
  jetHeight: 0,
  jetRadius: 0,
  mistPerJet: 0,
  mistSize: 0,
  glowSize: 1.4,
  glowAlpha: 0.7,
}
