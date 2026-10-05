/** 相容入口；遊戲本身直接引用各職責的實作模組，既有工具與測試仍可沿用此處。 */
export { createBattle } from './createBattle'
export { DEFAULT_BATTLE } from './battleDefaults'
export { stepBattle, resetBattle, playerFlight, playerWingman } from './battleRuntime'
export type { BattleConfig } from './battleConfig'
export type { Battle } from './battleState'
export type { ConvoyIndex, TransitRoute } from './convoy'
export type { Outcome } from './mission'
