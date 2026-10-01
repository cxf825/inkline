import sketch, { Image, UI, getSelectedDocument } from 'sketch'
import { toast } from './panel-ref.js'
import { isLive } from './util.js'
import BrowserWindow from 'sketch-module-web-view'

// ---------------- Mock 文本数据（纯本地生成，无网络依赖） ----------------

const SURNAMES = ['张', '王', '李', '赵', '刘', '陈', '杨', '黄', '周', '吴', '徐', '孙', '马', '朱', '胡', '郭', '何', '林', '罗', '郑']
const GIVEN = ['伟', '芳', '娜', '敏', '静', '磊', '军', '洋', '勇', '艳', '杰', '涛', '明', '超', '秀英', '建国', '子轩', '雨桐', '浩然', '梦琪', '思远', '佳怡', '志强', '小雅']
const WORDS = ['这是一段示例文案，用于展示真实的排版效果', '设计交付前的数据应该尽量贴近真实内容', '点击刷新可以快速替换为新文案', '墨斗在手，标注不愁，交付规范一步到位', '好的界面需要用真实数据来检验布局', '文本长度不同，布局表现也会不同，多试几种', '摘要文字通常一到两行，注意截断效果', '按钮上的文字要简短明确，动词开头更好']

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)] }
function digits(n) {
  let s = ''
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10)
  return s
}
function genName() { return rand(SURNAMES) + rand(GIVEN) }
function genPhone() { return rand(['13', '15', '17', '18', '19']) + digits(9) }
function genEmail() { return rand(['wang', 'li', 'chen', 'yang', 'liu', 'zhao', 'sun']) + digits(2) + rand(['@qq.com', '@163.com', '@gmail.com', '@outlook.com']) }
function genPrice() {
  const v = Math.random() < 0.5 ? String(Math.floor(Math.random() * 9900) + 1) : (Math.random() * 999 + 1).toFixed(2)
  return '¥' + v
}
function genSentence() { return rand(WORDS) }

const CITIES = ['北京市', '上海市', '广州市', '深圳市', '杭州市', '成都市', '武汉市', '南京市', '重庆市', '西安市', '苏州市', '长沙市']
const DISTRICTS = ['朝阳区', '西湖区', '天河区', '南山区', '高新区', '静安区', '江汉区', '鼓楼区']
const STREETS = ['中山路', '人民路', '解放大道', '和平街', '文化路', '科技路', '滨江大道', '建设南路']
function genAddr() {
  return rand(CITIES) + rand(DISTRICTS) + rand(STREETS) + Math.floor(Math.random() * 999 + 1) + '号'
}
function genDate() {
  const y = rand(['2025', '2026', '2027'])
  const m = String(Math.floor(Math.random() * 12) + 1)
  const d = String(Math.floor(Math.random() * 28) + 1)
  return y + '-' + (m.length < 2 ? '0' + m : m) + '-' + (d.length < 2 ? '0' + d : d)
}

// 按图层名智能匹配类型
function smartTypeFor(layer) {
  const n = String(layer.name || '').toLowerCase()
  if (n.indexOf('手机') > -1 || n.indexOf('电话') > -1 || n.indexOf('phone') > -1 || n.indexOf('tel') > -1) return 'phone'
  if (n.indexOf('邮箱') > -1 || n.indexOf('mail') > -1) return 'email'
  if (n.indexOf('价') > -1 || n.indexOf('金额') > -1 || n.indexOf('price') > -1 || n.indexOf('amount') > -1) return 'price'
  if (n.indexOf('日期') > -1 || n.indexOf('时间') > -1 || n.indexOf('date') > -1 || n.indexOf('time') > -1) return 'date'
  if (n.indexOf('地址') > -1 || n.indexOf('addr') > -1) return 'addr'
  if (n.indexOf('名') > -1 || n.indexOf('name') > -1 || n.indexOf('用户') > -1 || n.indexOf('user') > -1) return 'name'
  if (n.indexOf('标题') > -1 || n.indexOf('title') > -1) return 'sentence'
  return 'sentence'
}

const TEXT_GEN = {
  name: genName,
  phone: genPhone,
  email: genEmail,
  price: genPrice,
  sentence: genSentence,
  addr: genAddr,
  date: genDate
}

export function mockText(type) {
  const doc = getSelectedDocument()
  if (!doc) {
    toast('请先打开一个文档')
    return
  }
  const sel = doc.selectedLayers.layers.filter(function (l) { return l.type === 'Text' })
  if (!sel.length) {
    toast('请先选中文本图层')
    return
  }
  let ok = 0
  sel.forEach(function (layer) {
    try {
      const t = (type === 'smart') ? smartTypeFor(layer) : type
      layer.text = String(TEXT_GEN[t] ? TEXT_GEN[t]() : genSentence())
      layer.adjustToFit()
      ok++
    } catch (e) { /* 单个图层失败不影响其余 */ }
  })
  toast('已填充 ' + ok + ' 个文本图层 ✅')
}

// ---------------- 自定义词库（对齐 Kitchen 自定义文本填充） ----------------

const WORDS_KEY = 'inkline.customWords'
const DIR_KEY = 'inkline.mockImgDir'

function readWords() {
  try {
    const s = NSUserDefaults.standardUserDefaults().stringForKey_(WORDS_KEY)
    if (!s) return []
    const arr = JSON.parse(String(s))
    return Array.isArray(arr) ? arr.map(String).filter(function (w) { return w.trim().length > 0 }) : []
  } catch (e) {
    return []
  }
}

export function saveCustomWords(arr) {
  NSUserDefaults.standardUserDefaults().setObject_forKey_(JSON.stringify(arr), WORDS_KEY)
}

export function mockTextCustom() {
  const words = readWords()
  if (!words.length) {
    openWordsEditor()
    toast('自定义词库还是空的，先在弹出的编辑器里添加词句吧')
    return
  }
  const doc = getSelectedDocument()
  if (!doc) {
    toast('请先打开一个文档')
    return
  }
  const sel = doc.selectedLayers.layers.filter(function (l) { return l.type === 'Text' })
  if (!sel.length) {
    toast('请先选中文本图层')
    return
  }
  // 洗牌后循环取用，避免相邻图层重复
  const pool = words.slice()
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const t = pool[i]
    pool[i] = pool[j]
    pool[j] = t
  }
  let ok = 0
  sel.forEach(function (layer, i) {
    try {
      layer.text = pool[i % pool.length]
      layer.adjustToFit()
      ok++
    } catch (e) { /* 单个失败不中断 */ }
  })
  toast('已用自定义词库填充 ' + ok + ' 个文本图层 ✅')
}

const EDITOR_ID = 'inkline.words.v1'

// 词库编辑器窗口的模块级引用（与图标库同策略：严禁 getWebview 反查）
let wordsWin = null

// identifier 唯一化计数器：库遇到同 identifier 的已注册窗口会直接复用（僵尸窗口），
// 复用后 executeJavaScript 永久静默 —— 面板关闭触发 fiber.onCleanup 会连带销毁
// 词库窗口，留下僵尸引用，之后再点「编辑词库」就再也打不开（同 toast 的坑）。
let wordsSeq = 0

// 词库编辑器：独立小窗口，一行一条
export function openWordsEditor() {
  if (wordsWin) {
    if (isLive(wordsWin)) {
      // 已打开 → 直接前置
      try { wordsWin.show() } catch (e) { /* ignore */ }
      return
    }
    wordsWin = null // 僵尸引用：丢弃后重建
  }
  const win = new BrowserWindow({
    identifier: EDITOR_ID + '.' + (++wordsSeq),
    width: 420,
    height: 520,
    minWidth: 340,
    minHeight: 380,
    title: 'Inkline · 自定义词库',
    resizable: true,
    movable: true,
    alwaysOnTop: true,
    hidesOnDeactivate: true,
    remembersWindowFrame: false
  })
  wordsWin = win
  win.on('closed', function () {
    if (wordsWin === win) wordsWin = null
  })
  const wc = win.webContents
  wc.on('requestWords', function () {
    try {
      wc.executeJavaScript('window.__setWords(' + JSON.stringify(readWords()) + ')')
    } catch (e) { /* ignore */ }
  })
  wc.on('saveWords', function (payload) {
    try {
      const arr = JSON.parse(String(payload))
      if (Array.isArray(arr)) {
        saveCustomWords(arr.map(String).filter(function (w) { return w.trim().length > 0 }))
        toast('词库已保存（' + arr.length + ' 条）✅')
      }
      win.close()
    } catch (e) {
      UI.alert('Inkline 出错了', String(e && e.message ? e.message : e))
    }
  })
  win.once('ready-to-show', function () {
    win.show()
    try { win.setAlwaysOnTop(true, 'floating', 1) } catch (e) { /* ignore */ }
  })
  win.loadURL(require('./resources/words.html'))
}

// ---------------- 本地图片文件夹（对齐 Kitchen 自定义素材库） ----------------

export function chooseImageDir() {
  const panel = NSOpenPanel.openPanel()
  panel.setCanChooseDirectories(true)
  panel.setCanChooseFiles(false)
  panel.setAllowsMultipleSelection(false)
  panel.setPrompt('选择文件夹')
  panel.setMessage('选择 Mock 图片素材文件夹（其中的图片将被随机填充到选中图层）')
  if (Number(panel.runModal()) === 1) {
    const p = String(panel.URLs().firstObject().path())
    NSUserDefaults.standardUserDefaults().setObject_forKey_(p, DIR_KEY)
    toast('图片素材文件夹已设置：' + p)
  }
}

const IMG_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'heic']

function localImageFiles(dir) {
  try {
    const fm = NSFileManager.defaultManager()
    const arr = fm.contentsOfDirectoryAtPath_error_(dir, nil)
    const out = []
    const n = arr.count()
    for (let i = 0; i < n; i++) {
      const name = String(arr.objectAtIndex(i))
      const parts = name.split('.')
      if (parts.length < 2) continue
      const ext = parts.pop().toLowerCase()
      if (IMG_EXTS.indexOf(ext) > -1) out.push(name)
    }
    return out
  } catch (e) {
    return []
  }
}

function fillFromLocal(layer) {
  let dir = String(NSUserDefaults.standardUserDefaults().stringForKey_(DIR_KEY) || '')
  if (!dir) {
    chooseImageDir()
    dir = String(NSUserDefaults.standardUserDefaults().stringForKey_(DIR_KEY) || '')
  }
  if (!dir) {
    toast('未设置图片素材文件夹')
    return false
  }
  const files = localImageFiles(dir)
  if (!files.length) {
    toast('素材文件夹里没有找到图片（支持 jpg/png/gif/webp 等）')
    return false
  }
  const file = dir + '/' + files[Math.floor(Math.random() * files.length)]
  const data = NSData.dataWithContentsOfFile_(file)
  if (!data) return false
  applyPatternFill(layer, imageDataFromB64(data.base64EncodedStringWithOptions_(0)))
  return true
}

// ---------------- Mock 图片填充（插件侧取图，官方 API 填充） ----------------

function fetchImageB64(url) {
  const data = NSData.dataWithContentsOfURL_(NSURL.URLWithString_(url))
  if (!data) return null
  return data.base64EncodedStringWithOptions_(0)
}

// 从 base64 拿到 ImageData（创建临时 Image 图层对象取其 image 属性，不进入文档）
function imageDataFromB64(b64) {
  const tmp = new Image({ image: { base64: b64 } })
  return tmp.image
}

// 把图片数据以 Pattern Fill 铺满图层（本地与网络图源共用）
function applyPatternFill(layer, imgData) {
  layer.style.fills = [{
    fillType: sketch.Style.FillType.Pattern,
    pattern: { patternType: sketch.Style.PatternFillType.Fill, image: imgData, tileScale: 1 }
  }]
}

function imgURL(kind, i, w, h) {
  const seed = 'ink' + Date.now() + '-' + i + '-' + Math.floor(Math.random() * 9999)
  if (kind === 'portrait') {
    // 人像：randomuser 免登录头像库（100 张 / 性别轮换）
    const g = i % 2 === 0 ? 'men' : 'women'
    return 'https://randomuser.me/api/portraits/' + g + '/' + (i % 100) + '.jpg'
  }
  // 任意 / 风景：picsum 免登录图源，按图层尺寸出图
  return 'https://picsum.photos/seed/' + seed + '/' + Math.max(24, Math.min(2000, Math.round(w))) + '/' + Math.max(24, Math.min(2000, Math.round(h)))
}

function isImageTarget(layer) {
  return layer.type === 'ShapePath' || layer.type === 'Image' || layer.type === 'SymbolInstance' || layer.type === 'Shape' || layer.type === 'Rectangle'
}

export function mockImage(kind) {
  const doc = getSelectedDocument()
  if (!doc) {
    toast('请先打开一个文档')
    return
  }
  const targets = doc.selectedLayers.layers.filter(isImageTarget)
  if (!targets.length) {
    toast('请先选中要填充的图层（矩形/形状/图片）')
    return
  }
  let ok = 0
  let fail = 0
  targets.forEach(function (layer, i) {
    try {
      if (kind === 'local') {
        // 本地素材文件夹：随机选一张
        if (fillFromLocal(layer)) ok++
        else fail++
        return
      }
      const f = layer.frame
      const url = imgURL(kind, i, f.width, f.height)
      const b64 = fetchImageB64(url)
      if (!b64) {
        fail++
        return
      }
      const imgData = imageDataFromB64(b64)
      applyPatternFill(layer, imgData)
      ok++
    } catch (e) {
      fail++
    }
  })
  if (ok > 0) {
    toast('已填充 ' + ok + ' 个图层' + (fail ? '（' + fail + ' 个失败）' : '') + ' ✅')
  } else {
    toast('图片获取失败，请检查网络后重试')
  }
}
