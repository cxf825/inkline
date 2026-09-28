// 面板下方的黑色 toast：独立透明小窗口，显示在工具栏底边下方 16pt。
// 为什么独立窗口：toast 要画在工具栏窗口之外（悬浮在画布上），
// 工具栏窗口自身够不到那个位置。
// 安全要点：持有模块级引用，绝不走 getWebview()（delegate 重建坑）；
// setIgnoreMouseEvents(true) 让 toast 永不挡画布点击。
import BrowserWindow from 'sketch-module-web-view'

const IDENTIFIER = 'inkline.toast.v1'
const WIN_H = 40 // 12 上边距 + 16 行高 + 12 下边距
const GAP = 16 // 与面板底边的间距

let win = null
let ready = false
let hideTimer = null

// 粗略估算文本宽度（中文 ≈ 12px/字，ASCII ≈ 6.5px/字）
function textWidth(s) {
  let w = 0
  for (const ch of String(s)) w += ch.charCodeAt(0) > 255 ? 12 : 6.5
  return w
}

function ensure(x, y, w) {
  if (win) {
    try { win.setSize(w, WIN_H, false) } catch (e) { /* ignore */ }
    try { win.setPosition(x, y, false) } catch (e) { /* ignore */ }
    return win
  }
  win = new BrowserWindow({
    identifier: IDENTIFIER,
    width: w,
    height: WIN_H,
    x: x,
    y: y,
    parent: undefined,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    hidesOnDeactivate: false,
    remembersWindowFrame: false,
  })
  win.once('ready-to-show', function () {
    ready = true
    try { win.setAlwaysOnTop(true, 'floating', 2) } catch (e) { /* ignore */ }
    // 关键：toast 只是提示，永远不接收鼠标事件，不挡下方画布操作
    try { win.setIgnoreMouseEvents(true) } catch (e) { /* ignore */ }
    win.show()
  })
  win.on('closed', function () {
    win = null
    ready = false
  })
  win.loadURL(require('./resources/toast.html'))
  return win
}

// 在 panel 底边下方 16pt 居中显示。y 坐标语义同 getBounds：底边距主屏顶的距离
export function showBelow(panel, msg) {
  msg = String(msg)
  try {
    const b = panel.getBounds()
    const w = Math.ceil(Math.min(560, Math.max(120, textWidth(msg) + 36)))
    const x = Math.round(b.x + b.width / 2 - w / 2)
    const y = Math.round(b.y + GAP + WIN_H) // toast 顶边 = 面板底边 + 16
    const t = ensure(x, y, w)

    const showIt = function () {
      if (!win) return
      try {
        win.webContents.executeJavaScript(
          'window.showToast(' + JSON.stringify(msg) + ')'
        )
      } catch (e) { /* ignore */ }
    }
    if (ready) {
      showIt()
    } else {
      t.once('ready-to-show', showIt)
    }

    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = setTimeout(function () {
      if (!win) return
      try {
        win.webContents.executeJavaScript('window.hideToast()')
      } catch (e) { /* ignore */ }
    }, 1800)
  } catch (e) {
    // 面板已关闭等场景：静默失败
  }
}
