import { getSelectedDocument, Text, ShapePath, Rectangle, Group } from 'sketch'
import { toast } from './panel-ref.js'
import { PREFIX, absRect } from './util.js'

const C_SIZE = '#E24B4AFF' // 尺寸：红
const C_SP = '#185FA5FF' // 间距：蓝
const C_PROP = '#6B21A8FF' // 属性：紫
const NOTE_BG = '#FFF3B0' // 便签黄
const NOTE_BORDER = '#E8C558'
const NOTE_TEXT = '#7A5C00'

function mkText(page, str, x, y, color, fontSize) {
  const strVal = String(str)
  let t
  try {
    t = new Text({ parent: page, text: strVal })
  } catch (e) {
    t = new Text({ parent: page })
  }
  // 显式赋值：Sketch 2026 构造参数可能不生效，导致空文本
  try { t.text = strVal } catch (e) { /* ignore */ }
  t.style.fontFamily = 'PingFang SC'
  t.style.fontSize = fontSize || 11
  t.style.textColor = color
  t.name = PREFIX + 'label'
  let fitted = false
  try {
    t.adjustToFit()
    fitted = t.frame.width > 0 && t.frame.height > 0
  } catch (e) { /* ignore */ }
  if (!fitted) {
    // 兜底：按字符数估算宽高
    const fs = fontSize || 11
    let maxLen = 0
    strVal.split('\n').forEach(function (line) {
      let w = 0
      for (const ch of line) w += ch.charCodeAt(0) > 255 ? fs : fs * 0.6
      if (w > maxLen) maxLen = w
    })
    const lineCount = strVal.split('\n').length
    t.frame = new Rectangle(x, y, Math.ceil(maxLen) + 8, Math.ceil(lineCount * fs * 1.5))
  }
  t.frame.x = x
  t.frame.y = y
  return t
}

function mkTextCenter(page, str, cx, y, color, fontSize) {
  const t = mkText(page, str, cx, y, color, fontSize)
  t.frame.x = cx - t.frame.width / 2
  return t
}

function mkTextCenterY(page, str, x, cy, color, fontSize) {
  const t = mkText(page, str, x, cy, color, fontSize)
  t.frame.y = cy - t.frame.height / 2
  return t
}

// 带描边的白底卡片（属性标注用）
function mkPropCard(page, lines, x, y) {
  const t = mkText(page, lines.join('\n'), x, y, C_PROP, 11)
  const pad = 6
  const card = new ShapePath({
    parent: page,
    frame: new Rectangle(x - pad, y - pad, t.frame.width + pad * 2, t.frame.height + pad * 2),
    style: {
      fills: [{ color: '#6B21A81A' }], // 紫 10% 透明底
      borders: [{ color: C_PROP, thickness: 1 }]
    }
  })
  card.name = PREFIX + 'card'
  t.moveToFront() // 文字保持在卡片上层
  return [card, t]
}

function mkLine(page, x, y, w, h, color) {
  const s = new ShapePath({
    parent: page,
    frame: new Rectangle(x, y, Math.max(w, 0.5), Math.max(h, 0.5)),
    style: { fills: [{ color: color }], borders: [] }
  })
  s.name = PREFIX + 'line'
  return s
}

function getSel() {
  const doc = getSelectedDocument()
  if (!doc) return { sel: [], page: null }
  return { sel: doc.selectedLayers.layers, page: doc.selectedPage }
}

// ---------- 标注宽度 / 标注高度（由原"标注尺寸"拆分） ----------
function checkSel(sel, page) {
  if (!page) return false
  if (!sel.length) {
    toast('请先选择要标注的图层')
    return false
  }
  return true
}

export function markWidths() {
  const { sel, page } = getSel()
  if (!checkSel(sel, page)) return
  const anns = []
  sel.forEach(function (layer) {
    const r = absRect(layer)
    // 宽度（图层下方水平标注线）
    const y = r.y + r.h + 8
    anns.push(mkLine(page, r.x, y, r.w, 1, C_SIZE))
    anns.push(mkLine(page, r.x, y - 4, 1, 9, C_SIZE))
    anns.push(mkLine(page, r.x + r.w - 1, y - 4, 1, 9, C_SIZE))
    anns.push(mkTextCenter(page, Math.round(r.w), r.x + r.w / 2, y + 5, C_SIZE))
  })
  const g = new Group({ parent: page, layers: anns })
  g.name = PREFIX + '标注-宽度'
  toast('已标注 ' + sel.length + ' 个图层的宽度')
}

export function markHeights() {
  const { sel, page } = getSel()
  if (!checkSel(sel, page)) return
  const anns = []
  sel.forEach(function (layer) {
    const r = absRect(layer)
    // 高度（图层右侧垂直标注线）
    const x = r.x + r.w + 8
    anns.push(mkLine(page, x, r.y, 1, r.h, C_SIZE))
    anns.push(mkLine(page, x - 4, r.y, 9, 1, C_SIZE))
    anns.push(mkLine(page, x - 4, r.y + r.h - 1, 9, 1, C_SIZE))
    anns.push(mkTextCenterY(page, Math.round(r.h), x + 5, r.y + r.h / 2, C_SIZE))
  })
  const g = new Group({ parent: page, layers: anns })
  g.name = PREFIX + '标注-高度'
  toast('已标注 ' + sel.length + ' 个图层的高度')
}

// ---------- 标注间距 ----------
export function markSpacings() {
  const { sel, page } = getSel()
  if (!page) return
  if (!sel.length) {
    toast('请选择图层：选 1 个标注到画板边缘，选 2 个标注两者间距')
    return
  }
  const anns = []

  if (sel.length === 1) {
    // 单图层：标注到画板四边的距离
    let art = sel[0].parent
    while (art && art.type !== 'Artboard' && art.type !== 'SymbolMaster') art = art.parent
    if (!art || (art.type !== 'Artboard' && art.type !== 'SymbolMaster')) {
      toast('该图层不在画板内；请改选 2 个图层来标注间距')
      return
    }
    const ar = absRect(art)
    const r = absRect(sel[0])
    const cx = r.x + r.w / 2
    const cy = r.y + r.h / 2
    // 左、右（水平线，图层垂直居中）
    const sides = [
      { x1: ar.x, x2: r.x, y: cy, v: Math.round(r.x - ar.x) },
      { x1: r.x + r.w, x2: ar.x + ar.w, y: cy, v: Math.round(ar.x + ar.w - r.x - r.w) }
    ]
    sides.forEach(function (s) {
      if (s.x2 - s.x1 < 1) return
      anns.push(mkLine(page, s.x1, s.y, s.x2 - s.x1, 1, C_SP))
      anns.push(mkTextCenter(page, s.v, (s.x1 + s.x2) / 2, s.y + 5, C_SP))
    })
    // 上、下（垂直线，图层水平居中）
    const vs = [
      { y1: ar.y, y2: r.y, x: cx, v: Math.round(r.y - ar.y) },
      { y1: r.y + r.h, y2: ar.y + ar.h, x: cx, v: Math.round(ar.y + ar.h - r.y - r.h) }
    ]
    vs.forEach(function (s) {
      if (s.y2 - s.y1 < 1) return
      anns.push(mkLine(page, s.x, s.y1, 1, s.y2 - s.y1, C_SP))
      anns.push(mkTextCenterY(page, s.v, s.x + 5, (s.y1 + s.y2) / 2, C_SP))
    })
  } else {
    // 两两标注间距
    for (let i = 0; i < sel.length - 1; i++) {
      const a = absRect(sel[i])
      const b = absRect(sel[i + 1])
      const hgap = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w))
      const vOverlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
      const vgap = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h))
      const hOverlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
      if (hgap >= 0 && vOverlap > 0) {
        // 水平间距
        const x1 = Math.min(a.x + a.w, b.x + b.w)
        const x2 = Math.max(a.x, b.x)
        const y = (Math.max(a.y, b.y) + Math.min(a.y + a.h, b.y + b.h)) / 2
        anns.push(mkLine(page, x1, y, x2 - x1, 1, C_SP))
        anns.push(mkTextCenter(page, Math.round(hgap), (x1 + x2) / 2, y + 5, C_SP))
      } else if (vgap >= 0 && hOverlap > 0) {
        // 垂直间距
        const y1 = Math.min(a.y + a.h, b.y + b.h)
        const y2 = Math.max(a.y, b.y)
        const x = (Math.max(a.x, b.x) + Math.min(a.x + a.w, b.x + b.w)) / 2
        anns.push(mkLine(page, x, y1, 1, y2 - y1, C_SP))
        anns.push(mkTextCenterY(page, Math.round(vgap), x + 5, (y1 + y2) / 2, C_SP))
      } else {
        // 不相邻：标注 dx/dy
        const dx = Math.round(Math.abs(a.x - b.x))
        const dy = Math.round(Math.abs(a.y - b.y))
        anns.push(mkText(page, 'dx ' + dx + ' · dy ' + dy, Math.max(a.x, b.x), Math.max(a.y, b.y), C_SP))
      }
    }
  }
  const g = new Group({ parent: page, layers: anns })
  g.name = PREFIX + '标注-间距'
  toast('已标注间距')
}

// ---------- 标注属性 ----------
export function markProperties() {
  const { sel, page } = getSel()
  if (!page) return
  if (!sel.length) {
    toast('请先选择要标注属性的图层')
    return
  }
  const anns = []
  sel.forEach(function (layer) {
    const r = absRect(layer)
    const st = layer.style
    const lines = [layer.name, Math.round(r.w) + ' × ' + Math.round(r.h)]
    try {
      const fills = st.fills
        .filter(function (f) { return f.enabled !== false && f.fillType === 'Color' })
        .map(function (f) { return f.color.slice(0, 7) })
      if (fills.length) lines.push('填充 ' + fills.join(' '))
      const borders = st.borders
        .filter(function (f) { return f.enabled !== false && f.fillType === 'Color' })
        .map(function (f) { return f.color.slice(0, 7) })
      if (borders.length) lines.push('描边 ' + borders.join(' '))
      if (st.opacity < 1) lines.push('透明度 ' + Math.round(st.opacity * 100) + '%')
      if (layer.type === 'Text') {
        lines.push((st.fontFamily || '') + ' ' + (st.fontSize || '') + 'px')
        if (st.lineHeight) lines.push('行高 ' + st.lineHeight)
        if (st.textColor) lines.push('颜色 ' + String(st.textColor).slice(0, 7))
      }
      try {
        // 圆角：优先读官方 points，失败再试底层 API
        let cr = 0
        if (layer.points && layer.points.length) {
          layer.points.forEach(function (pt) { if (pt.cornerRadius > cr) cr = pt.cornerRadius })
        } else {
          cr = layer.sketchObject.cornerRadius()
        }
        if (cr && cr > 0) lines.push('圆角 ' + Math.round(cr))
      } catch (e) { /* 该图层类型没有圆角属性 */ }
    } catch (e) { /* 忽略单图层属性读取失败 */ }
    mkPropCard(page, lines, r.x + r.w + 10, r.y).forEach(function (l) { anns.push(l) })
  })
  const g = new Group({ parent: page, layers: anns })
  g.name = PREFIX + '标注-属性'
  toast('已标注 ' + sel.length + ' 个图层的属性')
}

// ---------- 清除标注 ----------
export function clearMarks() {
  const { page } = getSel()
  if (!page) return
  let n = 0
  page.layers.slice().forEach(function (l) {
    if (l.name.indexOf(PREFIX) === 0) {
      l.remove()
      n++
    }
  })
  toast(n ? '已清除 ' + n + ' 组标注/便签' : '当前页面没有标注')
}

// ---------- 注释便签 ----------
// 在选中图层右侧生成 Kitchen 式黄色便签，双击文字即可编辑
export function addNote() {
  const doc = getSelectedDocument()
  if (!doc) {
    toast('请先打开一个文档')
    return
  }
  const page = doc.selectedPage
  const sel = doc.selectedLayers.layers

  // 位置：选中图层右侧偏移；无选中时放到第一个画板右侧或页面原点附近
  let x = 100
  let y = 100
  if (sel.length) {
    const r = absRect(sel[0])
    x = r.x + r.w + 16
    y = r.y
  } else {
    // Sketch 2026 已移除 page.artboards，改用 page.layers 过滤
    const boards = (page.layers || []).filter(function (l) {
      return l.type === 'Artboard' || l.type === 'Frame'
    })
    if (boards.length) {
      const a = absRect(boards[0])
      x = a.x + a.w + 40
      y = a.y
    }
  }

  const NOTE_W = 160
  const NOTE_H = 110
  const bg = new ShapePath({
    parent: page,
    frame: new Rectangle(x, y, NOTE_W, NOTE_H),
    style: {
      fills: [{ color: NOTE_BG + 'F5' }],
      borders: [{ color: NOTE_BORDER + 'FF', thickness: 1 }]
    }
  })
  bg.name = PREFIX + 'note-bg'
  try {
    bg.points.forEach(function (pt) { pt.cornerRadius = 6 })
  } catch (e) { /* 圆角失败不影响使用 */ }

  // 便签标题行（小圆点 + "注释"）+ 正文占位
  const title = mkText(page, '注释', x + 10, y + 8, NOTE_TEXT + 'FF', 10)
  try { title.style.fontWeight = 6 } catch (e) { /* ignore */ }
  const body = mkText(page, '双击编辑注释…', x + 10, y + 26, NOTE_TEXT + 'CC', 11)
  try { body.style.lineHeight = 18 } catch (e) { /* ignore */ }

  const g = new Group({ parent: page, layers: [bg, title, body] })
  g.name = PREFIX + '便签'
  toast('已添加便签，双击文字即可编辑 ✅')
}
