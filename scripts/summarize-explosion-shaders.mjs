import fs from 'node:fs'
import path from 'node:path'

const file = process.argv[2]
if (!file) throw new Error('用法：node scripts/summarize-explosion-shaders.mjs <results.json>')
const data = JSON.parse(fs.readFileSync(file, 'utf8'))
const median = values => {
  const a = [...values].sort((x, y) => x - y)
  const i = Math.floor(a.length / 2)
  return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2
}
const variants = ['baseline', 'light', 'zero', 'hash', 'lightHash', 'combined']
  .filter(variant => data.results.some(r => r.variant === variant))
const summary = {
  info: data.info,
  method: '每項每輪 45 個 GPU timer 樣本，共三輪；每輪頭尾原版相差超過 10% 則排除該輪，不以 FPS 推算。',
  limitation: '展示區固定單次爆炸，保留近鏡頭遮罩；不包含實戰物理、其他單位或場景點光源成本。lit 案例為額外煙霧燈光驗證。',
  cases: [],
  imageChecks: {
    compared: data.results.filter(r => r.phase === 'comparison').length,
    maxChangedPixels: Math.max(...data.results.map(r => r.image.changedPixels)),
    maxChannelDelta: Math.max(...data.results.map(r => r.image.maxChannelDelta)),
  },
  errors: data.errors,
}
for (const spec of data.cases) {
  const rows = data.results.filter(r => r.phase === 'comparison' && r.setup.id === spec.id)
  const rounds = [...new Set(rows.map(r => r.round))]
  const baselines = new Map()
  const excluded = []
  for (const round of rounds) {
    const b = rows.filter(r => r.round === round && r.variant === 'baseline').map(r => r.gpu.median)
    if (b.length !== 2) throw new Error('一輪必須有頭尾兩個基準值')
    const drift = Math.abs(b[1] - b[0]) / ((b[0] + b[1]) / 2)
    if (drift > .1) excluded.push({ round, start: b[0], end: b[1], driftPercent: drift * 100 })
    else baselines.set(round, (b[0] + b[1]) / 2)
  }
  if (baselines.size < 2) throw new Error(spec.id + ' 穩定輪次不足，需要重測')
  const table = {}
  for (const variant of variants) {
    const selected = rows.filter(r => r.variant === variant && baselines.has(r.round))
    table[variant] = {
      gpuMs: median(selected.map(r => r.gpu.median)),
      gpuMedianRangeMs: [Math.min(...selected.map(r => r.gpu.median)), Math.max(...selected.map(r => r.gpu.median))],
      cpuSubmitMs: median(selected.map(r => r.cpu.median)),
      savingPercent: variant === 'baseline' ? 0 : median(selected.map(r => (1 - r.gpu.median / baselines.get(r.round)) * 100)),
    }
  }
  summary.cases.push({ ...spec,
    freshBaselineMs: data.results.find(r => r.phase === 'fresh-baseline' && r.setup.id === spec.id).gpu.median,
    stableRounds: baselines.size, excluded, table })
}
fs.writeFileSync(path.join(path.dirname(file), 'summary.json'), JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary, null, 2))
