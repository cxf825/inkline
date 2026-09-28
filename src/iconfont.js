import { getSelectedDocument, Rectangle, UI } from 'sketch'
import { toast } from './panel-ref.js'
import { createLayerFromData } from 'sketch'
import BrowserWindow from 'sketch-module-web-view'

const PANEL_ID = 'inkline.icons.v1'

// Kitchen 式图标库：独立窗口 + 搜索网格 + 点击/拖拽使用
// 图源：Iconify（免登录，CORS 开放，搜索与 SVG 均在面板网页内 fetch，
// 不经过插件侧 Obj-C 网络调用）。iconfont 账号登录版（关联我的项目/收藏）列 P1。

// 模块级窗口引用：开关切换用。严禁用 getWebview(identifier) 查找——
// 它会重建 NavigationDelegate，在 Sketch 2026 上直接抛 Obj-C 异常
let iconWin = null

export function openIconLibrary() {
  if (iconWin) {
    // 再点一次图标按钮 = 关闭图标库
    try { iconWin.close() } catch (e) { /* ignore */ }
    iconWin = null
    return
  }

  const browserWindow = new BrowserWindow({
    identifier: PANEL_ID,
    width: 480,
    height: 640,
    minWidth: 380,
    minHeight: 480,
    title: 'Inkline 图标库',
    resizable: true,
    movable: true,
    // Kitchen 式：悬浮于 Sketch 之上，Sketch 失焦自动隐藏
    alwaysOnTop: true,
    hidesOnDeactivate: true,
    remembersWindowFrame: true
  })
  iconWin = browserWindow

  browserWindow.on('closed', function () {
    if (iconWin === browserWindow) iconWin = null
  })

  const webContents = browserWindow.webContents
  webContents.on('insertIcon', function (payload) {
    try {
      insertSvg(payload)
    } catch (e) {
      UI.alert('Inkline 出错了', String(e && e.message ? e.message : e))
    }
  })

  browserWindow.once('ready-to-show', function () {
    browserWindow.show()
    // 提到浮动层级最高，确保盖过 Inkline 工具栏（否则会被工具栏挡住）
    try { browserWindow.setAlwaysOnTop(true, 'floating', 1) } catch (e) { /* ignore */ }
    try { browserWindow.moveTop() } catch (e) { /* ignore */ }
  })

  browserWindow.loadURL(require('./resources/icons.html'))
}

// 面板 → 插件：把 SVG 字符串画入当前文档
// payload: JSON 字符串 { svg, name }
function insertSvg(payload) {
  let data
  try {
    data = typeof payload === 'string' ? JSON.parse(payload) : payload
  } catch (e) {
    toast('图标数据解析失败')
    return
  }
  const svg = String(data.svg || '')
    .split('currentColor').join('#1F1F1F') // Sketch 不解析 CSS currentColor，替换为固定色
  if (svg.indexOf('<svg') === -1) {
    toast('图标数据无效，请重试')
    return
  }
  const doc = getSelectedDocument()
  if (!doc) {
    toast('请先打开一个文档')
    return
  }

  let layer
  try {
    layer = createLayerFromData(svg, 'svg')
  } catch (e) {
    toast('图标解析失败：' + (e.message || ''))
    return
  }

  // 插入位置：优先当前选中图层所在画板中心，其次第一个画板中心，最后页面原点附近
  const sel = doc.selectedLayers.layers
  let host = doc.selectedPage
  let cx = 120
  let cy = 120
  try {
    const ab = sel.length && sel[0].getParentArtboard ? sel[0].getParentArtboard() : null
    if (ab) {
      host = ab
      cx = ab.frame.width / 2
      cy = ab.frame.height / 2
    } else {
      // Sketch 2026 已移除 page.artboards，改用 page.layers 过滤
      const boards = (doc.selectedPage.layers || []).filter(function (l) {
        return l.type === 'Artboard' || l.type === 'Frame'
      })
      if (boards.length) {
        host = boards[0]
        cx = boards[0].frame.width / 2
        cy = boards[0].frame.height / 2
      }
    }
  } catch (e) { /* 默认插入页面原点附近 */ }

  layer.parent = host
  // SVG 以 64px 高度抓取，按用户选择的插入尺寸等比缩放
  let w = layer.frame.width
  let h = layer.frame.height
  const target = Number(data.size) || 0
  if (target > 0 && h > 0) {
    const ratio = target / h
    w = w * ratio
    h = target
  }
  layer.frame = new Rectangle(Math.round(cx - w / 2), Math.round(cy - h / 2), Math.round(w), Math.round(h))
  layer.name = 'icon-' + String(data.name || 'svg')
  toast('图标已插入画布 ✅')
}
