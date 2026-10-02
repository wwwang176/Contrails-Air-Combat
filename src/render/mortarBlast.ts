import { LAND_BLAST, scaleBlast, type BlastParams } from './blast'

/**
 * # 迫擊砲彈落地的爆炸
 *
 * 炸彈那一份火球與粒子（`LAND_BLAST`）縮小。**純畫面**：不震鏡頭、不打燈、不點地面火 ——
 * 一小團火與塵土。**全部是起始值，由試飛裁定。**
 *
 * 【為什麼初速要另外縮】`scaleBlast` 刻意不縮初速（爆炸相似律：質點速度與當量無關），而粒子的
 * 壽命是建池時固定的。對真的炸彈沒問題，對小爆炸就會壞：只縮尺寸的話火塊照樣衝出幾乎一樣遠
 * （0.4 倍的火球半徑仍有基準彈的八成），一團小火散成一圈。所以火球的初速另外縮、錐角收窄偏向上，
 * 煙與塵的初速跟著尺度縮。
 */

/** 尺度，基準彈 = 1 */
export const MORTAR_BLAST_SCALE = 0.4

/** 火球初速相對基準彈的倍率：火留在中央 */
export const MORTAR_FIRE_SPEED_RATIO = 0.25

/** 火球噴出的錐半角，rad：比基準彈（75°）窄，偏向上 */
export const MORTAR_FIRE_CONE = (45 * Math.PI) / 180

function build(): BlastParams {
  const out: { -readonly [K in keyof BlastParams]: number } = { ...LAND_BLAST }
  scaleBlast(LAND_BLAST, MORTAR_BLAST_SCALE ** 3, out)
  out.fireSpeed = LAND_BLAST.fireSpeed * MORTAR_FIRE_SPEED_RATIO
  out.fireCone = MORTAR_FIRE_CONE
  out.smokeSpeed = LAND_BLAST.smokeSpeed * MORTAR_BLAST_SCALE
  out.dustSpeed = LAND_BLAST.dustSpeed * MORTAR_BLAST_SCALE
  return out
}

export const MORTAR_BLAST: BlastParams = build()
