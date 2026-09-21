import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * 音效的接線護欄 —— **讀 `main.ts` 的原始碼**，照 `bomb-bay-wiring.test.ts` 的寫法。
 * 小部件各自有單元測試；這裡守的是「有沒有接上、接的順序對不對」，
 * 那種壞法不會報錯，只是某個聲音不見或停不下來。
 */
const SRC = new TextDecoder().decode(readFileSync('src/main.ts')).replace(/\r\n/g, '\n').split('\n')
const ALL = SRC.join('\n')

function lines(needle: string): number[] {
  const hits: number[] = []
  for (let i = 0; i < SRC.length; i++) if (SRC[i]!.includes(needle)) hits.push(i)
  return hits
}

/** 從 `head` 那一行起、到下一個頂層 `}` 為止的函式本體 */
function body(head: string): string {
  const at = lines(head)[0]
  expect(at, head).toBeDefined()
  let end = at! + 1
  while (end < SRC.length && SRC[end] !== '}') end++
  return SRC.slice(at, end + 1).join('\n')
}

describe('音效的生命週期接線', () => {
  /** 【手勢裡解鎖】瀏覽器要使用者手勢才肯出聲；出擊那一下就是 grabPointer */
  it('grabPointer 裡解鎖音訊', () => {
    expect(body('function grabPointer(')).toContain('audio.unlock()')
  })

  /**
   * 【暫停只有一個入口】`paused` 的寫入點散在好幾處（Esc、教學卡、重新開始、
   * 換畫面）。漏掉任何一處，那條路徑上的聲音就不會停。
   */
  it('paused 只在 setPausedState 裡寫，而它同時通知音訊', () => {
    const fn = body('function setPausedState(')
    expect(fn).toContain('audio.setPaused(')
    const outside = ALL.replace(fn, '').replace('let paused = false', '')
    expect(outside).not.toMatch(/\bpaused = (true|false)/)
  })

  it('離開戰鬥停掉所有聲音', () => {
    expect(body('function leaveBattle(')).toContain('audio.stopAll()')
  })

  /**
   * 【背景下載】音效不擋開場；進戰鬥時才等它。
   * 沒載完時這是唯一還要連網的一步 —— 不掛進度的話載入畫面會卡在一個數字不動。
   */
  it('進戰鬥前等音效載完，而且把進度掛上載入畫面', () => {
    const fn = body('async function loadBattle(')
    expect(fn).toContain('await audio.load((done, total) =>')
    expect(fn).toContain("loading.set('載入音效', 0.7 + 0.15 * fileFraction(done, total))")
  })

  it('離開戰鬥清空佇列、重設邊緣偵測的狀態', () => {
    const fn = body('function leaveBattle(')
    expect(fn).toContain('clearCues(cues)')
    expect(fn).toContain('resetAudioState()')
  })

  /** 【接手僚機也要重設】上一架正在裝填、新的這架沒有，會誤播「裝填完成」 */
  it('接手僚機時重設邊緣偵測的狀態', () => {
    const at = lines('if (battle.player !== player) {')[0]!
    expect(SRC.slice(at, at + 30).join('\n')).toContain('resetAudioState()')
  })

  it('設定頁改音量會套用到音訊', () => {
    const at = lines('onVolume(db) {')[0]!
    expect(SRC.slice(at, at + 5).join('\n')).toContain('audio.setVolume(db)')
  })
})

describe('音效的戰鬥事件接線', () => {
  const advance = lines('loop.advance(frameSeconds, (dt) => {')[0]!
  const endPhysics = lines('perf.endPhysics()')[0]!
  const inStep = (i: number): boolean => i > advance && i < endPhysics

  /**
   * 【讀在清之前】世界的事件在物理子步裡就被清掉。記錄的那一行排在清除之後，
   * 讀到的永遠是空的 —— 一個聲音都沒有，而且不報錯。
   */
  it('子步裡記事件，排在每一種事件的清除之前', () => {
    const q = lines('queueAudioCues()').filter(inStep)
    expect(q).toHaveLength(1)
    for (const clear of ['clearDamage(dmg)', 'emitGroundKills(world.groundKillEvents)', 'clearKills(world.killEvents)',
      'clearImpacts(world.bombEvents)', 'clearImpacts(world.torpedoEvents)', 'clearBursts(world.burstEvents)']) {
      const c = lines(clear).filter(inStep)
      expect(c, clear).toHaveLength(1)
      expect(q[0]!, clear).toBeLessThan(c[0]!)
    }
  })

  /**
   * 【被打中要分機體與部位】不分的話 B-17 與零戰被打中一模一樣。部位由受擊事件
   * 帶過來（`DAMAGE_STRIDE` 的第 5 格），質量與護甲讀自己那架的 spec。
   */
  it('自己被打中的播放速度依機體質量與部位護甲', () => {
    expect(body('function queueAudioCues(')).toContain('pushCue(cues, CUE.HitSelf, dmg.data[o + 4]!')
    expect(body('function playCues(')).toContain("audio.playPool('hit', 'hitSelf', 0, 0, 0, false, 0, true, selfHitRate(x))")
    const fn = body('function selfHitRate(')
    expect(fn).toContain('hitRate(spec.mass, spec.protection[partOf(partIndex)])')
    expect(body('function partOf(')).toContain('HIT_PARTS[partIndex]')
  })

  /**
   * 【打中誰都播，走同一條曲線】不分射手 —— 僚機打中的也聽得到，太遠的由距離
   * 衰減擋掉。所以距離要量**真正被打中的那一架**，不能拿「最近的敵機」來估。
   */
  it('有飛機被打中就播，速度與距離都看被打中的那一架', () => {
    const q = body('function queueAudioCues(')
    expect(q).toContain('lastDealtVictim = dmg.data[o]!')
    expect(q).toContain('lastDealtPart = dmg.data[o + 4]!')
    expect(q).toContain('hitDealtPending = true')
    const fn = body('function playHitDealt(')
    expect(fn).toContain('world.combatants[lastDealtVictim]')
    expect(fn).toContain('hitFeedback(victim.aircraft.state.position.distanceTo(ctx.camera.position), HIT_FB)')
    expect(fn).toContain('hitRate(spec.mass, spec.protection[partOf(lastDealtPart)])')
    expect(fn).toContain('false, rate, HIT_FB.cutoffHz)')
    const upd = body('function updateAudio(')
    expect(upd).toContain('if (hitDealtPending && flying) playHitDealt()')
    expect(upd).toContain('hitDealtPending = false')
    expect(body('function resetAudioState(')).toContain('lastDealtVictim = -1')
  })

  /**
   * 【擦過看鏡頭不看機身】上帝視角時鏡頭在世界裡自由飛，從它旁邊掠過的子彈
   * 一樣該有聲音；那時也不屬於任何一邊，兩邊的子彈都算（隊伍傳 −1）。
   */
  it('擦過判定用鏡頭位置，上帝視角時兩邊的子彈都算', () => {
    const fn = body('function updateAudio(')
    expect(fn).toContain('nearMiss(world.projectiles, team, eye.x, eye.y, eye.z, FLYBY_RADIUS)')
    expect(fn).toContain('const team = input.godView ? -1 : teamSlot(me.team)')
    // 擦過排在「沒坐在座艙裡就提前結束」之前
    expect(fn.indexOf('nearMiss(')).toBeLessThan(fn.indexOf('if (!flying) {'))
  })

  /**
   * 【打在飛機以外的東西上要有聲音】船殼、建築各有自己的材質；查不到的走預設，
   * 不會整個沒聲音。**一定要限頻率** —— 對船掃射每秒命中幾十發，不限的話
   * 光這一項就把事件佇列灌滿，爆炸與擊落全被擠掉。
   */
  it('子彈打到船殼、建築有定位的撞擊聲，而且限頻率', () => {
    const q = body('function queueAudioCues(')
    expect(q).toContain('world.materialHits')
    expect(q).toContain('MATERIAL_HIT_GAP')
    expect(q).toContain('pushCue(cues, CUE.MaterialHit')
    expect(q).toContain('clearImpacts(mh)')
    const fn = body('function playCues(')
    expect(fn).toContain('const m = impactSound(scale)')
    expect(fn).toContain("audio.playPool(m.pool, 'impact', x, y, z, true, m.gainDb, false, m.rate)")
  })

  it('記錄擊落、空爆、自己被打', () => {
    const fn = body('function queueAudioCues(')
    for (const cue of ['CUE.Explosion', 'CUE.FlakBurst', 'CUE.HitSelf']) expect(fn).toContain(`pushCue(cues, ${cue}`)
  })

  /** 【子步不碰 Web Audio】240 Hz 裡建音源會每步配置 */
  it('子步裡沒有直接播放', () => {
    for (const call of ['audio.playPool(', 'audio.playFile(', 'audio.selfLoop(', 'audio.assign(']) {
      expect(lines(call).filter(inStep), call).toHaveLength(0)
    }
  })

  /** 【鏡頭更新完才播】距離、延遲、低通都量到鏡頭；用上一幀的鏡頭會差一幀 */
  it('每一幀在鏡頭定位之後播放並清空佇列', () => {
    const cam = lines('applyCameraShake(cameraShake, ctx.camera)')[0]!
    const call = lines('updateAudio(').filter((i) => !SRC[i]!.includes('function'))
    expect(call).toHaveLength(1)
    expect(call[0]!).toBeGreaterThan(cam)
    const fn = body('function updateAudio(')
    expect(fn).toContain('playCues()')
    expect(fn).toContain('clearCues(cues)')
  })

  /**
   * 【先更新聲道再播單次音效】搶聲道比的是估計響度。順序反過來的話，新的聲音
   * 拿這一幀的距離去跟播放中聲道上一幀的舊值比，明明比較響也會被擋掉。
   */
  it('beginFrame 排在所有單次音效之前', () => {
    const fn = body('function updateAudio(')
    expect(fn.indexOf('audio.beginFrame()')).toBeGreaterThan(0)
    for (const call of ['playCues()', 'playHitDealt()', 'playCannons()']) {
      expect(fn.indexOf('audio.beginFrame()'), call).toBeLessThan(fn.indexOf(call))
    }
    expect(fn.indexOf('audio.beginFrame()')).toBeLessThan(fn.indexOf('audio.assign('))
    expect(fn.indexOf('audio.assign(')).toBeLessThan(fn.indexOf('audio.endFrame()'))
  })

  /**
   * 【哪幾類疊兩層】爆炸、水花、自己被打一次挑兩個不同的疊；受創疊一下命中。
   * 打中敵機、砲擊、空爆、擦過不疊 —— 太密集，聲道會被吃光。
   */
  it('爆炸、水花、自己被打疊兩層；受創疊命中', () => {
    const fn = body('function playCues(')
    expect(fn).toContain("audio.playPool('explosion', 'explosion', x, y, z, true, db, true, rate)")
    expect(fn).toContain("audio.playPool('splash', 'splash', x, y, z, true, db, true, rate)")
    expect(fn).toContain("audio.playPool('hit', 'hitSelf', 0, 0, 0, false, 0, true, selfHitRate(x))")
    expect(fn).toContain("audio.playPool('flakBurst', 'flakBurst', x, y, z, true, 0, true)")
    expect(fn).toContain('playHeavyHit(x)')
    const heavy = body('function playHeavyHit(')
    expect(heavy).toContain("audio.playPool('damage'")
    expect(heavy).toContain("audio.playPool('hit', 'hitSelf', 0, 0, 0, false, db + LAYER_DB)")
  })

  /**
   * 【多普勒只給循環音】Web Audio 沒有內建的 Doppler，自己乘在播放速度上。
   * 三個循環池都要乘 —— 只給引擎的話，同一架飛機的引擎升調而機槍不動。
   */
  it('三個定位循環都乘上多普勒', () => {
    const fn = body('function updateAudio(')
    for (const pool of ["audio.assign('engine'", "audio.assign('fire'", "audio.assign('turret'"]) {
      const at = fn.indexOf(pool)
      expect(at, pool).toBeGreaterThan(0)
      // 引擎那一行的係數先算在上一行，其他兩個寫在參數裡 —— 前後都看
      expect(fn.slice(Math.max(0, at - 180), at + 260), pool)
        .toContain('dopplerRate(p, c.aircraft.state.velocity, cam, camVel)')
    }
  })

  /**
   * 【鏡頭瞬移不是速度】切視角、重生、換場會讓鏡頭一幀跳幾百公尺，
   * 相減出來是幾千 m/s —— 那一幀所有引擎聲會整片變調。
   */
  it('鏡頭速度逐幀相減，擋掉瞬移，而且每一幀更新一次', () => {
    const fn = body('function trackCameraVelocity(')
    expect(fn).toContain('CAM_TELEPORT_SPEED')
    expect(fn).toContain('camVel.set(0, 0, 0)')
    const call = lines('trackCameraVelocity(').filter((i) => !SRC[i]!.includes('function'))
    expect(call).toHaveLength(1)
    const upd = body('function updateAudio(')
    expect(upd.indexOf('trackCameraVelocity(')).toBeLessThan(upd.indexOf("audio.assign('engine'"))
    expect(body('function resetAudioState(')).toContain('camPosValid = false')
  })

  /**
   * 【爆炸聲跟著當量走】零戰的 60 kg 彈當量尺度 0.11、陸攻的魚雷 1.67，差 15 倍。
   * 不帶當量的話兩者一模一樣響 —— 不報錯，只是聽不出打的是什麼。
   * 當量與畫面那一套同一個來源（`blastScaleOf`），兩邊才不會各說各話。
   */
  it('炸彈與魚雷的爆炸、水花帶當量', () => {
    const fn = body('function queueAudioCues(')
    // 炸彈的爆炸／水花／落水悶響，加魚雷的爆炸／水花
    expect(fn.match(/blastScaleOf\(/g) ?? []).toHaveLength(2)
    expect(fn.match(/pushCue\(cues, CUE\.\w+, [^)]*, scale\)/g) ?? []).toHaveLength(5)
    const play = body('function playCues(')
    expect(play).toContain('blastGainDb(scale)')
    expect(play).toContain('blastRate(scale)')
  })

  /**
   * 【打中敵機要限頻率】掃到敵機時幾乎每一幀都有命中，而命中聲平均長 0.65 s；
   * 不限的話 60 fps 會疊將近 40 層，比單獨一次大 16 dB，還會把聲道池佔滿。
   */
  it('打中敵機不疊、限制頻率、依距離衰減與變悶', () => {
    const fn = body('function playHitDealt(')
    expect(fn).toContain('HIT_DEALT_GAP')
    expect(fn).toContain('hitFeedback(')
    expect(fn).toContain("audio.playPool('hit', 'hitDealt', 0, 0, 0, false, HIT_FB.gainDb, false, rate, HIT_FB.cutoffHz)")
  })

  /** 【投彈時飛機本身不出聲】每一顆炸彈自己的呼嘯就是回饋，包括自己投的 */
  it('投彈投雷不另外出聲，自己投的炸彈也會呼嘯', () => {
    expect(ALL).not.toContain("audio.playPool('release'")
    const fn = body('function updateAudio(')
    expect(fn).toContain('audio.playFile(SINGLE_FILES.whistle')
    expect(fn).not.toContain('bombs.owner[i] === me.index')
  })

  /** 【被高射砲炸到也要有感覺】爆風的傷害不走子彈那條事件，只能自己判 */
  it('高射砲的爆風打到自己時記一筆機身受創', () => {
    const fn = body('function queueAudioCues(')
    expect(fn).toContain('pushCue(cues, CUE.Damage')
    expect(fn).toContain('f.radius[i]')
  })

  /** 【超速也要警告】原本只有飛出邊界會響；超速是另一種「再這樣下去會出事」 */
  it('飛出邊界或超速時警告蜂鳴', () => {
    const fn = body('function updateAudio(')
    expect(fn).toContain('arena.outside')
    expect(fn).toContain('OVERSPEED_FULL')
  })

  /**
   * 【自己的槍不播循環】循環是連續掃射，播多久就聽到幾發 —— 點放一次會被聽成
   * 好幾發，停的時候又一定切在某一發中間。自己那架改成一次擊發播一個齊射
   * one-shot；別人的槍與砲塔仍用循環加 `FIRE_HOLD`，不然聲道一直釋放又重播。
   */
  it('自己的槍用齊射 one-shot，別人的才用開火循環', () => {
    expect(ALL).not.toContain("audio.selfLoop('fire'")
    expect(body('function playCues(')).toContain("audio.playPool(volleyGroups[x]!.pool, 'fireSelf'")
    expect(body('function updateAudio(')).toContain("audio.assign('fire'")
  })

  /**
   * 【擊發要在子步裡記】槍焰只亮 0.03 s，而世界時鐘一幀最多走 8/240 = 33.3 ms，
   * 每一幀才看一次的話整次擊發會被跳過 —— 不報錯，只是偶爾沒聲音。
   */
  it('自己開火在子步裡做邊緣偵測', () => {
    const fn = body('function queueAudioCues(')
    expect(fn).toContain('pushCue(cues, CUE.SelfVolley')
    expect(fn).toContain('prevVolleyFlash')
    expect(fn).toContain('input.godView')
  })

  /**
   * 【換機要重算分組】掛架與武器種類都變了，沿用上一架的分組會播錯庫或整組沒聲音。
   * `player` 的寫入點有三處（開場、換場、接手僚機），漏掉任何一處都不會報錯。
   */
  it('player 只在 setPlayer 裡寫，而它同時重算齊射分組', () => {
    const fn = body('function setPlayer(')
    expect(fn).toContain('rebuildVolleyGroups()')
    const outside = ALL.replace(fn, '').replace('let player!: Combatant', '')
    expect(outside).not.toMatch(/(^|[^.\w])player = /m)
  })

  it('按 B 切換投彈視角時響一下彈艙', () => {
    const fn = body('function updateAudio(')
    expect(fn).toContain('prevViewMode')
    expect(fn).toContain("audio.playFile(SINGLE_FILES.bayToggle")
  })

  /**
   * 【上帝視角不播身上的聲音】那時鏡頭在世界裡、離自機很遠，而這些聲音是不定位的
   * —— 貼在鏡頭上播等於「在耳邊」，與畫面完全對不上。
   */
  it('上帝視角時不記、不播自己身上的單次音效', () => {
    expect(body('function queueAudioCues(')).toContain('input.godView')
    const fn = body('function updateAudio(')
    const at = fn.indexOf('playHitDealt()')
    expect(at).toBeGreaterThan(0)
    expect(fn.slice(Math.max(0, at - 120), at)).toContain('flying')
  })

  it('增援預警換新時播無線電', () => {
    const at = lines('messageText = battle.message')[0]!
    expect(SRC.slice(at - 3, at + 6).join('\n')).toContain("audio.playPool('radio'")
  })
})

describe('單次音效的聲道池', () => {
  const ENGINE = new TextDecoder().decode(readFileSync('src/audio/engine.ts')).replace(/\r\n/g, '\n')

  /**
   * 【每一幀重算距離】聲音長達兩三秒，這期間鏡頭會飛掉好幾百公尺。
   * 只在起播時算一次的話，俯衝進爆炸點也不會變清晰 —— 不報錯，只是怎麼靠近都悶悶的。
   */
  it('每一幀更新播放中定位聲道的低通與音量', () => {
    const fn = ENGINE.slice(ENGINE.indexOf('function updateVoices('), ENGINE.indexOf('function beginFrame('))
    expect(fn).toContain('camDistance(')
    expect(fn).toContain('setCutoff(')
    expect(fn).toContain('absorptionDb(d)')
    expect(fn).toContain('voiceLoudnessDb(')
    const begin = ENGINE.slice(ENGINE.indexOf('function beginFrame('), ENGINE.indexOf('function assign('))
    expect(begin).toContain('updateVoices()')
  })

  /**
   * 【搶聲道比響度】一波投彈幾十聲同時發生。只比距離的話，
   * 遠處一聲不重要的呼嘯會佔著聲道，近處的爆炸就整個沒聲音。
   */
  it('池滿時搶最不響的，而且新的更小聲就不播', () => {
    const fn = ENGINE.slice(ENGINE.indexOf('function playFile('), ENGINE.indexOf('function playPool('))
    expect(fn).toContain('v.loudness < pick.loudness')
    expect(fn).toContain('pick.loudness >= loud')
  })

  /**
   * 【延遲不能排進 start()】`AudioBufferSourceNode.start()` 一旦排下去就改不了。
   * 起播時算好一個固定延遲的話，朝爆炸點衝過去也要等滿原本的秒數。
   */
  it('定位的單次音效等音波傳到才播，每一幀用當下距離重問', () => {
    const play = ENGINE.slice(ENGINE.indexOf('function playFile('), ENGINE.indexOf('function playPool('))
    expect(play).toContain('pick.waitingSince = ctx.currentTime')
    const update = ENGINE.slice(ENGINE.indexOf('function updateVoices('), ENGINE.indexOf('function beginFrame('))
    expect(update).toContain('soundArrived(now - v.waitingSince, d)')
    expect(update).toContain('v.audio.play(v.waitDelay)')
  })

  /**
   * 【three 只在播放中同步 panner】`updateMatrixWorld` 在 `isPlaying === false`
   * 時直接返回，而它同步時是一幀長度的漸變 —— 少了這一步，起音會從上一個聲音的
   * 位置滑過來，方向與距離都錯。
   */
  it('每次開始播之前把座標直接寫進 panner', () => {
    const play = ENGINE.slice(ENGINE.indexOf('function playFile('), ENGINE.indexOf('function playPool('))
    expect(play).toMatch(/placePanner\(pick\)\n\s*a\.play\(/)
    const update = ENGINE.slice(ENGINE.indexOf('function updateVoices('), ENGINE.indexOf('function beginFrame('))
    expect(update).toMatch(/placePanner\(v\)\n\s*v\.audio\.play\(/)
  })

  /** 【等待中的聲道也佔著】它已經排好要響，被搶走就整個沒聲音 */
  it('搶聲道時把等音波的聲道算成佔用中', () => {
    const fn = ENGINE.slice(ENGINE.indexOf('function playFile('), ENGINE.indexOf('function playPool('))
    expect(fn).toContain('!v.audio.isPlaying && v.waitingSince < 0')
  })

  /** 【聲道不夠就先別疊】疊第二層是好聽，發得出聲才是必要 */
  it('空聲道不足時不疊第二層', () => {
    const fn = ENGINE.slice(ENGINE.indexOf('function playPool('), ENGINE.indexOf('function selfLoop('))
    expect(fn).toContain('lastFreeVoices < LAYER_MIN_FREE')
  })
})
