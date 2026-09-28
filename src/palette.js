import { getSelectedDocument } from 'sketch'
import { execInPanel, notify } from './panel-ref.js'
import { PREFIX, hex6, normHex } from './util.js'

// 色板管理：文档颜色自动收集 + 我的色板（持久化），点击复制色值
const KEY = 'inkline.palette'

function readMine() {
  try {
    const s = NSUserDefaults.standardUserDefaults().stringForKey_(KEY)
    const arr = s ? JSON.parse(String(s)) : []
    return Array.isArray(arr) ? arr.map(String).slice(0, 100) : []
  } catch (e) {
    return []
  }
}

function saveMine(arr) {
  NSUserDefaults.standardUserDefaults().setObject_forKey_(JSON.stringify(arr), KEY)
}

// 收集当前页面所有图层的颜色（填充/描边/文字），按使用次数排序
function collectDocColors(page) {
  const counts = {}
  function add(c) {
    const h = hex6(c)
    if (h) counts[h] = (counts[h] || 0) + 1
  }
  function walk(layer) {
    if (layer.name && String(layer.name).indexOf(PREFIX) === 0) return // 跳过标注/便签
    try {
      if (layer.type !== 'Artboard' && layer.type !== 'SymbolMaster') {
        layer.style.fills.forEach(function (f) { if (f.enabled !== false && f.fillType === 'Color') add(f.color) })
        layer.style.borders.forEach(function (f) { if (f.enabled !== false && f.fillType === 'Color') add(f.color) })
        if (layer.type === 'Text' && layer.style.textColor) add(layer.style.textColor)
      }
    } catch (e) { /* ignore */ }
    const kids = layer.layers || []
    kids.forEach(walk)
  }
  (page.layers || []).forEach(walk)
  return Object.keys(counts)
    .map(function (c) { return { c: c, n: counts[c] } })
    .sort(function (a, b) { return b.n - a.n })
    .slice(0, 60)
}

function pushToPanel(data) {
  execInPanel('window.__renderPalette(' + JSON.stringify(data) + ')')
}

// 面板打开色板抽屉时请求
export function requestPalette() {
  const doc = getSelectedDocument()
  const docColors = doc ? collectDocColors(doc.selectedPage) : []
  pushToPanel({ doc: docColors, mine: readMine() })
}

// 取图层第一个可用色：填充 → 描边 → 文字色
function firstColorOf(layer) {
  try {
    const f = layer.style.fills.filter(function (x) { return x.enabled !== false && x.fillType === 'Color' })
    if (f.length) return normHex(f[0].color)
    const bd = layer.style.borders.filter(function (x) { return x.enabled !== false && x.fillType === 'Color' })
    if (bd.length) return normHex(bd[0].color)
    if (layer.type === 'Text' && layer.style.textColor) return normHex(layer.style.textColor)
  } catch (e) { /* ignore */ }
  return null
}

// 把选中图层的主色加入我的色板
export function addSelectedColor() {
  const doc = getSelectedDocument()
  if (!doc) return
  const sel = doc.selectedLayers.layers
  if (!sel.length) {
    notify('请先选中一个图层')
    return
  }
  let hex = null
  for (let i = 0; i < sel.length && !hex; i++) {
    hex = firstColorOf(sel[i])
  }
  if (!hex) {
    notify('选中的图层没有可用颜色（填充/描边/文字色）')
    return
  }
  const mine = readMine()
  if (mine.indexOf(hex) > -1) {
    notify(hex + ' 已在色板中')
    return
  }
  mine.unshift(hex)
  saveMine(mine)
  pushToPanel({ doc: collectDocColors(doc.selectedPage), mine: mine })
  notify('已添加 ' + hex + ' 到我的色板 ✅')
}

// 删除我的色板中的颜色
export function removeColor(hex) {
  const h = normHex(String(hex))
  if (!h) return
  const mine = readMine().filter(function (c) { return c !== h })
  saveMine(mine)
  const doc = getSelectedDocument()
  pushToPanel({ doc: doc ? collectDocColors(doc.selectedPage) : [], mine: mine })
  notify('已移除 ' + h)
}

// 复制色值到剪贴板
export function copyColor(hex) {
  const h = normHex(String(hex))
  if (!h) return
  NSPasteboard.generalPasteboard().clearContents()
  NSPasteboard.generalPasteboard().setString_forType_(h, 'public.utf8-plain-text')
  notify('已复制 ' + h + ' ✅')
}
