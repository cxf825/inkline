import { getSelectedDocument, Rectangle, ShapePath, UI } from 'sketch'

// 图形分割：把选中的画板/图形按 行×列 - 间距 - 页边距 切成网格矩形
export function runSlice(arg) {
  const doc = getSelectedDocument()
  if (!doc) {
    UI.message('请先打开一个文档')
    return
  }
  const sel = doc.selectedLayers.layers
  if (sel.length !== 1) {
    UI.message('请先选中一个要分割的图层（画板/图形，单选）')
    return
  }
  const src = sel[0]
  if (src.type === 'Page') {
    UI.message('请选中画板或图形，不能分割页面')
    return
  }

  let opts = {}
  try { opts = typeof arg === 'string' ? JSON.parse(arg) : (arg || {}) } catch (e) { /* ignore */ }
  let cols = parseInt(opts.cols, 10)
  let rows = parseInt(opts.rows, 10)
  let gap = parseFloat(opts.gap)
  let margin = parseFloat(opts.margin)
  if (isNaN(cols) || cols < 1) cols = 1
  if (isNaN(rows) || rows < 1) rows = 1
  if (isNaN(gap) || gap < 0) gap = 0
  if (isNaN(margin) || margin < 0) margin = 0

  const f = src.frame
  const innerW = f.width - margin * 2 - gap * (cols - 1)
  const innerH = f.height - margin * 2 - gap * (rows - 1)
  if (innerW <= 0 || innerH <= 0) {
    UI.message('间距或页边距过大，' + cols + '×' + rows + ' 分割后没有剩余空间')
    return
  }
  const cw = innerW / cols
  const ch = innerH / rows

  // 提取源图层填充色，重建干净的填充对象（画板/图形均适用），失败则用浅色兜底
  // 注意：不能整包复制 style.fills 对象——里面带 image 等内部属性，
  // 传回构造器会抛 "'image' needs to be a Buffer"；共享对象又只对一格生效。
  // 只有 { fillType:'Color', color:'#xxx' } 这种干净对象才可靠。
  let fillColor = '#F1EEE6FF'
  let borders = [{ color: '#B8B2A4FF', thickness: 0.5 }]
  try {
    const sf = src.style.fills.filter(function (x) { return x.enabled !== false })
    for (let i = 0; i < sf.length; i++) {
      if (sf[i].fillType === 'Color' && typeof sf[i].color === 'string') {
        fillColor = sf[i].color
        borders = []
        break
      }
    }
  } catch (e) { /* ignore */ }

  const parent = src.parent
  const cells = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // 每格独立重建干净字面量，不共享、不整包复制
      const cell = new ShapePath({
        parent: parent,
        frame: new Rectangle(
          f.x + margin + c * (cw + gap),
          f.y + margin + r * (ch + gap),
          cw,
          ch
        ),
        shapeType: 'Rectangle',
        style: {
          fills: [{ fillType: 'Color', color: fillColor }],
          borders: borders.length ? [{ color: borders[0].color, thickness: borders[0].thickness }] : []
        }
      })
      cell.name = (src.name || '图形') + '-分割-' + (r + 1) + '-' + (c + 1)
      cells.push(cell)
    }
  }

  // 在原图形上分割：格子生成后移除原图形，不建编组（格子平铺在原父级）
  try { src.remove() } catch (e) { /* 保留原图形不影响结果 */ }

  UI.message('已分割为 ' + rows + ' 行 × ' + cols + ' 列，共 ' + cells.length + ' 个图形 ✅')
}
