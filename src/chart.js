import { getSelectedDocument, createLayerFromData, Text, Rectangle, Group } from 'sketch'
import { toast } from './panel-ref.js'
import { isLive } from './util.js'
import { pickTarget } from './iconfont.js'
import { buildChart, previewSvg, normalize, randomRows } from './chartgen.js'
import BrowserWindow from 'sketch-module-web-view'

// 数据窗口：填数据 → 实时预览 → 一键插入画布
// 几何图形走 SVG → createLayerFromData 落成真正的矢量图层；
// 文字（类别/数值/百分比/图例）用原生 Text 图层，插进去还能改字改色。

const SPEC_KEY = 'inkline.chartSpec'
const WIN_W = 700
const WIN_H = 600

const DEFAULT_SPEC = {
  type: 'bar',
  orient: 'v',
  radius: 4,
  showValue: true,
  showGrid: true,
  colorMode: 'mono',
  showPct: true,
  showLegend: true,
  w: 480,
  h: 320,
  dia: 100,
  ring: 0,
  strokeWidth: 0,
  rows: [
    { name: '一月', value: 120 },
    { name: '二月', value: 200 },
    { name: '三月', value: 150 },
    { name: '四月', value: 80 }
  ]
}

function readSpec() {
  try {
    const s = NSUserDefaults.standardUserDefaults().stringForKey_(SPEC_KEY)
    if (s) {
      const o = JSON.parse(String(s))
      if (o && Array.isArray(o.rows) && o.rows.length) {
        return Object.assign({}, DEFAULT_SPEC, {
          type: o.type === 'pie' ? 'pie' : o.type === 'line' ? 'line' : 'bar',
          orient: o.orient === 'h' ? 'h' : 'v',
          radius: Number(o.radius) || 0,
          showValue: o.showValue !== false,
          showGrid: o.showGrid !== false,
          colorMode: o.colorMode === 'multi' ? 'multi' : 'mono',
          showPct: o.showPct !== false,
          showLegend: o.showLegend !== false,
          w: Number(o.w) || 480,
          h: Number(o.h) || 320,
          dia: Number(o.dia) || 100,
          // 环宽/描边不记忆：每次打开面板都归零（用户约定）
          ring: 0,
          strokeWidth: 0,
          rows: o.rows
        })
      }
    }
  } catch (e) { /* ignore */ }
  return JSON.parse(JSON.stringify(DEFAULT_SPEC))
}

function saveSpec(spec) {
  try {
    NSUserDefaults.standardUserDefaults().setObject_forKey_(JSON.stringify(spec), SPEC_KEY)
  } catch (e) { /* ignore */ }
}

// 原生文字图层：位置对齐 chartgen 的「锚点即中心」约定
function mkLabel(parent, item, ox, oy, name) {
  const size = item.size || 11
  let t
  try {
    t = new Text({ parent: parent, text: String(item.s) })
  } catch (e) {
    t = new Text({ parent: parent })
  }
  try { t.text = String(item.s) } catch (e) { /* ignore */ }
  t.style.fontFamily = 'PingFang SC'
  t.style.fontSize = size
  t.style.textColor = item.c
  t.name = name || '文本'
  let w = 0
  let h = Math.ceil(size * 1.5)
  try {
    t.adjustToFit()
    w = t.frame.width
    h = t.frame.height // 行高实测：mid 锚点用它的一半做垂直居中，才与几何精确对齐
  } catch (e) { /* ignore */ }
  if (!w || w <= 0) {
    let est = 0
    for (const ch of String(item.s)) est += ch.charCodeAt(0) > 255 ? size : size * 0.62
    w = Math.ceil(est) + 4
    t.frame = new Rectangle(0, 0, w, h)
  }
  let x = ox + item.x
  if (item.a === 'middle') x -= w / 2
  else if (item.a === 'end') x -= w
  t.frame.x = Math.round(x)
  t.frame.y = Math.round(oy + item.y - (item.mid ? h / 2 : 0))
  return t
}

function insertChart(payload) {
  let raw = null
  try {
    raw = typeof payload === 'string' ? JSON.parse(payload) : payload
  } catch (e) { /* ignore */ }
  if (!raw) {
    toast('图表数据解析失败')
    return
  }
  const doc = getSelectedDocument()
  if (!doc) {
    toast('请先打开一个文档')
    return
  }

  const sp = normalize(raw)
  saveSpec(raw) // 记住这次的数据与样式

  let built
  try {
    built = buildChart(sp)
  } catch (e) {
    toast('图表生成失败：' + (e.message || ''))
    return
  }

  const t = pickTarget(doc)
  const host = t.host

  // 落点：镜头处（页面绝对坐标转宿主局部）或宿主中心
  let cx, cy
  if (t.pt) {
    const isBoard = host.type === 'Artboard' || host.type === 'Frame'
    cx = isBoard ? t.pt.x - host.frame.x : t.pt.x
    cy = isBoard ? t.pt.y - host.frame.y : t.pt.y
  } else if (host.type === 'Artboard' || host.type === 'Frame') {
    cx = host.frame.width / 2
    cy = host.frame.height / 2
  } else {
    cx = 260
    cy = 200
  }
  const gx = Math.round(cx - built.w / 2)
  const gy = Math.round(cy - built.h / 2)

  // SVG → 矢量图层。图形与图例是两份同尺寸画布，坐标天然对齐，
  // 所以导入后都钉同一个 frame 即可（这里再钉一次防止导入缩放）。
  function placeSvg(svg, name) {
    const l = createLayerFromData(svg, 'svg')
    l.parent = host
    try { l.name = name } catch (e) { /* ignore */ }
    try {
      l.frame = new Rectangle(gx, gy, built.w, built.h)
    } catch (e) { /* ignore */ }
    return l
  }

  let geoMain
  try {
    geoMain = placeSvg(built.svg, '图形')
  } catch (e) {
    toast('图表图形解析失败：' + (e.message || ''))
    return
  }

  // 数据图 = 几何 + 类别/数值/百分比标签
  const mainLabels = []
  ;(built.labels || []).forEach(function (item) {
    try {
      mainLabels.push(mkLabel(host, item, gx, gy, '文本'))
    } catch (e) { /* 单个标签失败不影响整体 */ }
  })

  const parts = []
  try {
    const gData = new Group({ parent: host, layers: [geoMain].concat(mainLabels) })
    gData.name = '数据图'
    parts.push(gData)
  } catch (e) {
    toast('图表分组失败')
    return
  }

  // 图例独立编组（色块 + 文字）：可整组拖动 / 隐藏 / 删除，不牵动数据图
  if (built.legendSvg) {
    try {
      const geoLegend = placeSvg(built.legendSvg, '色块')
      const legendLabels = []
      ;(built.legendLabels || []).forEach(function (item) {
        try {
          legendLabels.push(mkLabel(host, item, gx, gy, '图例文字'))
        } catch (e) { /* ignore */ }
      })
      const gLegend = new Group({ parent: host, layers: [geoLegend].concat(legendLabels) })
      gLegend.name = '图例'
      parts.push(gLegend)
    } catch (e) { /* 图例失败不影响数据图 */ }
  }

  let g
  try {
    g = new Group({ parent: host, layers: parts })
  } catch (e) {
    toast('图表分组失败')
    return
  }
  g.name = '图表 · ' + (sp.type === 'pie' ? '饼图' : sp.type === 'line' ? '折线图' : '柱状图')

  try { doc.selectedLayers.layers = [g] } catch (e) { /* ignore */ }
  try { doc.centerOnLayer(g) } catch (e) { /* ignore */ }
  toast(g.name + ' 已插入 ✅')
}

// ---------------- 数据窗口 ----------------

// 模块级窗口引用（铁律：严禁 getWebview 反查；identifier 每次唯一避免僵尸窗口）
let chartWin = null
let chartSeq = 0

export function openCharts() {
  const doc = getSelectedDocument()
  if (!doc) {
    toast('请先打开一个文档')
    return
  }
  if (chartWin) {
    if (isLive(chartWin)) {
      try { chartWin.show() } catch (e) { /* ignore */ }
      return
    }
    chartWin = null // 僵尸引用：丢弃重建
  }

  const win = new BrowserWindow({
    // v2：v1 的 remembersWindowFrame 记住了过高的旧窗口框，换 ID 强制重置
    identifier: 'inkline.chart.v2.' + (++chartSeq),
    width: WIN_W,
    height: WIN_H,
    minWidth: 620,
    minHeight: 480,
    resizable: true,
    movable: true,
    title: '墨斗·Inkline · 数据图表',
    alwaysOnTop: true,
    hidesOnDeactivate: true,
    remembersWindowFrame: true
  })
  chartWin = win
  win.on('closed', function () {
    if (chartWin === win) chartWin = null
  })

  const wc = win.webContents
  wc.on('requestChartSpec', function () {
    try {
      wc.executeJavaScript('window.__setSpec(' + JSON.stringify(readSpec()) + ')')
    } catch (e) { /* ignore */ }
  })
  // 预览：算出来直接回传，窗口只负责显示（所见即所得的唯一来源）
  wc.on('chartPreview', function (payload) {
    let raw = null
    try { raw = JSON.parse(String(payload)) } catch (e) { /* ignore */ }
    if (!raw) return
    let svg = ''
    try {
      svg = previewSvg(buildChart(raw))
    } catch (e) {
      svg = ''
    }
    try {
      wc.executeJavaScript('window.__setPreview(' + JSON.stringify(svg) + ')')
    } catch (e) { /* ignore */ }
  })
  wc.on('chartInsert', function (payload) {
    try {
      insertChart(payload)
    } catch (e) {
      toast('插入失败：' + (e && e.message ? e.message : e))
    }
  })
  wc.on('chartRandom', function () {
    try {
      wc.executeJavaScript('window.__setRows(' + JSON.stringify(randomRows(5)) + ')')
    } catch (e) { /* ignore */ }
  })
  wc.on('close', function () {
    try { win.close() } catch (e) { /* ignore */ }
  })

  win.once('ready-to-show', function () {
    win.show()
    try { win.setAlwaysOnTop(true, 'floating', 1) } catch (e) { /* ignore */ }
  })
  win.loadURL(require('./resources/chart.html'))
}
