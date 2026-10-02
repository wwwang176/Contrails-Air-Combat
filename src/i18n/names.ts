import { t, type MessageKey } from './index'
import type { GroundUnitId } from '../render/geometry/ground'
import type { ShipClassId } from '../world/ships'

/**
 * # 顯示用的名稱
 *
 * 機種、武器、艦級、地面單位在畫面上的名稱都由 id 查表。資料上的 `name`（機種、武器、
 * 艦級）是**內部名稱**，給開發工具與測試的標籤用，不上畫面。
 *
 * 【艦級與地面單位是完整的 `Record`】少一種是編譯錯誤。機種與武器的 id 是字串，
 * 完整性由 `test/unit/i18n-names.test.ts` 對著 `ALL_SPECS` 掃。
 */

const AIRCRAFT: Readonly<Record<string, MessageKey>> = {
  p51d: 'name.aircraft.p51d',
  bf109k4: 'name.aircraft.bf109k4',
  f6f5: 'name.aircraft.f6f5',
  f4f4: 'name.aircraft.f4f4',
  ki84: 'name.aircraft.ki84',
  a6m5: 'name.aircraft.a6m5',
  b17g: 'name.aircraft.b17g',
  he111: 'name.aircraft.he111',
  ju87: 'name.aircraft.ju87',
  g4m: 'name.aircraft.g4m',
}

const WEAPON: Readonly<Record<string, MessageKey>> = {
  'm2-50cal': 'name.weapon.m2-50cal',
  mk108: 'name.weapon.mk108',
  mg131: 'name.weapon.mg131',
  mg15: 'name.weapon.mg15',
  mg17: 'name.weapon.mg17',
  type97: 'name.weapon.type97',
  'type99-2': 'name.weapon.type99-2',
  type92: 'name.weapon.type92',
  'type99-1': 'name.weapon.type99-1',
  ho103: 'name.weapon.ho103',
  ho5: 'name.weapon.ho5',
}

const SHIP: Readonly<Record<ShipClassId, MessageKey>> = {
  essex: 'name.ship.essex',
  fletcher: 'name.ship.fletcher',
  wichita: 'name.ship.wichita',
  lst: 'name.ship.lst',
}

const GROUND: Readonly<Record<GroundUnitId, MessageKey>> = {
  tank: 'name.ground.tank',
  tankDug: 'name.ground.tankDug',
  truck: 'name.ground.truck',
  atGun: 'name.ground.atGun',
  panzer4: 'name.ground.panzer4',
  tiger: 'name.ground.tiger',
  infantry: 'name.ground.infantry',
  mortar: 'name.ground.mortar',
  flakHeavy: 'name.ground.flakHeavy',
  flakLight: 'name.ground.flakLight',
  usTank: 'name.ground.usTank',
  usTruck: 'name.ground.usTruck',
  usFlakTrack: 'name.ground.usFlakTrack',
  locomotive: 'name.ground.locomotive',
  tender: 'name.ground.tender',
  boxcar: 'name.ground.boxcar',
  flatcar: 'name.ground.flatcar',
  hydroTower: 'name.ground.hydroTower',
  chimney: 'name.ground.chimney',
  boilerHouse: 'name.ground.boilerHouse',
  oilTank: 'name.ground.oilTank',
  gasHolder: 'name.ground.gasHolder',
  coolingTower: 'name.ground.coolingTower',
  parkedB17: 'name.ground.parkedB17',
  fuelDump: 'name.ground.fuelDump',
  bombDump: 'name.ground.bombDump',
  searchlight: 'name.ground.searchlight',
  parkedP51: 'name.ground.parkedP51',
}

/** 機種全名的鍵。表上沒有的機種回 `undefined` */
export function aircraftNameKey(id: string): MessageKey | undefined {
  return AIRCRAFT[id]
}

/** 機種全名（「P-51D Mustang」「A6M5 零戰」）。表上沒有時退回內部名稱 */
export function aircraftName(spec: { readonly id: string; readonly name: string }): string {
  const key = AIRCRAFT[spec.id]
  return key === undefined ? spec.name : t(key)
}

/** 武器名稱的鍵。表上沒有的武器回 `undefined` */
export function weaponNameKey(id: string): MessageKey | undefined {
  return WEAPON[id]
}

/** 武器名稱。表上沒有時退回內部名稱 */
export function weaponName(w: { readonly id: string; readonly name: string }): string {
  const key = WEAPON[w.id]
  return key === undefined ? w.name : t(key)
}

export function shipNameKey(id: ShipClassId): MessageKey {
  return SHIP[id]
}

export function groundUnitNameKey(id: GroundUnitId): MessageKey {
  return GROUND[id]
}

export function groundUnitName(id: GroundUnitId): string {
  return t(GROUND[id])
}
