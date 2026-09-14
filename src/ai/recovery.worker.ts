/// <reference lib="webworker" />
import { RecoveryWorkerEngine } from './recoveryWorkerEngine'
import type { RecoveryRequest, RecoveryResponse } from './recoveryProtocol'

const engine = new RecoveryWorkerEngine()
const scope = self as DedicatedWorkerGlobalScope

scope.onmessage = (event: MessageEvent<RecoveryRequest>): void => {
  const response: RecoveryResponse = engine.run(event.data)
  scope.postMessage(response)
}
