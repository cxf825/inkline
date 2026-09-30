import { getSelectedDocument, Rectangle, UI } from 'sketch'
import { toast } from './panel-ref.js'
import { attachFollow } from './follow.js'
import { createLayerFromData } from 'sketch'
import BrowserWindow from 'sketch-module-web-view'

// Kitchen 式图标库：双模式
// 1) 本地搜索模式：自建 UI + Iconify（免登录，CORS 开放，面板内 fetch）
// 2) iconfont 官网模式：同一窗口 loadURL 到 iconfont.cn——登录、中文搜索、
//    收藏夹全部是官网原生能力（消息桥是 documentStart 的 WKUserScript，
//    对窗口内任何后续导航的页面都生效，官网页里 window.postMessage 仍可通信）。
//    左下角注入「返回本地搜索」悬浮球随时切回。iconfont 账号登录版（关联我的项目/收藏）列 P1。

const ICONFONT_URL = 'https://www.iconfont.cn/search/index?searchType=icon'

// ---------- 官网模式「装修」样式（Kitchen 式图标库界面）----------
// 隐藏官网的导航/营销/筛选行/广告/页脚，重绘为 Kitchen 式图标库：
// 顶部标签栏（图标库/我的项目/我的收藏，JS 注入）+ 紧凑网格线图标列表。
// 数据与交互（登录、中文搜索、分页）全部是官网原生能力，我们只动外观。
// 类名实测（2026-09-30）：header>.site-nav(#main-nav/.logo/.quick-menu)、.block-sub-banner、
// .block-search-filter、.page-search-container>.block-icon-list>li.J_icon_id_*、
// .block-pagination-wrap、.footer
const DECOR_CSS = [
  // 顶栏：去 logo 与主导航，米白化，保留搜索框 + 账号/登录
  'header .site-nav .logo,',
  'header .site-nav #main-nav,',
  'header .site-nav .btn-site-menu,',
  'header .site-nav .main-nav-mask { display: none !important }',
  'header, header .site-nav { background: #FAF9F6 !important; border-bottom: none !important }',
  'header .site-nav .quick-menu,',
  'header .site-nav .quick-menu a,',
  'header .site-nav .quick-menu li,',
  'header .site-nav .quick-menu div,',
  'header .site-nav .quick-menu span { color: #2B2B2B !important }',
  'header .s_input { background: #fff !important; border: 1px solid #E5E2DA !important; border-radius: 14px !important; color: #2B2B2B !important }',
  // 黑色结果标题行（AI 营销入口）与筛选行隐藏 —— Kitchen 界面没有这些
  '.block-sub-banner, .block-search-filter { display: none !important }',
  // 页面背景
  'body, .inmain, .page-manage-container, .wrap { background: #FAF9F6 !important }',
  // 广告位与页脚隐藏
  '.page-search-container > img, .footer { display: none !important }',
  // Kitchen 式网格：白底 + 细网格线，无卡片描边
  '.page-search-container .block-icon-list { display: grid !important; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)) !important; gap: 0 !important; padding: 0 !important; background: #fff !important; border: 1px solid #ECE9E1 !important }',
  '.page-search-container .block-icon-list > li { background: #fff !important; border: 0 !important; border-right: 1px solid #F0EDE6 !important; border-bottom: 1px solid #F0EDE6 !important; border-radius: 0 !important }',
  '.page-search-container .block-icon-list > li:hover { background: #F5F0FA !important }',
  // 分页浅色化 + 主题紫
  '.block-pagination-wrap { background: #FAF9F6 !important }',
  '.block-pagination li.active, .block-pagination li.active a { background: #6B21A8 !important; color: #fff !important }',
  '.block-pagination li a { color: #444 !important }',
  '.block-pagination .total { color: #666 !important }',
  // 顶部标签栏（JS 注入到 header 之后）
  "#inkline-tabs { display: flex; background: #EDEAE1; border-bottom: 1px solid #E5E2DA; font-family: -apple-system, 'PingFang SC', sans-serif }",
  '#inkline-tabs .itab { flex: 1; text-align: center; padding: 13px 0; font-size: 14px; color: #555; cursor: pointer; user-select: none }',
  '#inkline-tabs .itab:hover { color: #6B21A8 }',
  '#inkline-tabs .itab.active { background: #FAF9F6; color: #6B21A8; font-weight: 600 }',
].join('\n')

// ---------- 官网模式注入脚本 ----------
// 作用：① 底部注入 Inkline 操作条（插入模式开关 / 尺寸 / 返回本地）
//      ② 插入模式开启时，点击官网任意图标卡片 = 抓取该卡片内联 SVG 送进画布
// 实测 iconfont 搜索结果卡片结构：li.J_icon_id_<id> > div.icon-twrap > svg.icon
// （viewBox 0 0 1024 1024，内联含完整 path，无需逆向接口）
// 名称在 .icon-name[title]；多色图标的颜色在 path 的 fill 属性上。
// 自愈：页面内 2s 定时器重建 UI（SPA 路由切换 / 站点重渲染都不丢）；插件侧另有重注入兜底。
const ICONFONT_INJECT_RAW = [
  '(function(){',
  '  if (window.__inklineReady) { window.__inklineShow && window.__inklineShow(); return }',
  '  window.__inklineReady = true',
  '  window.__inklineInsertMode = true',
  '  window.__inklineSize = 32',
  // ---- 样式：界面装修 + 插入模式（hover 时紫色描边 + 十字光标，网格线下常显描边太重）----
  '  function addStyle(){',
  '    if (document.getElementById("inkline-style")) return',
  '    var s = document.createElement("style")',
  '    s.id = "inkline-style"',
  '    s.textContent = window.__inklineDecorCss + "\\nhtml.inkline-insert li[class*=\\"J_icon_id_\\"]{cursor:crosshair !important}\\nhtml.inkline-insert li[class*=\\"J_icon_id_\\"]:hover{outline:2px solid #6B21A8 !important;outline-offset:-2px;background:#EFE7F8 !important}"',
  '    document.documentElement.appendChild(s)',
  '  }',
  '  function syncModeClass(){',
  '    var root = document.documentElement',
  '    if (window.__inklineInsertMode) root.classList.add("inkline-insert")',
  '    else root.classList.remove("inkline-insert")',
  '  }',
  // ---- 抓取卡片内联 SVG，规整成可导入 Sketch 的 SVG ----
  '  function buildSvg(li){',
  '    var svg = li.querySelector("svg.icon") || li.querySelector("svg")',
  '    if (!svg) return null',
  '    var clone = svg.cloneNode(true)',
  '    clone.removeAttribute("style")',
  '    clone.removeAttribute("class")',
  '    var vb = (clone.getAttribute("viewBox") || "").split(/[\\s,]+/).map(Number)',
  '    var w = (vb.length === 4 && vb[2] > 0) ? vb[2] : 1024',
  '    var h = (vb.length === 4 && vb[3] > 0) ? vb[3] : 1024',
  '    var colored = false',
  '    var nodes = clone.querySelectorAll("[fill]")',
  '    for (var i = 0; i < nodes.length; i++) {',
  '      var f = nodes[i].getAttribute("fill")',
  '      if (f && f !== "none" && f !== "currentColor") { colored = true; break }',
  '    }',
  '    if (!clone.getAttribute("viewBox")) clone.setAttribute("viewBox", "0 0 " + w + " " + h)',
  '    clone.setAttribute("width", String(w))',
  '    clone.setAttribute("height", String(h))',
  '    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg")',
  '    if (!colored) clone.setAttribute("fill", "#1F1F1F")',
  '    return clone.outerHTML',
  '  }',
  '  function iconName(li){',
  '    var n = li.querySelector(".icon-name")',
  '    var t = n ? (n.getAttribute("title") || n.textContent || "") : ""',
  '    t = String(t).trim()',
  '    if (t) return t',
  '    var m = /J_icon_id_(\\d+)/.exec(li.className || "")',
  '    return m ? "iconfont-" + m[1] : "iconfont"',
  '  }',
  '  function insert(li){',
  '    var svg = buildSvg(li)',
  '    if (!svg) return',
  '    try {',
  '      window.postMessage("insertIcon", JSON.stringify({ svg: svg, name: iconName(li), size: window.__inklineSize }))',
  '    } catch (e) { /* ignore */ }',
  '  }',
  // ---- 插入模式：捕获阶段拦下点击，阻止官网自己的详情弹窗/购物车 ----
  '  function findCard(el){',
  '    return (el && el.closest) ? el.closest("li[class*=\'J_icon_id_\']") : null',
  '  }',
  '  document.addEventListener("mousedown", function(e){',
  '    if (!window.__inklineInsertMode) return',
  '    var li = findCard(e.target)',
  '    if (!li) return',
  '    e.preventDefault(); e.stopPropagation()',
  '  }, true)',
  '  document.addEventListener("click", function(e){',
  '    if (!window.__inklineInsertMode) return',
  '    if (e.target && e.target.closest && e.target.closest("#inkline-bar")) return',
  '    var li = findCard(e.target)',
  '    if (!li) return',
  '    e.preventDefault(); e.stopPropagation()',
  '    insert(li)',
  '  }, true)',
  // ---- 底部操作条 ----
  '  var SIZES = [16, 24, 32, 48, 64]',
  '  function btn(label, opts){',
  '    var b = document.createElement("button")',
  '    b.textContent = label',
  '    b.style.cssText = "border:none;border-radius:12px;padding:5px 10px;font-size:12px;cursor:pointer;' +
    'font-family:inherit;background:rgba(255,255,255,.14);color:#fff"',
  '    if (opts && opts.title) b.title = opts.title',
  '    if (opts && opts.on) b.style.background = "#6B21A8"',
  '    return b',
  '  }',
  // ---- 顶部标签栏（Kitchen 式）：图标库 / 我的项目 / 我的收藏 ----
  // 插入 header 之后（文档流内），active 按 URL 判定；自愈定时器保证路由切换后重建
  '  var TABS = [',
  '    ["图标库", "https://www.iconfont.cn/search/index?searchType=icon", "searchType=icon"],',
  '    ["我的项目", "https://www.iconfont.cn/manage/index?manage_type=myprojects", "manage_type=myprojects"],',
  '    ["我的收藏", "https://www.iconfont.cn/collections", "collections"]',
  '  ]',
  '  function buildTabs(){',
  '    var old = document.getElementById("inkline-tabs")',
  '    if (old) old.parentNode.removeChild(old)',
  '    var header = document.querySelector("header")',
  '    if (!header || !document.body) return',
  '    var bar = document.createElement("div")',
  '    bar.id = "inkline-tabs"',
  '    var cur = location.href',
  '    TABS.forEach(function(t){',
  '      var d = document.createElement("div")',
  '      d.className = "itab" + (cur.indexOf(t[2]) !== -1 ? " active" : "")',
  '      d.textContent = t[0]',
  '      d.onclick = function(){ if (cur.indexOf(t[2]) === -1) location.href = t[1] }',
  '      bar.appendChild(d)',
  '    })',
  '    header.parentNode.insertBefore(bar, header.nextSibling)',
  '  }',
  '  function buildBar(){',
  '    var old = document.getElementById("inkline-bar")',
  '    if (old) old.parentNode.removeChild(old)',
  '    if (!document.body) return',
  '    var bar = document.createElement("div")',
  '    bar.id = "inkline-bar"',
  '    bar.style.cssText = "position:fixed;left:12px;bottom:16px;z-index:2147483647;display:flex;align-items:center;' +
      'gap:6px;background:rgba(31,31,31,.88);border-radius:16px;padding:6px 10px;' +
      'font-family:-apple-system,\'PingFang SC\',sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.28)"',
  '    var mode = btn(window.__inklineInsertMode ? "插入模式：开" : "插入模式：关",',
  '      { title: "开启后，点击官网任意图标即插入 Sketch 画布", on: window.__inklineInsertMode })',
  '    mode.onclick = function(){',
  '      window.__inklineInsertMode = !window.__inklineInsertMode',
  '      syncModeClass(); buildBar()',
  '    }',
  '    bar.appendChild(mode)',
  '    var sep = document.createElement("span")',
  '    sep.textContent = "尺寸"',
  '    sep.style.cssText = "color:rgba(255,255,255,.5);font-size:11px;margin-left:2px"',
  '    bar.appendChild(sep)',
  '    SIZES.forEach(function(sz){',
  '      var b = btn(String(sz), { on: window.__inklineSize === sz })',
  '      b.onclick = function(){ window.__inklineSize = sz; buildBar() }',
  '      bar.appendChild(b)',
  '    })',
  '    var back = btn("‹ 返回本地搜索", { title: "返回 Inkline 本地图标搜索（Iconify）" })',
  '    back.style.background = "rgba(192,57,43,.85)"',
  '    back.onclick = function(){ window.postMessage("gotoLocal", "") }',
  '    bar.appendChild(back)',
  '    document.body.appendChild(bar)',
  '  }',
  '  window.__inklineShow = function(){',
  '    try { addStyle(); syncModeClass(); if (!document.getElementById("inkline-tabs")) buildTabs(); if (!document.getElementById("inkline-bar")) buildBar() } catch (e) { /* ignore */ }',
  '  }',
  '  window.__inklineShow()',
  '  if (!window.__inklineTimer) {',
  '    window.__inklineTimer = setInterval(function(){',
  '      if (!document.getElementById("inkline-bar")) window.__inklineShow()',
  '    }, 2000)',
  '  }',
  '})()'
].join('\n')

// 装修 CSS 先送进页面（注入脚本 addStyle 读取 window.__inklineDecorCss）
const ICONFONT_INJECT =
  'window.__inklineDecorCss = ' + JSON.stringify(DECOR_CSS) + ';\n' + ICONFONT_INJECT_RAW

// 模块级窗口引用：开关切换用。严禁用 getWebview(identifier) 查找——
// 它会重建 NavigationDelegate，在 Sketch 2026 上直接抛 Obj-C 异常
let iconWin = null

// 官网模式的注入定时器（进入本地模式或窗口关闭时清理）
let injectTimer = null

// 连续插入的错位计数（避免多个图标叠在同一点）
let insertCount = 0

function clearInjectTimer() {
  if (injectTimer) {
    clearInterval(injectTimer)
    injectTimer = null
  }
}

// 反复注入官网脚本：页面自带自愈定时器，这里只做整页重载后的兜底。
// executeJavaScript 是幂等的（脚本内 __inklineReady 守卫），重复调用只是重刷 UI。
function startInjectLoop(win) {
  clearInjectTimer()
  const run = function () {
    try {
      win.webContents.executeJavaScript(ICONFONT_INJECT)
    } catch (e) { /* ignore */ }
  }
  setTimeout(run, 1200)
  setTimeout(run, 3000)
  injectTimer = setInterval(run, 4000)
}

export function openIconLibrary() {
  if (iconWin) {
    // 再点一次图标按钮 = 关闭图标库
    try { iconWin.close() } catch (e) { /* ignore */ }
    iconWin = null
    return
  }

  const browserWindow = new BrowserWindow({
    // v2：Kitchen 式窄窗口（改尺寸需换 identifier，否则 remembersWindowFrame 记忆的旧尺寸会覆盖）
    identifier: 'inkline.icons.v2',
    width: 420,
    height: 680,
    minWidth: 360,
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

  // 跟随 Sketch：最小化 → 图标库一起隐藏；关闭全部文档 → 图标库一起关闭
  const disposeFollow = attachFollow(browserWindow)

  browserWindow.on('closed', function () {
    if (iconWin === browserWindow) iconWin = null
    clearInjectTimer()
    disposeFollow()
  })

  const webContents = browserWindow.webContents
  webContents.on('insertIcon', function (payload) {
    try {
      insertSvg(payload)
    } catch (e) {
      UI.alert('Inkline 出错了', String(e && e.message ? e.message : e))
    }
  })

  // ---------- 双模式切换 ----------
  // 官网模式：同一窗口直接 loadURL iconfont.cn（Cookie/登录态原生保留），
  // 注入操作条 + 插入能力：页面内 2s 自愈 + 插件侧 4s 重注入兜底（防站点整页重载丢脚本）
  webContents.on('gotoIconfont', function () {
    try {
      browserWindow.loadURL(ICONFONT_URL)
      startInjectLoop(browserWindow)
    } catch (e) {
      toast('打开 iconfont 官网失败：' + (e.message || e))
    }
  })
  // 官网 → 本地：操作条上的返回按钮
  webContents.on('gotoLocal', function () {
    clearInjectTimer()
    try {
      browserWindow.loadURL(require('./resources/icons.html'))
    } catch (e) { /* ignore */ }
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
  // 连续插入时逐个错位，避免完全重叠在同一个点上
  const step = insertCount % 8
  insertCount++
  const dx = step * 8
  const dy = step * 8
  layer.frame = new Rectangle(
    Math.round(cx - w / 2) + dx,
    Math.round(cy - h / 2) + dy,
    Math.round(w),
    Math.round(h)
  )
  layer.name = 'icon-' + String(data.name || 'svg')
  toast('图标已插入画布 ✅')
}
