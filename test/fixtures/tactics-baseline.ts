/**
 * 戰術層（spec 2026-08-22）**落地前一刻**的 30 秒重播校驗和。
 *
 * 【它與 `spawn-baseline.ts` 的差別】那一份釘的是編組表重構那一輪的值，
 * 而 §4 的 `extendPitchAngle` 方向修正對所有 AI 生效、不受 `quota` 控制，
 * 必然改變它。那一份要不要重定值是專案負責人的決定（計畫 Task 14）。
 *
 * 這一份問的是另一件事：**戰術層關掉時，有沒有關乾淨。** 基準取
 * `5a0297f`（方向修正之後、`tactics.ts` 之前）實測的值，用同一支
 * `replayDigest`、同一組 `SCENES` 與 `SEED`。
 *
 * 【為什麼不能拿 `quota = 0` 跟 `quota = 0` 自己比】那只是同設定雙跑，
 * 與 `replay-determinism.test.ts` 重複，證明不了「等於它上線之前」。
 */
export const HEADON_20V20_BEFORE_TACTICS
  = '51409:afe9b76278237374d776bba798284abf710347d541be94395ddce38b0c63d4e5'
export const PURSUIT_MIRROR_8V8_BEFORE_TACTICS
  = '49033:0401e2218ca531d32497ff3fe051393c5066ecffefda4240dc0ed619686218cc'
