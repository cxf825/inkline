import sketch, { getSelectedDocument } from 'sketch'
import { toast } from './panel-ref.js'
import { PREFIX } from './util.js'

// 批量切图导出：选中图层导出 PNG @1x/@2x/@3x，矢量图层额外导出 SVG
function pickFolder() {
  const panel = NSOpenPanel.openPanel()
  panel.setCanChooseDirectories(true)
  panel.setCanChooseFiles(false)
  panel.setAllowsMultipleSelection(false)
  panel.setPrompt('导出到此文件夹')
  panel.setMessage('选择切图导出目录（将在其中生成 @1x/@2x/@3x PNG 与 SVG）')
  panel.setDirectoryURL_(NSURL.fileURLWithPath_(NSHomeDirectory() + '/Desktop'))
  if (Number(panel.runModal()) !== 1) return null
  return '' + panel.URLs().firstObject().path()
}

// 推断子文件夹名：选中图层共同父级的编组/画板名
function subFolderName(sel, doc) {
  const first = sel[0]
  let name = null
  // 多选且全部在同一编组/画板内 → 用父级名
  const sameParent = sel.every(function (l) { return l.parent === first.parent })
  if (sameParent && first.parent && (first.parent.type === 'Group' || first.parent.type === 'Artboard' || first.parent.type === 'SymbolMaster')) {
    name = first.parent.name
  } else if (sel.length === 1) {
    // 单选：优先用图层自身名（如选中整个编组）
    name = first.name
  } else {
    name = (doc ? String(doc.selectedPage.name) : '') + '-切图'
  }
  name = String(name || '').replace(/^INK-/, '').replace(/[\\/:*?"<>|]/g, '-').trim()
  return name || '切图'
}

export function exportSlices() {
  const doc = getSelectedDocument()
  if (!doc) {
    toast('请先打开一个文档')
    return
  }
  const sel = doc.selectedLayers.layers.filter(function (l) {
    return l.name.indexOf(PREFIX) !== 0
  })
  if (!sel.length) {
    toast('请先选中要切图的图层（可多选）')
    return
  }

  const dir = pickFolder()
  if (!dir) {
    toast('已取消导出')
    return
  }

  // 在所选目录下按编组名新建子文件夹，避免切图散落一片
  const sub = dir + '/' + subFolderName(sel, doc)
  NSFileManager.defaultManager().createDirectoryAtPath_withIntermediateDirectories_attributes_error_(sub, true, nil, nil)

  let okPng = 0
  let okSvg = 0
  let fail = 0
  sel.forEach(function (layer) {
    try {
      sketch.export(layer, {
        output: sub,
        formats: 'png',
        scales: '1,2,3',
        overwriting: true
      })
      okPng++
    } catch (e) {
      fail++
    }
    // 矢量类图层额外出 SVG（文本图层跳过）
    if (layer.type !== 'Text') {
      try {
        sketch.export(layer, {
          output: sub,
          formats: 'svg',
          overwriting: true
        })
        okSvg++
      } catch (e) { /* SVG 失败不计数，PNG 已够用 */ }
    }
  })

  if (okPng > 0) {
    toast('切图完成：' + okPng + ' 个图层（含 @1x/@2x/@3x）' + (okSvg ? ' + ' + okSvg + ' 个 SVG' : '') + (fail ? '，' + fail + ' 个失败' : '') + ' → ' + sub + ' ✅')
  } else {
    toast('切图失败，请重试')
  }
}
