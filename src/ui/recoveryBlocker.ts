import type { RecoveryFailure } from '../ai/recoveryWorkerClient'
import { t } from '../i18n'

/** 防墜 Worker 失效時顯示單一故障畫面；是否停止模擬由呼叫端決定。 */
export function blockForRecoveryWorker(failure: RecoveryFailure): void {
  if (document.getElementById('recovery-worker-blocker') !== null) return
  void document.exitPointerLock?.()
  const blocker = document.createElement('section')
  blocker.id = 'recovery-worker-blocker'
  blocker.dataset.failure = failure
  blocker.setAttribute('role', 'alert')
  blocker.setAttribute('aria-live', 'assertive')
  const title = document.createElement('h1')
  title.textContent = t('recovery.title')
  const detail = document.createElement('p')
  detail.textContent = `${t(failure)} ${t('recovery.body')}`
  blocker.append(title, detail)
  document.body.appendChild(blocker)
}
