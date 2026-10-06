/** 同步探針暫時覆寫共用數值設定；量測完成或失敗後還原。不可並行或跨 await 使用。 */
export function withProbeConfig<T extends { [K in keyof T]: number }>(
  config: T,
  json: string | undefined,
  label: string,
  run: () => void,
): void {
  if (!json) {
    run()
    return
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error(`${label} 必須是有效的 JSON 物件`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} 必須是數值設定物件`)
  }
  // 全部驗證後才套用，避免後面的錯字留下半套設定。
  for (const [key, value] of Object.entries(parsed)) {
    if (!Object.hasOwn(config, key)) throw new Error(`${label} 未知設定：${key}`)
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`${label}.${key} 必須是有限數值`)
    }
  }

  const original = { ...config }
  Object.assign(config, parsed)
  try {
    run()
  } finally {
    Object.assign(config, original)
  }
}
