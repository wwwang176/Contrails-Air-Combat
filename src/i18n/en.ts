import type { MessageKey } from './zh'

/**
 * 英文文字表。型別是 `Record<MessageKey, string>` —— 中文表加了鍵而這裡漏了，編譯不過。
 * 句型的參數名必須與中文那一句相同（`test/unit/i18n-guard.test.ts` 守著）。
 */
export const en: Record<MessageKey, string> = {
  'common.ok': 'OK',

  'format.month': '{month} {year}',

  'menu.stage': 'Mission {n}',

  'mission.type.annihilate': 'Air Superiority',
  'mission.type.intercept': 'Intercept',
  'mission.type.strike': 'Strike',
  'mission.type.escort': 'Escort',
  'mission.type.withdraw': 'Withdrawal',

  'mission.killAll.objective': 'Shoot down every enemy',

  'result.skirmish': 'Skirmish',

  'brief.place': 'Area',
  'brief.period': 'Date',

  'mission.allies-m1.title': 'Over Berlin',
  'mission.allies-m1.summary': 'Fly the P-51D and escort the B-17s on the first daylight raid on Berlin.',
  'mission.allies-m1.place': 'Over Berlin, Germany',
  'mission.allies-m1.objective': 'Get the B-17s to Berlin',
  'mission.allies-m1.banner': 'Bandits! Cover the bombers',
  'mission.allies-m1.recycle': 'More interceptors climbing',
  'mission.allies-m1.wave.more': 'Warning: more bandits inbound',
  'mission.allies-m1.wave.join': 'Warning: more fighters joining',

  'mission.allies-m2.title': 'The Leuna Refinery',
  'mission.allies-m2.summary': 'Fly the B-17G through fighters and flak and destroy the Leuna refinery.',
  'mission.allies-m2.place': 'Over the Leuna refinery, central Germany',
  'mission.allies-m2.objective': 'Destroy the Leuna refinery',
  'mission.allies-m2.banner': 'Hold on and hit the refinery',
  'mission.allies-m2.wave.rear': 'Warning: bandits closing from behind',

  'mission.allies-m3.title': 'Off Okinawa',
  'mission.allies-m3.summary': 'Fly the F6F-5 over the carriers and stop the diving Zekes and the wave-skimming torpedo bombers.',
  'mission.allies-m3.place': 'Off Okinawa, west of the Kerama Islands',
  'mission.allies-m3.objective': 'Protect the carriers',
  'mission.allies-m3.banner': 'Zekes! Guard the carriers',
  'mission.allies-m3.recycle': 'Radar: more Zekes inbound',
  'mission.allies-m3.wave.torpedo': 'Torpedo bombers down low',

  'mission.germany-m1.title': 'Over Merseburg',
  'mission.germany-m1.summary': 'Fly the Bf 109 K-4 into the B-17 stream, shake off the escorting Mustangs and bring the bombers down.',
  'mission.germany-m1.place': 'Merseburg–Leuna, central Germany',
  'mission.germany-m1.objective': 'Shoot down the B-17s',
  'mission.germany-m1.banner': 'Bombers inbound! Stop them',
  'mission.germany-m1.wave.escort': 'Bombers ahead, P-51 escort',
  'mission.germany-m1.wave.more': 'Warning: escort fighters closing',

  'mission.germany-m2.title': 'Night over Poltava',
  'mission.germany-m2.summary': 'Fly the He 111 to Poltava by night and destroy the B-17s parked on the field.',
  'mission.germany-m2.place': 'Over Poltava airfield, Ukraine',
  'mission.germany-m2.objective': 'Destroy every parked B-17',
  'mission.germany-m2.banner': 'Airfield ahead. Bombs ready',

  'mission.germany-m3.title': 'Operation Bodenplatte',
  'mission.germany-m3.summary': 'Fly the Bf 109 K-4 in at treetop height and catch the Mustangs before they take off.',
  'mission.germany-m3.place': 'Y-29 airfield, Asch, Belgium',
  'mission.germany-m3.objective': 'Destroy every Mustang',
  'mission.germany-m3.banner': 'Mustangs on the ground. Go!',
  'mission.germany-m3.wave.taxi': 'Mustangs taxiing to the runway',
  'mission.germany-m3.wave.more': 'More Mustangs getting ready',
  'mission.germany-m3.wave.last': 'The last Mustangs are rolling',

  'mission.japan-m1.title': 'Over Guadalcanal',
  'mission.japan-m1.summary': 'Fly the Zeke, escort the Bettys, hold off the American fighters and let the Bettys torpedo the ships.',
  'mission.japan-m1.place': 'Off Guadalcanal, Solomon Islands',
  'mission.japan-m1.objective': 'Let the Bettys sink the ships',
  'mission.japan-m1.banner': 'Wildcats! Cover the Bettys',
  'mission.japan-m1.recycle': 'Warning: enemy fighters up again',

  'mission.japan-m2.title': 'The Leyte Front',
  'mission.japan-m2.summary': 'Fly the bomb-armed Frank against the American supply convoy before it reaches the front, then get out.',
  'mission.japan-m2.place': 'Leyte, Philippines',
  'mission.japan-m2.objective': 'Destroy the supply trucks',
  'mission.japan-m2.banner': 'Find the convoy. Stop it!',
  'mission.japan-m2.wave.carrier': 'Carrier fighters inbound',
  'mission.japan-m2.withdraw': 'Leave the area',

  'mission.japan-m3.title': 'Rennell Island',
  'mission.japan-m3.summary': 'Fly the Betty low over the sea at dusk and torpedo the American fleet.',
  'mission.japan-m3.place': 'Off Rennell Island, Solomon Islands',
  'mission.japan-m3.objective': 'Sink the enemy ships',
  'mission.japan-m3.banner': 'Get low. Go for the fleet',

  'unit.planes': '{n, plural, one {# plane} other {# planes}}',
}
