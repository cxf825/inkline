import sketch, { getSelectedDocument, UI } from 'sketch'
import { toast } from './panel-ref.js'
import { PREFIX, isLive } from './util.js'
import BrowserWindow from 'sketch-module-web-view'

// ---------------- 导出规格 ----------------

// Android 密度名 → 倍率；导出到 drawable-<密度>/ 目录，文件名统一为 name.png
const ANDROID_DENSITY = {
  ldpi: 0.75,
  mdpi: 1,
  hdpi: 1.5,
  xhdpi: 2,
  xxhdpi: 3,
  xxxhdpi: 4
}

const SPEC_KEY = 'inkline.sliceSpec'
// 默认沿用旧行为：iOS 三档位图（Android 需用户显式勾选）
const DEFAULT_SPEC = { ios: ['1', '2', '3'], and: [] }

function readSpec() {
  try {
    const s = NSUserDefaults.standardUserDefaults().stringForKey_(SPEC_KEY)
    const o = s ? JSON.parse(String(s)) : null
    if (o && Array.isArray(o.ios) && Array.isArray(o.and)) {
      return { ios: o.ios.map(String), and: o.and.map(String) }
    }
  } catch (e) { /* ignore */ }
  return { ios: DEFAULT_SPEC.ios.slice(), and: DEFAULT_SPEC.and.slice() }
}

function saveSpec(spec) {
  try {
    NSUserDefaults.standardUserDefaults().setObject_forKey_(JSON.stringify(spec), SPEC_KEY)
  } catch (e) { /* ignore */ }
}

// ---------------- 文件系统小工具 ----------------

function ensureDir(p) {
  NSFileManager.defaultManager()
    .createDirectoryAtPath_withIntermediateDirectories_attributes_error_(p, true, nil, nil)
  return p
}

function safeName(name) {
  const n = String(name || '').replace(/[\\/:*?"<>|]/g, '-').trim()
  return n || 'slice'
}

// Android 目录里 Sketch 会导出成 name@1.5x.png 这类带倍率后缀的文件，
// 而 Android 规范是靠目录区分密度，于是统一改回 name.png
function normalizeName(dir, base) {
  try {
    const fm = NSFileManager.defaultManager()
    const arr = fm.contentsOfDirectoryAtPath_error_(dir, nil) || []
    const n = arr.length || 0
    for (let i = 0; i < n; i++) {
      const f = String(arr[i])
      if (f === base + '.png') continue
      if (f.indexOf(base + '@') !== 0 || f.slice(-4) !== '.png') continue
      const to = dir + '/' + base + '.png'
      try { fm.removeItemAtPath_error_(to, nil) } catch (e) { /* 目标不存在 */ }
      try { fm.moveItemAtPath_toPath_error_(dir + '/' + f, to, nil) } catch (e) { /* ignore */ }
    }
  } catch (e) { /* ignore */ }
}

function pickFolder() {
  const panel = NSOpenPanel.openPanel()
  panel.setCanChooseDirectories(true)
  panel.setCanChooseFiles(false)
  panel.setAllowsMultipleSelection(false)
  panel.setCanCreateDirectories(true) // 面板左下角显示"新建文件夹"按钮
  panel.setPrompt('导出到此文件夹')
  panel.setMessage('选择切图导出目录（将按所选规格生成各平台文件）')
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

// ---------------- 按规格导出 ----------------

function runExport(sel, spec) {
  const dir = pickFolder()
  if (!dir) {
    toast('已取消导出')
    return
  }
  const doc = getSelectedDocument()
  const sub = ensureDir(dir + '/' + subFolderName(sel, doc))

  const iosScales = spec.ios.filter(function (k) { return k !== 'svg' })
  const andDens = spec.and.filter(function (k) { return k !== 'svg' && ANDROID_DENSITY[k] })
  const wantSvg = spec.ios.indexOf('svg') > -1 || spec.and.indexOf('svg') > -1

  let nPng = 0
  let nSvg = 0
  let fail = 0

  // iOS：Sketch 原生 @1x / @2x / @3x 命名，直接落在切图根目录
  if (iosScales.length) {
    sel.forEach(function (layer) {
      try {
        sketch.export(layer, {
          output: sub,
          formats: 'png',
          scales: iosScales.join(','),
          overwriting: true
        })
        nPng += iosScales.length
      } catch (e) {
        fail++
      }
    })
  }

  // Android：每个密度一个 drawable-<密度> 目录，文件名统一为 name.png
  andDens.forEach(function (dens) {
    const d = ensureDir(sub + '/drawable-' + dens)
    sel.forEach(function (layer) {
      try {
        sketch.export(layer, {
          output: d,
          formats: 'png',
          scales: String(ANDROID_DENSITY[dens]),
          overwriting: true
        })
        normalizeName(d, safeName(layer.name))
        nPng++
      } catch (e) {
        fail++
      }
    })
  })

  // SVG：两端共用，放在切图根目录（文本图层无矢量外形，跳过）
  if (wantSvg) {
    sel.forEach(function (layer) {
      if (layer.type === 'Text') return
      try {
        sketch.export(layer, {
          output: sub,
          formats: 'svg',
          overwriting: true
        })
        nSvg++
      } catch (e) { /* SVG 失败不阻断，位图已够用 */ }
    })
  }

  const bits = []
  if (nPng) bits.push(nPng + ' 张 PNG')
  if (nSvg) bits.push(nSvg + ' 个 SVG')
  if (bits.length) {
    toast('切图完成：' + sel.length + ' 个图层 → ' + bits.join(' + ') +
      (fail ? '，' + fail + ' 个失败' : '') + ' ✅')
  } else {
    toast('切图失败，请重试')
  }
}

// ---------------- 选项窗口 ----------------

// 模块级窗口引用（铁律：严禁用 getWebview 反查，会重建 delegate 导致推送静默失效）
let slicesWin = null
let slicesSeq = 0

export function exportSlices() {
  const doc = getSelectedDocument()
  if (!doc) {
    toast('请先打开一个文档')
    return
  }
  const sel = doc.selectedLayers.layers.filter(function (l) {
    return String(l.name).indexOf(PREFIX) !== 0
  })
  if (!sel.length) {
    toast('请先选中要切图的图层（可多选）')
    return
  }
  openSliceOptions(sel)
}

// 先选规格、再选目录：窗口收起后才弹文件夹面板，避免被窗口挡住
function openSliceOptions(sel) {
  if (slicesWin) {
    if (isLive(slicesWin)) {
      try { slicesWin.show() } catch (e) { /* ignore */ }
      return
    }
    slicesWin = null // 僵尸引用：丢弃后重建
  }
  const win = new BrowserWindow({
    identifier: 'inkline.slices.v1.' + (++slicesSeq),
    width: 480,
    height: 466,
    resizable: false,
    movable: true,
    title: '墨斗·Inkline · 切图导出',
    alwaysOnTop: true,
    hidesOnDeactivate: true,
    remembersWindowFrame: false
  })
  slicesWin = win
  win.on('closed', function () {
    if (slicesWin === win) slicesWin = null
  })

  const wc = win.webContents
  wc.on('requestSliceSpec', function () {
    try {
      wc.executeJavaScript('window.__setSpec(' + JSON.stringify(readSpec()) + ')')
    } catch (e) { /* ignore */ }
  })
  wc.on('slicesGo', function (payload) {
    let spec = null
    try { spec = JSON.parse(String(payload)) } catch (e) { /* ignore */ }
    if (!spec || typeof spec !== 'object') {
      toast('规格读取失败，请重试')
      return
    }
    spec = {
      ios: Array.isArray(spec.ios) ? spec.ios.map(String) : [],
      and: Array.isArray(spec.and) ? spec.and.map(String) : []
    }
    saveSpec(spec) // 记住这次的选择，下次打开即用
    try { win.close() } catch (e) { /* ignore */ }
    try {
      runExport(sel, spec)
    } catch (e) {
      UI.alert('Inkline 出错了', String(e && e.message ? e.message : e))
    }
  })
  wc.on('close', function () {
    try { win.close() } catch (e) { /* ignore */ }
  })

  win.once('ready-to-show', function () {
    win.show()
    try { win.setAlwaysOnTop(true, 'floating', 1) } catch (e) { /* ignore */ }
  })
  win.loadURL(require('./resources/slices.html'))
}
