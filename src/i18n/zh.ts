/**
 * 中文文字表。**鍵的型別由這一張推導**（`MessageKey`），英文表必須有同一組鍵。
 *
 * 句型是 ICU MessageFormat（`intl-messageformat`）：參數寫成 `{name}`，英文的單複數用
 * `{n, plural, one {…} other {…}}`。字面的大括號要用單引號包起來（`'{'`）。
 *
 * 【數字參數】`{n}` 會套千分位；年份這種不該有逗號的，呼叫端傳字串。
 */
export const zh = {
  'common.ok': '確定',

  'format.month': '{year} 年 {month} 月',

  'menu.stage': '第 {n} 關',

  'mission.type.annihilate': '殲滅',
  'mission.type.intercept': '攔截',
  'mission.type.strike': '打擊',
  'mission.type.escort': '護航',
  'mission.type.withdraw': '撤離',

  'mission.killAll.objective': '擊落全部敵機',

  'result.skirmish': '遭遇戰',

  'brief.place': '空域',
  'brief.period': '時期',

  'mission.allies-m1.title': '柏林上空',
  'mission.allies-m1.summary': '駕駛 P-51D，護送 B-17 第一次在白天轟炸柏林。',
  'mission.allies-m1.place': '德國 柏林上空',
  'mission.allies-m1.objective': '護送 B-17 抵達柏林',
  'mission.allies-m1.banner': '敵機來了，護住轟炸機',
  'mission.allies-m1.recycle': '更多攔截機升空',
  'mission.allies-m1.wave.more': '警告：更多敵機接近',
  'mission.allies-m1.wave.join': '警告：敵機加入攔截',

  'mission.allies-m2.title': '梅澤堡的油廠',
  'mission.allies-m2.summary': '駕駛 B-17G，頂著敵機與高射砲，炸毀洛伊納油廠。',
  'mission.allies-m2.place': '德國中部 洛伊納油廠上空',
  'mission.allies-m2.objective': '炸毀洛伊納油廠',
  'mission.allies-m2.banner': '撐過攔截，把炸彈投進油廠',
  'mission.allies-m2.wave.rear': '警告：敵機從後方接近',

  'mission.allies-m3.title': '沖繩外海',
  'mission.allies-m3.summary': '駕駛 F6F-5 守護航母，擋下俯衝的零戰和貼著海面來的雷擊機。',
  'mission.allies-m3.place': '沖繩外海 慶良間列島以西',
  'mission.allies-m3.objective': '守住航母',
  'mission.allies-m3.banner': '零戰來了，別讓它們靠近航母',
  'mission.allies-m3.recycle': '雷達發現更多零戰',
  'mission.allies-m3.wave.torpedo': '低空發現雷擊機',

  'mission.germany-m1.title': '梅澤堡上空',
  'mission.germany-m1.summary': '駕駛 Bf 109 K-4 衝進 B-17 轟炸機群，甩開護航的野馬，把轟炸機打下來。',
  'mission.germany-m1.place': '德國中部 梅澤堡—洛伊納',
  'mission.germany-m1.objective': '擊落 B-17',
  'mission.germany-m1.banner': '轟炸機群來了，攔住它們',
  'mission.germany-m1.wave.escort': '前方轟炸機群，P-51 護航',
  'mission.germany-m1.wave.more': '警告：敵方護航機接近中',

  'mission.germany-m2.title': '波爾塔瓦之夜',
  'mission.germany-m2.summary': '駕駛 He 111 趁夜飛到波爾塔瓦機場，炸毀停在地上的 B-17。',
  'mission.germany-m2.place': '烏克蘭 波爾塔瓦機場上空',
  'mission.germany-m2.objective': '炸毀全部停放的 B-17',
  'mission.germany-m2.banner': '機場就在前方，準備投彈',

  'mission.germany-m3.title': '底板行動',
  'mission.germany-m3.summary': '駕駛 Bf 109 K-4 貼著樹梢衝進機場，趁野馬還沒起飛把它們打掉。',
  'mission.germany-m3.place': '比利時 阿什 Y-29 機場',
  'mission.germany-m3.objective': '擊毀全部野馬',
  'mission.germany-m3.banner': '野馬還在地上，快衝進去',
  'mission.germany-m3.wave.taxi': '野馬開始滑向跑道',
  'mission.germany-m3.wave.more': '更多野馬準備起飛',
  'mission.germany-m3.wave.last': '剩下的野馬全部出動',

  'mission.japan-m1.title': '瓜達康納爾上空',
  'mission.japan-m1.summary': '駕駛零戰護送一式陸攻，擋下美軍戰鬥機，讓陸攻用魚雷擊沉敵艦。',
  'mission.japan-m1.place': '所羅門 瓜達康納爾外海',
  'mission.japan-m1.objective': '讓陸攻擊沉敵艦',
  'mission.japan-m1.banner': '野貓來了，保護好陸攻',
  'mission.japan-m1.recycle': '警告：敵方戰鬥機再度升空',

  'mission.japan-m2.title': '雷伊泰前線',
  'mission.japan-m2.summary': '駕駛疾風掛彈攻擊美軍補給車隊，趕在它們抵達前線之前，然後撤離。',
  'mission.japan-m2.place': '菲律賓 雷伊泰島',
  'mission.japan-m2.objective': '炸毀補給卡車',
  'mission.japan-m2.banner': '找到車隊，別讓它們抵達前線',
  'mission.japan-m2.wave.carrier': '敵艦載機接近中',
  'mission.japan-m2.withdraw': '撤離戰區',

  'mission.japan-m3.title': '倫內爾島',
  'mission.japan-m3.summary': '駕駛一式陸攻趁著黃昏貼海飛行，用魚雷擊沉美軍艦隊。',
  'mission.japan-m3.place': '所羅門 倫內爾島外海',
  'mission.japan-m3.objective': '擊沉敵艦',
  'mission.japan-m3.banner': '壓低高度，衝向艦隊',

  'unit.planes': '{n} 架',
} as const

export type MessageKey = keyof typeof zh
