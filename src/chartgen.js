// 图表的几何 + 标签计算（纯函数模块，不依赖 Sketch API）
//
// 为什么单独一个模块：窗口里的「预览」和画布上的「插入」必须是同一份结果。
// 插件侧把这里算出来的 SVG 直接回传给窗口渲染预览，插入时用同一份几何
// 交给 createLayerFromData，标签则换成原生文字图层 —— 两边不会漂。
//
// 标签定位约定：所有标签都以「锚点即文字中心」定位（mid=true）。
//   预览：dominant-baseline="middle"
//   插件：frame.y = y - 实测行高/2（adjustToFit() 量出来，不能用字号估算）
// 这样浏览器预览与 Sketch 内的视觉位置一致。
//
// 留白约定（v0.5.21）：画布四周最小留白统一 PAD=8；图形本体的左右内边距
// 全部按「刻度数字 / 数值标签 / 类别文字」的实测宽度算出来，两边紧贴文字，
// 不再写死 46 / 30 / 26 / 38 这类魔数。

// 内置 8 色多彩（用户选定）；柱状图默认走品牌蓝单色
export const PALETTE = [
  '#3868E6', '#12B5A5', '#F2A03D', '#8B5CF6',
  '#E2506B', '#2FA84F', '#0EA5E9', '#F0641E'
]
export const MONO = '#3868E6'

const C_LABEL = '#666666' // 类别 / 数值
const C_TICK = '#9A958A' // 坐标刻度
const C_GRID = '#EFECE4' // 网格线
const C_AXIS = '#D8D4C8' // 坐标轴
const C_LEGEND = '#4A4A4A' // 图例文字
const C_DARK = '#2B2B2B'

// ---------- 小工具 ----------

function n1(v) {
  return Math.round(v * 10) / 10
}

function n2(v) {
  return Math.round(v * 100) / 100
}

function clamp(v, lo, hi, dflt) {
  if (!isFinite(v)) return dflt
  return Math.min(hi, Math.max(lo, v))
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// 数值展示：整数不带小数点，小数最多 1 位
export function fmtVal(v) {
  const n = Number(v) || 0
  return Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1)
}

// 刻度上限取整到 1 / 2 / 2.5 / 5 / 10 × 10^n
export function niceCeil(v) {
  if (!(v > 0)) return 1
  const exp = Math.floor(Math.log10(v))
  const base = Math.pow(10, exp)
  const f = v / base
  let m
  if (f <= 1) m = 1
  else if (f <= 2) m = 2
  else if (f <= 2.5) m = 2.5
  else if (f <= 5) m = 5
  else m = 10
  return m * base
}

// 相对亮度（0~1）：决定饼图百分比标签用白字还是深字
function lum(hex) {
  const h = String(hex).replace('#', '')
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function wrap(w, h, parts) {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h +
    '" viewBox="0 0 ' + w + ' ' + h + '">' + parts.join('') + '</svg>'
}

// ---------- 数据规整 ----------

export function normRows(rows) {
  const out = []
  ;(Array.isArray(rows) ? rows : []).forEach(function (r, i) {
    let name = String((r && r.name) != null ? r.name : '').trim()
    if (!name) name = '类别' + (i + 1)
    if (name.length > 12) name = name.slice(0, 12)
    let v = Number(r && r.value)
    if (!isFinite(v) || v < 0) v = 0
    out.push({ name: name, value: v })
  })
  if (!out.length) {
    out.push({ name: '一月', value: 120 })
    out.push({ name: '二月', value: 200 })
    out.push({ name: '三月', value: 150 })
    out.push({ name: '四月', value: 80 })
  }
  return out
}

export function normalize(spec) {
  const s = spec || {}
  return {
    type: s.type === 'pie' ? 'pie' : s.type === 'line' ? 'line' : 'bar',
    orient: s.orient === 'h' ? 'h' : 'v',
    radius: clamp(Number(s.radius), 0, 14, 4),
    showValue: s.showValue !== false,
    showGrid: s.showGrid !== false,
    colorMode: s.colorMode === 'multi' ? 'multi' : 'mono',
    showPct: s.showPct !== false,
    showLegend: s.showLegend !== false,
    // 尺寸全部指「图形本体」，不含图例（图例固定在右侧 40pt 间距的独立列）
    w: clamp(Number(s.w), 100, 2000, 480), // 柱状图/折线图本体宽
    h: clamp(Number(s.h), 80, 1500, 320), // 柱状图/折线图本体高
    dia: clamp(Number(s.dia), 24, 1000, 100), // 饼图直径
    ring: clamp(Number(s.ring), 0, 1000, 0), // 环形内径 = 环的宽度（0 = 实心）
    strokeWidth: clamp(Number(s.strokeWidth), 0, 8, 0), // 描边粗细（0 = 无描边，>0 白色）
    rows: normRows(s.rows)
  }
}

// ---------- 留白与间距（v0.5.21：按文字实测收紧） ----------

const PAD = 8 // 画布四周最小留白
const AXIS_GAP = 8 // 刻度/类别文字与轴线的水平间距
const LBL_SIZE = 11 // 类别文字
const LEGEND_SIZE = 10 // 图例文字（用户定：10pt）
const NUM_SIZE = 10 // 数值 / 刻度文字
const TEXT_HH = 0.85 // 文字半高 ≈ 0.85 × 字号（PingFang SC 实测）

// 估算文字宽：按 PingFang SC 实测标定
//   CJK = 1em、数字 = 0.6em、空格 = 0.24em、. , : = 0.28em、其它 ASCII = 0.62em
// （旧的「一律 0.62em」把数字和空格都高估，导致图例列与左留白各多出约 10pt）
function textW(s, size) {
  let w = 0
  const str = String(s)
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    if (c > 255) w += size
    else if (c === 32) w += size * 0.24
    else if (c === 46 || c === 44 || c === 58) w += size * 0.28
    else if (c >= 48 && c <= 57) w += size * 0.6
    else w += size * 0.62
  }
  return w
}

// 刻度数字最宽（决定左留白）
function tickWidth(top, ticks) {
  let m = 0
  for (let i = 0; i <= ticks; i++) {
    m = Math.max(m, textW(fmtVal((top * i) / ticks), NUM_SIZE))
  }
  return m
}

// 数值标签最宽（决定右留白：竖向标签居中，只用半宽；横向标签右对齐，用全宽）
function valueWidth(rows, on) {
  let m = 0
  if (on) {
    rows.forEach(function (r) { m = Math.max(m, textW(fmtVal(r.value), NUM_SIZE)) })
  }
  return m
}

// 类别文字最宽（横向柱状图左留白）
function nameWidth(rows) {
  let m = 0
  rows.forEach(function (r) { m = Math.max(m, textW(r.name, LBL_SIZE)) })
  return m
}

// ---------- 图例（三种图共用：右侧一列，画布内垂直居中） ----------
//
// 图例的色块（几何）与文字在画布里是「独立分组」的一部分：
// 插入 Sketch 时不是塞进数据图的图层里，而是单独编成「图例」组，
// 用户可以整组拖动 / 隐藏 / 删除，不会牵动数据图。见 chart.js insertChart。

const LEGEND_MARK = 10 // 色块边长
const LEGEND_MARK_GAP = 8 // 色块 ↔ 文字

function legendCol(rows, monoColor, lx, H) {
  const geo = []
  const labels = []
  const n = rows.length
  const y0 = Math.round((H - n * 24) / 2)
  rows.forEach(function (r, i) {
    const col = monoColor || PALETTE[i % PALETTE.length]
    const ly = y0 + i * 24
    geo.push('<rect x="' + lx + '" y="' + ly + '" width="' + LEGEND_MARK + '" height="' + LEGEND_MARK +
      '" rx="2" fill="' + col + '"/>')
    labels.push({
      s: r.name + '  ' + fmtVal(r.value),
      x: lx + LEGEND_MARK + LEGEND_MARK_GAP,
      y: ly + 5,
      a: 'start',
      mid: true,
      size: LEGEND_SIZE,
      c: C_LEGEND
    })
  })
  return { geo: geo, labels: labels }
}

// 图例列总宽：色块 10 + 间距 8 + 最长文字 + 4 估算缓冲（画布右留白另加 PAD）
function legendWidth(rows) {
  let m = 0
  rows.forEach(function (r) {
    m = Math.max(m, textW(r.name + '  ' + fmtVal(r.value), LEGEND_SIZE))
  })
  return LEGEND_MARK + LEGEND_MARK_GAP + Math.ceil(m) + 4
}
// 图形本体与图例列的间距（用户定：40pt）
const LEGEND_GAP = 40

// ---------- 柱状图 ----------

function buildBar(sp) {
  const H = sp.h
  // 绘图区固定在基础画布内，图例永远是右侧独立列（不与图形争地盘）
  const plotW = sp.w
  const ticks = 4
  const rows = sp.rows
  const lgW = sp.showLegend ? legendWidth(rows) : 0
  const W = plotW + (lgW ? LEGEND_GAP + lgW + PAD : 0)
  const maxV = Math.max.apply(null, rows.map(function (r) { return r.value }).concat([1]))
  const top = niceCeil(maxV)
  const multi = sp.colorMode === 'multi'
  const geo = []
  const labels = []

  // 内边距全部按文字实测（v0.5.21）：
  //   竖向：左 = 刻度数字实测宽、右 = 数值标签半宽、上 = 数值标签文字高、下 = 类别文字高
  //   横向：左 = 类别文字实测宽（长名字不再出画布）、右 = 数值标签全宽、上 = 贴边、下 = 刻度文字高
  const tickW = tickWidth(top, ticks)
  const valW = valueWidth(rows, sp.showValue)
  const textHalf = Math.ceil(TEXT_HH * NUM_SIZE)
  const catHalf = Math.ceil(TEXT_HH * LBL_SIZE)
  let pl, pr, pt, pb
  if (sp.orient === 'h') {
    pl = PAD + Math.ceil(nameWidth(rows)) + AXIS_GAP
    pr = sp.showValue ? PAD + AXIS_GAP + Math.ceil(valW) : PAD
    pt = PAD
    pb = 15 + textHalf + PAD // 底部刻度值中心在 axisY + 15
  } else {
    pl = PAD + Math.ceil(tickW) + AXIS_GAP
    pr = PAD + Math.ceil(valW / 2) + 2 // +2：居中标签的实际墨迹比估算略宽
    pt = sp.showValue ? 26 : 17 // 数值标签中心在柱顶上方 9pt
    pb = 16 + catHalf + PAD // 类别文字中心在轴下方 16pt
  }
  const pw = plotW - pl - pr
  const ph = H - pt - pb
  const axisY = pt + ph
  const rx = sp.radius

  if (sp.orient === 'v') {
    // 网格线 + Y 轴刻度值
    for (let i = 0; i <= ticks; i++) {
      const y = axisY - (ph * i) / ticks
      if (sp.showGrid || i === 0) {
        geo.push('<line x1="' + pl + '" y1="' + n1(y) + '" x2="' + (pl + pw) + '" y2="' + n1(y) +
          '" stroke="' + (i === 0 ? C_AXIS : C_GRID) + '" stroke-width="1"/>')
      }
      labels.push({ s: fmtVal((top * i) / ticks), x: pl - 8, y: y, a: 'end', mid: true, size: 10, c: C_TICK })
    }

    const count = rows.length
    const slot = pw / count
    const bw = Math.min(slot * 0.56, 54)
    rows.forEach(function (r, i) {
      const bx = pl + slot * (i + 0.5) - bw / 2
      const bh = Math.max(1, (r.value / top) * ph)
      const by = axisY - bh
      const col = multi ? PALETTE[i % PALETTE.length] : MONO
      geo.push('<rect x="' + n1(bx) + '" y="' + n1(by) + '" width="' + n1(bw) + '" height="' + n1(bh) +
        '" rx="' + rx + '" fill="' + col + '"/>')
      if (sp.showValue) {
        labels.push({ s: fmtVal(r.value), x: bx + bw / 2, y: by - 9, a: 'middle', mid: true, size: 10, c: C_LABEL })
      }
      labels.push({ s: r.name, x: bx + bw / 2, y: axisY + 16, a: 'middle', mid: true, size: 11, c: C_LABEL })
    })
  } else {
    // 网格线 + 底部刻度值（横向时数值轴是 X 轴）
    for (let i = 0; i <= ticks; i++) {
      const x = pl + (pw * i) / ticks
      if (sp.showGrid || i === 0) {
        geo.push('<line x1="' + n1(x) + '" y1="' + pt + '" x2="' + n1(x) + '" y2="' + axisY +
          '" stroke="' + (i === 0 ? C_AXIS : C_GRID) + '" stroke-width="1"/>')
      }
      labels.push({ s: fmtVal((top * i) / ticks), x: x, y: axisY + 15, a: 'middle', mid: true, size: 10, c: C_TICK })
    }

    const count = rows.length
    const slot = ph / count
    const bh = Math.min(slot * 0.56, 34)
    rows.forEach(function (r, i) {
      const by = pt + slot * (i + 0.5) - bh / 2
      const bw = Math.max(1, (r.value / top) * pw)
      const col = multi ? PALETTE[i % PALETTE.length] : MONO
      geo.push('<rect x="' + pl + '" y="' + n1(by) + '" width="' + n1(bw) + '" height="' + n1(bh) +
        '" rx="' + rx + '" fill="' + col + '"/>')
      labels.push({ s: r.name, x: pl - 8, y: by + bh / 2, a: 'end', mid: true, size: 11, c: C_LABEL })
      if (sp.showValue) {
        labels.push({ s: fmtVal(r.value), x: pl + bw + 8, y: by + bh / 2, a: 'start', mid: true, size: 10, c: C_LABEL })
      }
    })
  }

  // 图例单独成图（同一个画布尺寸，坐标与主体完全一致）：
  // 插入时它会独立编成「图例」组，而不是混进数据图的图层里
  let legendSvg = ''
  let legendLabels = []
  if (sp.showLegend) {
    const lg = legendCol(rows, multi ? null : MONO, plotW + LEGEND_GAP, H)
    legendSvg = wrap(W, H, lg.geo)
    legendLabels = lg.labels
  }

  return { svg: wrap(W, H, geo), labels: labels, legendSvg: legendSvg, legendLabels: legendLabels, w: W, h: H }
}

// ---------- 折线图 ----------

function buildLine(sp) {
  const H = sp.h
  const plotW = sp.w
  const ticks = 4
  const rows = sp.rows
  const lgW = sp.showLegend ? legendWidth(rows) : 0
  const W = plotW + (lgW ? LEGEND_GAP + lgW + PAD : 0)
  const maxV = Math.max.apply(null, rows.map(function (r) { return r.value }).concat([1]))
  const top = niceCeil(maxV)
  const multi = sp.colorMode === 'multi'
  const geo = []
  const labels = []

  // 内边距按文字实测（v0.5.21）：左贴刻度数字、右贴数值标签半宽、上贴数值标签、下贴类别文字
  const tickW = tickWidth(top, ticks)
  const valW = valueWidth(rows, sp.showValue)
  const pl = PAD + Math.ceil(tickW) + AXIS_GAP
  const pr = PAD + Math.ceil(valW / 2) + 2 // +2：居中标签的实际墨迹比估算略宽
  const pt = sp.showValue ? 26 : 17 // 数值标签中心在点上上方 11pt
  const pb = 16 + Math.ceil(TEXT_HH * LBL_SIZE) + PAD // 类别文字中心在轴下方 16pt
  const pw = plotW - pl - pr
  const ph = H - pt - pb
  const axisY = pt + ph

  // 网格线 + Y 轴刻度值（与竖向柱状图同一套坐标）
  for (let i = 0; i <= ticks; i++) {
    const y = axisY - (ph * i) / ticks
    if (sp.showGrid || i === 0) {
      geo.push('<line x1="' + pl + '" y1="' + n1(y) + '" x2="' + (pl + pw) + '" y2="' + n1(y) +
        '" stroke="' + (i === 0 ? C_AXIS : C_GRID) + '" stroke-width="1"/>')
    }
    labels.push({ s: fmtVal((top * i) / ticks), x: pl - 8, y: y, a: 'end', mid: true, size: 10, c: C_TICK })
  }

  const count = rows.length
  // 点均匀铺满绘图区（首尾贴边），单点居中
  const px = function (i) { return count === 1 ? pl + pw / 2 : pl + (pw * i) / (count - 1) }
  const py = function (v) { return axisY - Math.max(0, (v / top) * ph) }

  // 折线段：多彩模式每段用起点数据的颜色
  for (let i = 0; i < count - 1; i++) {
    const col = multi ? PALETTE[i % PALETTE.length] : MONO
    geo.push('<line x1="' + n1(px(i)) + '" y1="' + n1(py(rows[i].value)) +
      '" x2="' + n1(px(i + 1)) + '" y2="' + n1(py(rows[i + 1].value)) +
      '" stroke="' + col + '" stroke-width="2.5" stroke-linecap="round"/>')
  }

  rows.forEach(function (r, i) {
    const x = px(i)
    const y = py(r.value)
    const col = multi ? PALETTE[i % PALETTE.length] : MONO
    geo.push('<circle cx="' + n1(x) + '" cy="' + n1(y) + '" r="3.5" fill="' + col + '"/>')
    if (sp.showValue) {
      labels.push({ s: fmtVal(r.value), x: x, y: y - 11, a: 'middle', mid: true, size: 10, c: C_LABEL })
    }
    labels.push({ s: r.name, x: x, y: axisY + 16, a: 'middle', mid: true, size: 11, c: C_LABEL })
  })

  // 图例单独成图（同画布尺寸，坐标一致），插入时独立编组
  let legendSvg = ''
  let legendLabels = []
  if (sp.showLegend) {
    const lg = legendCol(rows, multi ? null : MONO, plotW + LEGEND_GAP, H)
    legendSvg = wrap(W, H, lg.geo)
    legendLabels = lg.labels
  }

  return { svg: wrap(W, H, geo), labels: labels, legendSvg: legendSvg, legendLabels: legendLabels, w: W, h: H }
}

// ---------- 饼图 / 环形图 ----------

// 圆弧转三次贝塞尔（每段 ≤ 90°）：绕开 SVG 导入器对 A 命令的处理差异
function arcSegs(cx, cy, r, a0, a1) {
  const out = []
  const total = a1 - a0
  if (Math.abs(total) < 1e-6) return out
  const seg = Math.max(1, Math.ceil(Math.abs(total) / (Math.PI / 2)))
  const d = total / seg
  const k = (4 / 3) * Math.tan(d / 4)
  let a = a0
  for (let i = 0; i < seg; i++) {
    const s = a
    const e = a + d
    const p0 = [cx + r * Math.cos(s), cy + r * Math.sin(s)]
    const p3 = [cx + r * Math.cos(e), cy + r * Math.sin(e)]
    const c1 = [p0[0] - k * r * Math.sin(s), p0[1] + k * r * Math.cos(s)]
    const c2 = [p3[0] + k * r * Math.sin(e), p3[1] - k * r * Math.cos(e)]
    out.push([p0, c1, c2, p3])
    a = e
  }
  return out
}

function segPath(segs) {
  let d = ''
  segs.forEach(function (s) {
    d += ' C' + n2(s[1][0]) + ' ' + n2(s[1][1]) + ' ' + n2(s[2][0]) + ' ' + n2(s[2][1]) +
      ' ' + n2(s[3][0]) + ' ' + n2(s[3][1])
  })
  return d
}

// 反向走同一段弧：环形的内圈要与外圈闭合，必须按「终点→起点」的方向绘制。
// 直接用负角度步进公式会算反控制点（扇区张不开），所以这里把正向弧倒序拼接。
function segPathRev(segs) {
  let d = ''
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i]
    d += ' C' + n2(s[2][0]) + ' ' + n2(s[2][1]) + ' ' + n2(s[1][0]) + ' ' + n2(s[1][1]) +
      ' ' + n2(s[0][0]) + ' ' + n2(s[0][1])
  }
  return d
}

function slicePath(cx, cy, r0, r1, a0, a1) {
  let d
  if (r0 <= 0.01) {
    d = 'M' + n2(cx) + ' ' + n2(cy) + ' L' + n2(cx + r1 * Math.cos(a0)) + ' ' + n2(cy + r1 * Math.sin(a0))
  } else {
    d = 'M' + n2(cx + r1 * Math.cos(a0)) + ' ' + n2(cy + r1 * Math.sin(a0))
  }
  d += segPath(arcSegs(cx, cy, r1, a0, a1))
  if (r0 > 0.01) {
    // 外弧终点先直线连到内圈起点（径向边），再反向走内弧回到内圈 a0
    d += ' L' + n2(cx + r0 * Math.cos(a1)) + ' ' + n2(cy + r0 * Math.sin(a1))
    d += segPathRev(arcSegs(cx, cy, r0, a0, a1))
  }
  return d + ' Z'
}

function buildPie(sp) {
  const D = sp.dia // 用户输入的直径 = 饼图本体
  const R = D / 2
  const rowsF = sp.rows.filter(function (r) { return r.value > 0 })
  // 画布 = 左右各 PAD + 本体直径 + 图例列（与本体固定 40pt 间距），高度取本体与图例高度的较大者
  const legendRows = rowsF.length ? rowsF : sp.rows
  const lgW = sp.showLegend ? LEGEND_GAP + legendWidth(rowsF) : 0
  const W = Math.round(D + PAD * 2 + lgW)
  const H = Math.round(Math.max(D + PAD * 2, sp.showLegend ? legendRows.length * 24 + PAD * 2 : 0))
  const cx = PAD + R
  const cy = Math.round(H / 2)
  // 环形内径：用户输入的是「环的宽度」（0 = 实心），内圈半径 = R - 环宽
  const inner = sp.ring > 0 ? Math.max(0, R - sp.ring) : 0
  const geo = []
  const labels = []

  if (!rowsF.length) {
    geo.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + R + '" fill="' + C_GRID + '"/>')
    labels.push({ s: '数值都为 0', x: cx, y: cy, a: 'middle', mid: true, size: clamp(R * 0.18, 8, 11), c: C_TICK })
    return { svg: wrap(W, H, geo), labels: labels, legendSvg: '', legendLabels: [], w: W, h: H }
  }

  const total = rowsF.reduce(function (a, r) { return a + r.value }, 0) || 1
  let a = -Math.PI / 2 // 从 12 点方向顺时针
  // 描边固定白色：输入粗细 > 0 即显示
  const strokeAttr = sp.strokeWidth > 0
    ? ' stroke="#FFFFFF" stroke-width="' + n2(sp.strokeWidth) + '" stroke-linejoin="round"'
    : ''
  const pctSize = R >= 44 ? 10 : 8

  rowsF.forEach(function (r, i) {
    const ang = (r.value / total) * Math.PI * 2
    const a0 = a
    const a1 = a + ang
    const col = PALETTE[i % PALETTE.length]
    geo.push('<path d="' + slicePath(cx, cy, inner, R, a0, a1) + '" fill="' + col + '"' + strokeAttr + '/>')

    const pct = (r.value / total) * 100
    if (sp.showPct && pct >= 4 && R >= 20) {
      const am = (a0 + a1) / 2
      const rr = inner + (R - inner) * 0.62
      labels.push({
        s: Math.round(pct) + '%',
        x: cx + rr * Math.cos(am),
        y: cy + rr * Math.sin(am),
        a: 'middle',
        mid: true,
        size: pctSize,
        c: lum(col) > 0.62 ? C_DARK : '#FFFFFF'
      })
    }
    a = a1
  })

  let legendSvg = ''
  let legendLabels = []
  if (sp.showLegend) {
    const lg = legendCol(rowsF, null, Math.round(cx + R + LEGEND_GAP), H)
    legendSvg = wrap(W, H, lg.geo)
    legendLabels = lg.labels
  }

  if (inner > 14) {
    labels.push({ s: '合计', x: cx, y: cy - R * 0.16, a: 'middle', mid: true, size: clamp(R * 0.18, 7, 10), c: C_TICK })
    labels.push({ s: fmtVal(total), x: cx, y: cy + R * 0.1, a: 'middle', mid: true, size: clamp(R * 0.3, 10, 15), c: C_DARK })
  }

  return { svg: wrap(W, H, geo), labels: labels, legendSvg: legendSvg, legendLabels: legendLabels, w: W, h: H }
}

// ---------- 对外入口 ----------

export function buildChart(raw) {
  const sp = normalize(raw)
  if (sp.type === 'pie') return buildPie(sp)
  if (sp.type === 'line') return buildLine(sp)
  return buildBar(sp)
}

// 给窗口预览用：把图例几何 + 所有标签渲染进主 SVG，预览与插入结果完全一致
export function previewSvg(built) {
  // 图例几何是独立的一份 SVG（同画布尺寸）——预览时并回主图
  const legendInner = built.legendSvg
    ? String(built.legendSvg).replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
    : ''
  let extra = ''
  const all = (built.labels || []).concat(built.legendLabels || [])
  all.forEach(function (L) {
    const size = L.size || 11
    const y = L.mid ? L.y : L.y + size * 0.82
    extra += '<text x="' + n1(L.x) + '" y="' + n1(y) + '" font-size="' + size + '" fill="' + L.c +
      '" text-anchor="' + (L.a || 'start') + '" font-family="PingFang SC, -apple-system, sans-serif"' +
      (L.mid ? ' dominant-baseline="middle"' : '') + '>' + esc(L.s) + '</text>'
  })
  return built.svg.replace('</svg>', legendInner + extra + '</svg>')
}

// 随机示例数据（窗口里「随机示例」按钮用）
export function randomRows(n) {
  const pool = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月']
  const count = Math.min(8, Math.max(3, Number(n) || 5))
  const out = []
  for (let i = 0; i < count; i++) {
    out.push({ name: pool[i], value: 40 + Math.round(Math.random() * 260) })
  }
  return out
}
