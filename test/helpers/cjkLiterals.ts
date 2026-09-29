import ts from 'typescript'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * 找出 `src/` 裡含中文的字串字面值（含樣板字串的固定部分）。**只看字面值，註解不算**
 * —— 用 TypeScript 編譯器解析，而不是用正規表示式掃文字。
 *
 * 不算的：`src/tools/**`（開發工具頁）、GLSL 字串（註解是中文）、`console.*`／`throw`／
 * `new …Error()` 的引數（給開發者看的）。
 */
export interface CjkLiteral {
  /** 相對 repo 根目錄，斜線分隔 */
  readonly file: string
  readonly line: number
  /** 最內層具名函數或方法的名字；在模組層是空字串 */
  readonly fn: string
  readonly text: string
}

const CJK = /[　-〿㐀-鿿＀-￯]/
const GLSL = /\b(vec[234]|mat[34]|float|uniform|varying|gl_Frag\w*|texture2D|void main|#include)\b/

function sourceFiles(dir: string, out: string[]): void {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) {
      if (n !== 'tools') sourceFiles(p, out)
    } else if (p.endsWith('.ts')) {
      out.push(p)
    }
  }
}

function developerOnly(n: ts.Node): boolean {
  for (let p = n.parent; p !== undefined; p = p.parent) {
    if (ts.isThrowStatement(p)) return true
    if (ts.isNewExpression(p) && /Error$/.test(p.expression.getText())) return true
    if (ts.isCallExpression(p) && /^console\./.test(p.expression.getText())) return true
    if (ts.isSourceFile(p)) return false
  }
  return false
}

function enclosingName(n: ts.Node): string {
  for (let p = n.parent; p !== undefined; p = p.parent) {
    if ((ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) && p.name !== undefined) {
      return p.name.getText()
    }
    if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && ts.isVariableDeclaration(p.parent)) {
      return p.parent.name.getText()
    }
  }
  return ''
}

export function cjkLiterals(root: string): CjkLiteral[] {
  const files: string[] = []
  sourceFiles(join(root, 'src'), files)
  const out: CjkLiteral[] = []
  for (const f of files) {
    const src = ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true)
    const file = relative(root, f).replaceAll('\\', '/')
    const visit = (n: ts.Node): void => {
      let text: string | null = null
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) text = n.text
      else if (ts.isTemplateExpression(n)) {
        text = [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join('${}')
      }
      if (text !== null && CJK.test(text) && !GLSL.test(text) && !developerOnly(n)) {
        out.push({ file, line: src.getLineAndCharacterOfPosition(n.getStart()).line + 1, fn: enclosingName(n), text })
      }
      // 樣板字串的片段已經整個算過，不再往下走
      if (!ts.isTemplateExpression(n)) ts.forEachChild(n, visit)
    }
    visit(src)
  }
  return out
}
