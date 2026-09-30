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
//    顶部注入 Inkline 顶栏（插入图标开关 + 模式切换按钮），随时切回本地。
//    iconfont 账号登录版（关联我的项目/收藏）列 P1。

const ICONFONT_URL = 'https://www.iconfont.cn/search/index?searchType=icon'

// ---------- 官网模式「装修」样式（Kitchen 式图标库界面）----------
// 隐藏官网的导航/营销/筛选行/广告/页脚，重绘为 Kitchen 式图标库：
// 黑色 Inkline 顶栏（JS 注入）+ 白色搜索行（官网原生搜索框，窄窗口下官网会隐藏它，
// 必须强制唤出）+ 白底标签栏（图标库/我的项目/我的收藏）+ 网格线图标列表。
// 数据与交互（登录、中文搜索、分页）全部是官网原生能力，我们只动外观。
// 类名实测（2026-09-30，agent-browser 420px 视口验证）：
// header>.site-nav(#main-nav/.logo/.btn-site-menu/.quick-menu>ul>li[.head-search/.form_search>.s_input])、
// .block-sub-banner、.block-search-filter、.page-search-container>.block-icon-list>li.J_icon_id_*、
// .block-pagination-wrap、.footer
const BLUE = '#3868E6' // 主色：与顶栏模式按钮同色系（原型图取样 rgb(56,104,230)）
const DECOR_CSS = [
  // —— 官网页头 → 白色搜索行：隐藏汉堡菜单/logo/主导航，44px 压缩 ——
  'header, header .site-nav { background: #FAF9F6 !important }',
  'header .site-nav .btn-site-menu, header .site-nav .logo,',
  'header .site-nav #main-nav, header .site-nav .main-nav-mask { display: none !important }',
  'header .site-nav, .quick-menu, .quick-menu > ul, .quick-menu > ul > li { height: 44px !important; max-height: 44px !important }',
  '.quick-menu { flex: 1 !important; max-width: none !important }',
  '.quick-menu > ul { display: flex !important; align-items: center; width: 100% !important; padding: 0 8px 0 0 !important }',
  '.quick-menu > ul > li { display: flex !important; align-items: center; margin-left: 8px !important; margin-right: 0 !important }',
  // 420px 窄窗口下官网会把搜索框 display:none —— 强制唤出并占满剩余宽度
  'li.head-search { flex: 1 1 0 !important; min-width: 56px !important; margin-left: 12px !important }',
  '.form_search { width: 100% !important; max-width: none !important }',
  '.s_input { background: #fff !important; border: 1px solid #E5E2DA !important; border-radius: 14px !important; color: #2B2B2B !important; width: 100% !important; font-size: 12px !important }',
  // 上传/语言切换在窄窗口挤占空间，隐藏（购物车/头像/消息/登录保留）
  '.quick-menu > ul > li:has(> a.upload), .quick-menu > ul > li:has(> .lang-btn) { display: none !important }',
  '.quick-menu > ul > li a.signin { padding: 2px 3px !important; font-size: 11px !important; color: #2B2B2B !important }',
  'header .site-nav .quick-menu,',
  'header .site-nav .quick-menu a,',
  'header .site-nav .quick-menu li,',
  'header .site-nav .quick-menu div,',
  'header .site-nav .quick-menu span { color: #2B2B2B !important }',
  // —— 黑色 Inkline 顶栏（JS 注入）——
  '#inkline-top { display: flex; align-items: center; height: 44px; background: #1F1F1F; padding: 0 12px; gap: 10px; box-sizing: border-box; font-family: -apple-system, "PingFang SC", sans-serif }',
  '#inkline-top * { box-sizing: border-box }',
  '#inkline-top .seal { width: 22px; height: 22px; background: #C0392B; border-radius: 4px; color: #fff; font-size: 13px; line-height: 22px; text-align: center; font-weight: 600; flex: none }',
  '#inkline-top .ttl { color: #FAF9F6; font-size: 14px; font-weight: 600; flex: 1 }',
  '#inkline-top .lbl { color: #DDD; font-size: 11px; flex: none; cursor: pointer }',
  '#inkline-top .tgl { width: 34px; height: 18px; border-radius: 9px; background: #4A4A4A; position: relative; cursor: pointer; flex: none }',
  '#inkline-top .tgl.on { background: #61C354 }',
  '#inkline-top .tgl i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff }',
  '#inkline-top .tgl.on i { left: 18px }',
  '#inkline-top .mbtn { border-radius: 6px; font-size: 11px; padding: 5px 10px; cursor: pointer; flex: none; white-space: nowrap; border: 1px solid rgba(250,249,246,0.35); background: transparent; color: #DDD; font-family: inherit }',
  '#inkline-top .mbtn:hover { background: rgba(250,249,246,0.15) }',
  '#inkline-top .mbtn.cur { background: ' + BLUE + '; border-color: ' + BLUE + '; color: #fff }',
  '#inkline-top .mbtn.cur:hover { background: #2B55C4 }',
  // —— 尺寸胶囊（注入到 quick-menu 搜索框后）——
  '#inkline-sizes { display: flex; align-items: center; gap: 3px; padding: 0 4px 0 8px; flex: none }',
  '#inkline-sizes .lbl { font-size: 10px; color: #999; margin-right: 2px }',
  '#inkline-sizes .pill { border: 1px solid #E5E2DA; background: #fff; border-radius: 6px; font-size: 11px; padding: 3px 5px; cursor: pointer; color: #666; font-family: inherit }',
  '#inkline-sizes .pill.on { background: rgba(56,104,230,0.08); border-color: ' + BLUE + '; color: ' + BLUE + '; font-weight: 600 }',
  // —— 白底标签栏（图标库/我的项目/我的收藏，蓝字 + 蓝色下划线）——
  '#inkline-tabs { display: flex; background: #fff; border-bottom: 1px solid #ECE9E1; padding: 0 16px; gap: 26px; font-family: -apple-system, "PingFang SC", sans-serif }',
  '#inkline-tabs .itab { position: relative; padding: 12px 0 10px; font-size: 14px; color: #333; cursor: pointer; user-select: none }',
  '#inkline-tabs .itab:hover { color: ' + BLUE + ' }',
  '#inkline-tabs .itab.active { color: ' + BLUE + '; font-weight: 600 }',
  '#inkline-tabs .itab.active::after { content: ""; position: absolute; left: 50%; transform: translateX(-50%); bottom: 0; width: 28px; height: 3px; border-radius: 2px; background: ' + BLUE + ' }',
  // —— 营销横幅/筛选行/页脚隐藏 + 防横向滚动（购物车抽屉是屏幕外绝对定位）——
  '.block-sub-banner, .block-search-filter { display: none !important }',
  'body { overflow-x: hidden !important }',
  'body, .inmain, .page-manage-container, .wrap { background: #FAF9F6 !important }',
  '.page-search-container > img, .footer { display: none !important }',
  // —— Kitchen 式网格：白底 + 细网格线，无卡片描边，5 列自适应 ——
  '.page-search-container .block-icon-list { display: grid !important; grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)) !important; gap: 0 !important; padding: 0 !important; background: #fff !important; border-top: 1px solid #ECE9E1 !important }',
  '.page-search-container .block-icon-list > li { background: #fff !important; border: 0 !important; border-right: 1px solid #F0EDE6 !important; border-bottom: 1px solid #F0EDE6 !important; border-radius: 0 !important }',
  '.page-search-container .block-icon-list > li:hover { background: #F0F5FE !important }',
  // —— 分页浅色化 + 主题蓝 ——
  '.block-pagination-wrap { background: #FAF9F6 !important }',
  '.block-pagination li.active, .block-pagination li.active a { background: ' + BLUE + ' !important; color: #fff !important }',
  '.block-pagination li a { color: #444 !important }',
  '.block-pagination .total { color: #666 !important }',
].join('\n')

// ---------- 官网模式注入脚本 ----------
// 作用：① 顶部注入 Inkline 黑色顶栏（标题 / 插入图标开关 / 模式切换按钮）
//          + 「尺寸」胶囊（插进官网搜索行，跟在原生搜索框后面）
//          + 白底标签栏（图标库/我的项目/我的收藏）
//       ② 插入图标开关开启时，点击官网任意图标卡片 = 抓取该卡片内联 SVG 送进画布
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
  // ---- 样式：界面装修 + 插入模式（hover 时蓝色描边 + 十字光标，网格线下常显描边太重）----
  '  function addStyle(){',
  '    if (document.getElementById("inkline-style")) return',
  '    var s = document.createElement("style")',
  '    s.id = "inkline-style"',
  '    s.textContent = window.__inklineDecorCss + "\\nhtml.inkline-insert li[class*=\\"J_icon_id_\\"]{cursor:crosshair !important}\\nhtml.inkline-insert li[class*=\\"J_icon_id_\\"]:hover{outline:2px solid #3868E6 !important;outline-offset:-2px !important;background:#EDF3FE !important}"',
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
  '    if (e.target && e.target.closest && e.target.closest("#inkline-top")) return',
  '    var li = findCard(e.target)',
  '    if (!li) return',
  '    e.preventDefault(); e.stopPropagation()',
  '    insert(li)',
  '  }, true)',
  // ---- 黑色 Inkline 顶栏（插在官网 header 之前）----
  '  function buildTop(){',
  '    var old = document.getElementById("inkline-top")',
  '    if (old) old.parentNode.removeChild(old)',
  '    var header = document.querySelector("header")',
  '    if (!header) return',
  '    var top = document.createElement("div")',
  '    top.id = "inkline-top"',
  '    top.innerHTML =',
  '      \'<span class="seal">墨</span><span class="ttl">图标库</span>\' +',
  '      \'<span class="lbl">插入图标</span><span class="tgl\' + (window.__inklineInsertMode ? " on" : "") + \'" id="inkline-tgl"><i></i></span>\' +',
  '      \'<button class="mbtn" data-m="local">本地·iconify</button>\' +',
  '      \'<button class="mbtn cur" data-m="if">iconfont·官网</button>\'',
  '    header.parentNode.insertBefore(top, header)',
  '    top.querySelector("#inkline-tgl").onclick = function(){',
  '      window.__inklineInsertMode = !window.__inklineInsertMode',
  '      syncModeClass(); buildTop()',
  '    }',
  '    top.querySelector("[data-m=local]").onclick = function(){ window.postMessage("gotoLocal", "") }',
  '    top.querySelector("[data-m=if]").onclick = function(){',
  '      if (location.href.indexOf("searchType=icon") === -1) location.href = "https://www.iconfont.cn/search/index?searchType=icon"',
  '    }',
  '  }',
  // ---- 「尺寸」胶囊：插进官网搜索行（li.head-search 之后）----
  // 420px 窄窗口官网会隐藏搜索框，DECOR_CSS 已强制唤出；找不到锚点就静默跳过
  '  var SIZES = [16, 24, 32, 48, 64]',
  '  function buildSizes(){',
  '    var old = document.getElementById("inkline-sizes")',
  '    if (old) old.parentNode.removeChild(old)',
  '    var hs = document.querySelector("li.head-search")',
  '    if (!hs || !hs.parentNode) return',
  '    var sz = document.createElement("li")',
  '    sz.id = "inkline-sizes"',
  '    var h = \'<span class="lbl">尺寸</span>\'',
  '    SIZES.forEach(function(p){',
  '      h += \'<button class="pill\' + (window.__inklineSize === p ? " on" : "") + \'" data-s="\' + p + \'">\' + p + \'</button>\'',
  '    })',
  '    sz.innerHTML = h',
  '    hs.parentNode.insertBefore(sz, hs.nextSibling)',
  '    Array.prototype.forEach.call(sz.querySelectorAll(".pill"), function(b){',
  '      b.onclick = function(){',
  '        window.__inklineSize = parseInt(this.getAttribute("data-s"), 10)',
  '        Array.prototype.forEach.call(sz.querySelectorAll(".pill"), function(x){ x.classList.remove("on") })',
  '        this.classList.add("on")',
  '      }',
  '    })',
  '  }',
  // ---- 白底标签栏（Kitchen 式）：图标库 / 我的项目 / 我的收藏 ----
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
  '  window.__inklineShow = function(){',
  '    try {',
  '      addStyle(); syncModeClass()',
  '      if (!document.getElementById("inkline-top")) buildTop()',
  '      if (!document.getElementById("inkline-sizes")) buildSizes()',
  '      if (!document.getElementById("inkline-tabs")) buildTabs()',
  '    } catch (e) { /* ignore */ }',
  '  }',
  '  window.__inklineShow()',
  '  if (!window.__inklineTimer) {',
  '    window.__inklineTimer = setInterval(function(){',
  '      if (!document.getElementById("inkline-top") || !document.getElementById("inkline-tabs")) window.__inklineShow()',
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
