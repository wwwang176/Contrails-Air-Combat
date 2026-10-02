import { installHeightFog } from './heightFog'

/**
 * 載入就安裝高度霧。**一定要是 `main.ts` 的第一個 import**：ES 模組依 import 順序求值，要趕在任何
 * 模組編譯著色器或建自訂材質的 uniform 字典之前改好 three 的霧 chunk（見 `heightFog.ts`）。
 */
installHeightFog()
