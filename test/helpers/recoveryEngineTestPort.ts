import { RecoveryWorkerEngine } from '../../src/ai/recoveryWorkerEngine'
import type { RecoveryRequest, RecoveryResponse } from '../../src/ai/recoveryProtocol'
import type { RecoveryWorkerPort } from '../../src/ai/recoveryWorkerClient'

/**
 * Node 測試用的同步轉接器。它直接呼叫可單元測試的預演引擎，不建立 Web Worker、
 * 不啟動執行緒；訊息介面仍與正式 Worker 相同，方便測控制器的接線。
 */
export class RecoveryEngineTestPort implements RecoveryWorkerPort {
  onmessage: ((event: MessageEvent<RecoveryResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  private readonly engine = new RecoveryWorkerEngine()

  postMessage(message: RecoveryRequest): void {
    this.onmessage?.({ data: this.engine.run(message) } as MessageEvent<RecoveryResponse>)
  }
}
