import BrowserWindow from 'sketch-module-web-view'
import { UI } from 'sketch'
import { markSizes, markSpacings, markProperties, clearMarks, addNote } from './measure.js'
import { exportSpec } from './export.js'
import { openIconLibrary } from './iconfont.js'
import { mockText, mockTextCustom, mockImage, chooseImageDir, openWordsEditor } from './mock.js'
import { exportSlices } from './assets.js'
import { runSlice } from './slice.js'
import { requestPalette, addSelectedColor, removeColor, copyColor } from './palette.js'
import { setPanel, getPanel } from './panel-ref.js'
import help from './help.js'

// 换代标识：避免旧版 remembersWindowFrame 记忆的位置覆盖定位逻辑
const IDENTIFIER = 'inkline.toolbar.v5'

const ACTIONS = {
  markSizes: markSizes,
  markSpacings: markSpacings,
  markProperties: markProperties,
  clearMarks: clearMarks,
  addNote: addNote,
  exportSpec: exportSpec,
  exportSlices: exportSlices,
  iconLibrary: openIconLibrary,
  help: help
}

// 带参数的动作：面板 postMessage('run', JSON{name, arg})
function dispatchRun(payloadJson) {
  let payload = {}
  try { payload = JSON.parse(payloadJson) } catch (e) { /* ignore */ }
  if (payload.name === 'mockText') return mockText(payload.arg)
  if (payload.name === 'mockTextCustom') return mockTextCustom()
  if (payload.name === 'editWords') return openWordsEditor()
  if (payload.name === 'setImgDir') return chooseImageDir()
  if (payload.name === 'mockImage') return mockImage(payload.arg)
  if (payload.name === 'slice') return runSlice(payload.arg)
  if (payload.name === 'requestPalette') return requestPalette()
  if (payload.name === 'addSelectedColor') return addSelectedColor()
  if (payload.name === 'removeColor') return removeColor(payload.arg)
  if (payload.name === 'copyColor') return copyColor(payload.arg)
  const fn = ACTIONS[payload.name]
  if (fn) return fn()
  throw new Error('未知动作: ' + payload.name)
}

// ---------- 横向工具栏（Sketch Measure 式）----------
// 单窗口动态伸缩：条高 56，点开抽屉时窗口向下长出抽屉区（顶边固定）
// 显示模式：text = 图标+文字（默认），icon = 仅图标；窗口宽度不同
const STYLE_KEY = 'inkline.barStyle'
const BAR_H = 56
const W = 740 // 两种显示模式的按钮同宽，工具栏等长
const DRAWER_H = {
  mockText: 128,
  mockImg: 96,
  palette: 320,
  slice: 104,
  settings: 112
}

function readBarStyle() {
  try {
    const v = NSUserDefaults.standardUserDefaults().stringForKey_(STYLE_KEY)
    return String(v) === 'icon' ? 'icon' : 'text'
  } catch (e) {
    return 'text'
  }
}

export default function () {
  // 再点一次菜单 = 关闭面板（开关行为）。用 panel-ref 的模块级引用判断，
  // 不走 getWebview（会重建 delegate，是多项静默失效/Obj-C 异常的根源）
  const existing = getPanel()
  if (existing) {
    try { existing.close() } catch (e) { /* ignore */ }
    return
  }

  let barStyle = readBarStyle()

  // 悬浮在 Sketch 主窗口顶部居中（Sketch Measure 式位置）
  // 坐标语义（读库源码确认）：传入 y = 窗口"底边"距屏幕顶的距离，即 y = 目标顶部Y + 窗口高
  const screenH = NSScreen.mainScreen().frame().size.height
  let x = 100
  let topY = 100
  try {
    const main = NSApplication.sharedApplication().mainWindow()
    const f = main.frame()
    const mainTop = screenH - (f.origin.y + f.size.height) // 主窗口顶边的屏幕纵向坐标（自上而下）
    x = f.origin.x + (f.size.width - W) / 2
    topY = mainTop + 80
    // 防止主窗口特别靠上时盖住系统菜单栏
    if (topY < 40) topY = 40
  } catch (e) {
    try {
      const vf = NSScreen.mainScreen().visibleFrame()
      x = vf.origin.x + (vf.size.width - W) / 2
      topY = screenH - (vf.origin.y + vf.size.height) + 80
    } catch (e2) { /* fallback 100 */ }
  }

  let currentDrawer = null
  let browserWindow = null

  // 取当前窗口顶边（自上而下）。用户拖动后坐标会变，必须实时读，不能缓存
  function currentTop() {
    try {
      const b = browserWindow.getBounds() // y = 底边距屏幕顶距离
      return { x: b.x, top: b.y - b.height }
    } catch (e) {
      return { x: x, top: topY }
    }
  }

  // 按"顶边固定"调整窗口尺寸
  function resizeTo(w, h) {
    const c = currentTop()
    try { browserWindow.setSize(w, h, false) } catch (e) { /* ignore */ }
    try { browserWindow.setPosition(Math.round(c.x), Math.round(c.top + h), false) } catch (e) { /* ignore */ }
  }

  // 抽屉开关：伸缩窗口高度（顶边固定），并通知 HTML 切换显示
  function setDrawer(section) {
    if (!browserWindow) return
    currentDrawer = section
    const h = section ? BAR_H + (DRAWER_H[section] || 120) : BAR_H
    resizeTo(W, h)
    try {
      browserWindow.webContents.executeJavaScript('window.__setDrawer(' + JSON.stringify(section) + ')')
    } catch (e) { /* ignore */ }
  }

  // 切换 图标/图标+文字 模式：持久化 + 变更窗口宽度
  function setBarStyle(mode) {
    try {
      NSUserDefaults.standardUserDefaults().setObject_forKey_(mode, STYLE_KEY)
    } catch (e) { /* ignore */ }
    barStyle = mode === 'icon' ? 'icon' : 'text'
    resizeTo(W, currentDrawer ? BAR_H + (DRAWER_H[currentDrawer] || 120) : BAR_H)
    try {
      browserWindow.webContents.executeJavaScript('window.__setBarStyle(' + JSON.stringify(barStyle) + ')')
    } catch (e) { /* ignore */ }
  }

  browserWindow = new BrowserWindow({
    identifier: IDENTIFIER,
    width: W,
    height: BAR_H,
    x: Math.round(x),
    y: Math.round(topY + BAR_H),
    title: 'Inkline · 墨斗',
    frame: false, // 无边框：没有标题栏，纯工具条，可按住空白处随意拖动
    resizable: false,
    movable: true,
    // Sketch Measure 式行为：永远浮在 Sketch 最上面；Sketch 失焦时自动隐藏
    alwaysOnTop: true,
    hidesOnDeactivate: true,
    remembersWindowFrame: false
  })

  const webContents = browserWindow.webContents
  // 保存原始窗口引用：色板等模块向面板推送数据时使用，
  // 严禁改走 getWebview()（会重置 webview delegate 导致 executeJavaScript 静默失效）
  setPanel(browserWindow)

  // ---------- 跟随 Sketch 主窗口 ----------
  // 最小化 Sketch → 面板隐藏；恢复 → 面板回来；
  // 主窗口全关（Sketch 退到后台）→ 面板一并关闭。
  // 库自身 movable-area 也用 setInterval 轮询，插件进程内定时器可用
  const app = NSApplication.sharedApplication()
  const OUR_TITLES = ['Inkline · 墨斗', 'Inkline 图标库', 'Inkline · 自定义词库']
  let hiddenByFollow = false
  const followTimer = setInterval(function () {
    try {
      const main = app.mainWindow()
      if (main) {
        const t = String(main.title() || '')
        if (OUR_TITLES.indexOf(t) !== -1) return // 主窗口是我们自己的窗口，不处理
        if (hiddenByFollow) {
          hiddenByFollow = false
          try { browserWindow.show() } catch (e) { /* ignore */ }
          try { browserWindow.setAlwaysOnTop(true, 'floating', 1) } catch (e) { /* ignore */ }
          try { browserWindow.moveTop() } catch (e) { /* ignore */ }
        }
        return
      }
      // 没有主窗口：有最小化窗口 → 跟随隐藏；一个都没有 → Sketch 已全部关闭 → 关面板
      if (app.miniaturizedWindows().count() > 0) {
        if (!hiddenByFollow) {
          hiddenByFollow = true
          try { browserWindow.hide() } catch (e) { /* ignore */ }
        }
      } else {
        clearInterval(followTimer)
        try { browserWindow.close() } catch (e) { /* ignore */ }
      }
    } catch (e) { /* ignore */ }
  }, 400)

  browserWindow.on('closed', function () {
    clearInterval(followTimer)
    setPanel(null)
  })

  // 面板 → 插件 的通信桥
  webContents.on('close', function () {
    browserWindow.close()
  })
  webContents.on('action', function (name) {
    const fn = ACTIONS[name]
    if (fn) {
      try {
        fn()
      } catch (e) {
        UI.alert('Inkline 出错了', String(e && e.message ? e.message : e))
      }
      // 直接动作（标注/导出等）执行后收起抽屉，避免抽屉挡住画布
      if (name !== 'iconLibrary' && name !== 'help') setDrawer(null)
    }
  })
  webContents.on('run', function (payloadJson) {
    let payload = {}
    try { payload = JSON.parse(payloadJson) } catch (e) { /* ignore */ }
    if (payload.name === 'toggleDrawer') {
      setDrawer(currentDrawer === payload.arg ? null : payload.arg)
      if (payload.arg === 'palette' && currentDrawer === 'palette') requestPalette()
      return
    }
    if (payload.name === 'setBarStyle') {
      setBarStyle(payload.arg)
      return
    }
    try {
      dispatchRun(payloadJson)
      // 分割执行后同样收起抽屉
      if (payload.name === 'slice') setDrawer(null)
    } catch (e) {
      UI.alert('Inkline 出错了', String(e && e.message ? e.message : e))
    }
  })

  browserWindow.once('ready-to-show', function () {
    browserWindow.show()
    // 显式提到浮动层级之上（比默认 floating 更高一级），确保永远浮在 Sketch 主窗口之上
    try { browserWindow.setAlwaysOnTop(true, 'floating', 1) } catch (e) { /* ignore */ }
    try { browserWindow.moveTop() } catch (e) { /* ignore */ }
    // 显示后按同一坐标语义二次定位，防止系统默认位置覆盖
    try { browserWindow.setPosition(Math.round(x), Math.round(topY + BAR_H), false) } catch (e) { /* ignore */ }
    // 应用保存的显示模式
    try {
      browserWindow.webContents.executeJavaScript('window.__setBarStyle(' + JSON.stringify(barStyle) + ')')
    } catch (e) { /* ignore */ }
  })

  browserWindow.loadURL(require('./resources/webview.html'))
}
