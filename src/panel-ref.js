// 共享工具栏面板的原始 BrowserWindow 引用。
// 注意：不要用 getWebview(identifier) 取工具栏面板——fromPanel 会重新 setDelegates，
// 把 navigationDelegate 的 wasReady 重置为 0，导致 executeJavaScript 永远等待
// ready-to-show 而静默失效（v0.2.0 样式/色板无反应的根因）。
import { UI } from 'sketch'

let panel = null

export function setPanel(win) {
  panel = win
}

export function getPanel() {
  return panel
}

// 向面板执行一段 JS（仅当面板存在）
export function execInPanel(js) {
  if (!panel) return false
  try {
    panel.webContents.executeJavaScript(js)
    return true
  } catch (e) {
    return false
  }
}

// 在面板内弹 toast（Sketch 画布左下角的 UI.message 容易被忽略）
export function panelToast(msg) {
  execInPanel('window.toast(' + JSON.stringify(String(msg)) + ')')
}

// 统一通知：面板内黑色 toast（主）；面板不存在时才兜底 Sketch 画布 HUD。
// 用户要求所有提示都覆盖显示在面板上，不要出现在 Sketch 底部。
export function toast(msg) {
  msg = String(msg)
  if (!panelToast(msg)) UI.message(msg)
}

// 旧名字保留（palette.js 在用）
export function notify(msg) {
  toast(msg)
}
