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
  // 上传/语言切换在窄窗口挤占空间，隐藏（购物车/头像/消息/登录进左下抽屉）
  '.quick-menu > ul > li:has(> a.upload), .quick-menu > ul > li:has(> .lang-btn) { display: none !important }',
  // —— 左下抽屉（购物车/头像/消息/登录）——
  // 铁律：官网是 Magix 框架，视图元素一旦被 JS 改 DOM/内联样式就可能失绑，
  // 必须纯 CSS 定位：收起态隐藏，展开态（html.inkline-drawer-open）由
  // buildDrawer 动态生成的 nth-child 规则钉到左下角（位置随登录态自动重算）
  'html:not(.inkline-drawer-open) .quick-menu > ul > li:not(.head-search):not(#inkline-sizes) { display: none !important }',
  // z-index 必须低于官网 header 的 2048（header 自带层叠上下文，里面的 li 出不去），
  // 否则胶囊背景会盖在 li 圆钮的白色图标上（实测白色被 92% 黑罩染成深灰，图标"消失"）
  '#inkline-drawer { position: fixed; left: 12px; bottom: 16px; z-index: 2000; pointer-events: none; font-family: -apple-system, "PingFang SC", sans-serif }',
  '#inkline-drawer-handle { width: 36px; height: 36px; border-radius: 50%; background: rgba(31,31,31,.92); color: #FAF9F6; font-size: 15px; text-align: center; line-height: 36px; cursor: pointer; box-shadow: 0 2px 10px rgba(0,0,0,.25); pointer-events: auto }',
  '#inkline-drawer-pill { display: none; position: absolute; left: 0; bottom: 0; height: 36px; border-radius: 18px; background: rgba(31,31,31,.92); box-shadow: 0 2px 10px rgba(0,0,0,.25) }',
  'html.inkline-drawer-open #inkline-drawer-handle { display: none }',
  'html.inkline-drawer-open #inkline-drawer-pill { display: block }',
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
  // —— Kitchen 式网格：白底 + 细网格线，无卡片描边，紧凑 6 列 + 缩图标 + 去名称 ——
  '.page-search-container .block-icon-list { display: grid !important; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)) !important; gap: 0 !important; padding: 0 !important; background: #fff !important; border-top: 1px solid #ECE9E1 !important }',
  '.page-search-container .block-icon-list > li { background: #fff !important; border: 0 !important; border-right: 1px solid #F0EDE6 !important; border-bottom: 1px solid #F0EDE6 !important; border-radius: 0 !important; padding: 10px 0 !important; text-align: center !important }',
  '.page-search-container .block-icon-list > li:hover { background: #F0F5FE !important }',
  '.page-search-container .block-icon-list .icon-name { display: none !important }',
  '.page-search-container .block-icon-list .icon-twrap { width: 28px !important; height: 28px !important }',
  '.page-search-container .block-icon-list li svg.icon { width: 28px !important; height: 28px !important }',
  // —— 收藏浮层：官网 hover 弹出的深色大 overlay（购物车/收藏/下载三大按钮）——
  // 改为右上角一个小圆钮，只留收藏；显示改用我们自己的 CSS :hover（官网是 JS 控制的，不依赖）
  '.page-search-container .block-icon-list li .icon-cover { position: absolute !important; top: 3px !important; right: 3px !important; left: auto !important; bottom: auto !important; width: auto !important; height: auto !important; background: none !important; padding: 0 !important; margin: 0 !important; display: none !important; z-index: 3 !important }',
  '.page-search-container .block-icon-list li:hover .icon-cover { display: block !important }',
  '.page-search-container .block-icon-list li .icon-cover .cover-item { display: none !important }',
  '.page-search-container .block-icon-list li .icon-cover .cover-item[title="收藏"] { display: flex !important; align-items: center; justify-content: center; width: 20px !important; height: 20px !important; font-size: 11px !important; color: #666 !important; background: rgba(255,255,255,.95) !important; border: 1px solid #E5E2DA !important; border-radius: 50% !important; cursor: pointer; box-sizing: border-box }',
  '.page-search-container .block-icon-list li .icon-cover .cover-item[title="收藏"]:hover { color: ' + BLUE + ' !important; border-color: ' + BLUE + ' !important }',
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
//          + 左下抽屉（购物车/头像/消息/登录，纯 CSS 定位，点外/滚动自动收起）
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
  // —— 抽屉收起：点击抽屉/官网弹层之外自动收起（必须注册在下面插入拦截之前，
  //    否则插入拦截 capture 阶段 stopPropagation 会把这里吞掉）——
  '  document.addEventListener("click", function(e){',
  '    if (!document.documentElement.classList.contains("inkline-drawer-open")) return',
  '    var t = e.target',
  '    if (t && t.closest && (t.closest("#inkline-drawer") || t.closest("[class*=\\"dropdown\\"]") || t.closest("[class*=\\"car-\\"]"))) return',
  '    document.documentElement.classList.remove("inkline-drawer-open")',
  '  }, true)',
  '  window.addEventListener("scroll", function(){',
  '    document.documentElement.classList.remove("inkline-drawer-open")',
  '  }, true)',
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
  '    if (e.target && e.target.closest && e.target.closest(".icon-cover")) return',
  '    var li = findCard(e.target)',
  '    if (!li) return',
  '    e.preventDefault(); e.stopPropagation()',
  '  }, true)',
  '  document.addEventListener("click", function(e){',
  '    if (!window.__inklineInsertMode) return',
  '    if (e.target && e.target.closest && e.target.closest("#inkline-top")) return',
  '    if (e.target && e.target.closest && e.target.closest(".icon-cover")) return',
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
  // ---- 左下抽屉：购物车/头像/消息/登录 ----
  // 官网是 Magix 框架：视图元素被 JS 移动/改内联样式后会失绑（实测 toggleCar 失效），
  // 所以只做两件不碰视图 DOM 的事：① 我们自己的把手/胶囊元素 ② 动态生成纯 CSS 定位规则
  '  function drawerItems(){',
  '    var lis = document.querySelectorAll(".quick-menu > ul > li")',
  '    var out = []',
  '    for (var i = 0; i < lis.length; i++) {',
  '      var li = lis[i]',
  '      if (li.className.indexOf("head-search") !== -1) continue',
  '      if (li.id === "inkline-sizes") continue',
  '      if (li.querySelector("a.upload") || li.querySelector(".lang-btn")) continue',
  '      out.push(i)',
  '    }',
  '    return out',
  '  }',
  '  function refreshDrawerPos(){',
  '    var old = document.getElementById("inkline-drawer-pos")',
  '    if (old) old.parentNode.removeChild(old)',
  '    var idxs = drawerItems()',
  '    if (!idxs.length) return',
  '    var rules = []',
  '    for (var k = 0; k < idxs.length; k++) {',
  '      var li = document.querySelectorAll(".quick-menu > ul > li")[idxs[k]]',
  '      var n = idxs[k] + 1',
  '      var isSignin = !!li.querySelector("a.signin")',
  '      var box = isSignin ? "width:auto !important;min-width:36px !important;border-radius:18px !important;padding:0 10px !important;height:36px !important" : "width:36px !important;height:36px !important;border-radius:50% !important"',
  '      var base = "html.inkline-drawer-open .quick-menu > ul > li:nth-child(" + n + ")"',
  '      rules.push(base + "{position:fixed !important;bottom:16px !important;top:auto !important;left:" + (12 + k * 44) + "px !important;display:flex !important;align-items:center;justify-content:center;margin:0 !important;background:rgba(31,31,31,.92);z-index:2147483646;cursor:pointer;" + box + "}")',
  '      rules.push(base + " .iconfont, " + base + " a.signin{color:#fff !important}")',
  // 官网 hover 弹窗（消息/头像的 .head-dropdown / .head-dropdown-tips）默认在 li 下方
  // （top:53px），抽屉在窗口底部会被整个顶出屏幕外（只剩一条黑边）——改到抽屉上方弹出
  '      rules.push(base + " .head-dropdown, " + base + " .head-dropdown-tips { top: auto !important; bottom: 100% !important; margin-bottom: 4px !important; left: 0 !important; right: auto !important }")',
  // 弹窗文字必须改浅色：装修规则把 quick-menu 内文字染成了深色，压在深色弹窗上看不见
  '      rules.push(base + " .head-dropdown *, " + base + " .head-dropdown-tips * { color: #E6E6E6 !important }")',
  '    }',
  '    var st = document.createElement("style")',
  '    st.id = "inkline-drawer-pos"',
  '    st.textContent = rules.join("\\n")',
  '    document.head.appendChild(st)',
  '  }',
  '  function buildDrawer(){',
  '    var old = document.getElementById("inkline-drawer")',
  '    if (old) old.parentNode.removeChild(old)',
  '    if (!document.body) return',
  '    var d = document.createElement("div")',
  '    d.id = "inkline-drawer"',
  '    var pill = document.createElement("div")',
  '    pill.id = "inkline-drawer-pill"',
  '    var handle = document.createElement("div")',
  '    handle.id = "inkline-drawer-handle"',
  '    handle.textContent = "⋯"',
  '    handle.title = "购物车 / 消息 / 头像"',
  '    d.appendChild(pill)',
  '    d.appendChild(handle)',
  '    document.body.appendChild(d)',
  '    handle.onclick = function(){',
  '      refreshDrawerPos()',
  '      var idxs = drawerItems()',
  '      if (!idxs.length) return',
  '      document.documentElement.classList.add("inkline-drawer-open")',
  '      // 胶囊宽度按实际内容测量（登录态/未登录态 li 宽度差异大，固定值会装不下）',
  '      requestAnimationFrame(function(){',
  '        try {',
  '          var lis = document.querySelectorAll(".quick-menu > ul > li")',
  '          var last = lis[idxs[idxs.length - 1]]',
  '          if (last) pill.style.width = Math.ceil(last.getBoundingClientRect().right - 12 + 8) + "px"',
  '        } catch (e) { /* ignore */ }',
  '      })',
  '    }',
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
  '      if (!document.getElementById("inkline-drawer")) buildDrawer()',
  '      refreshDrawerPos()',
  '      if (!document.getElementById("inkline-tabs")) buildTabs()',
  '    } catch (e) { /* ignore */ }',
  '  }',
  '  window.__inklineShow()',
  '  if (!window.__inklineTimer) {',
  '    window.__inklineTimer = setInterval(function(){',
  '      if (!document.getElementById("inkline-top") || !document.getElementById("inkline-tabs") || !document.getElementById("inkline-drawer")) window.__inklineShow()',
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
// 视口中心（页面坐标）：镜头当前看向的位置。
// 经验公式（Sketch 插件社区）：真实滚动原点 = -scrollOrigin / zoomValue，
// 视口尺寸 = 画布视图 frame / zoomValue。全程防御，取不到返回 null。
function visibleCenter(doc) {
  try {
    const sk = doc.sketchObject
    const view = typeof sk.currentView === 'function' ? sk.currentView() : sk.currentView
    if (!view) return null
    const so = typeof view.scrollOrigin === 'function' ? view.scrollOrigin() : view.scrollOrigin
    if (!so) return null
    const zoom = Number(typeof sk.zoomValue === 'function' ? sk.zoomValue() : sk.zoomValue) || 1
    const f = typeof view.frame === 'function' ? view.frame() : view.frame
    const size = f && f.size ? f.size : f
    const w = Number(size && size.width)
    const h = Number(size && size.height)
    if (!(w > 0 && h > 0) || !(zoom > 0)) return null
    return { x: (-Number(so.x) + w / 2) / zoom, y: (-Number(so.y) + h / 2) / zoom }
  } catch (e) {
    return null
  }
}

// 插入目标：① 选中画板/选中图层所在画板（用户显式选择）
// ② 镜头中心所在的画板；镜头不在任何画板上时直接落在镜头中心（页面级）
// ③ 聚焦画板（currentArtboard 兜底） ④ 第一个画板 ⑤ 当前页
// 返回 { host, pt }：pt 为页面绝对坐标落点；null 表示用 host 自身中心
function pickTarget(doc) {
  const boards = (doc.selectedPage.layers || []).filter(function (l) {
    return l.type === 'Artboard' || l.type === 'Frame'
  })
  // ① 选中
  try {
    const sel = doc.selectedLayers.layers
    if (sel.length) {
      const s = sel[0]
      let ab = null
      if (s.type === 'Artboard' || s.type === 'Frame') ab = s
      else if (s.getParentArtboard) ab = s.getParentArtboard()
      if (ab) return { host: ab, pt: null }
    }
  } catch (e) { /* ignore */ }
  // ② 镜头中心
  try {
    const vp = visibleCenter(doc)
    if (vp) {
      let hit = null
      for (let i = 0; i < boards.length; i++) {
        const f = boards[i].frame
        if (vp.x >= f.x && vp.x <= f.x + f.width && vp.y >= f.y && vp.y <= f.y + f.height) {
          hit = boards[i]
          break
        }
      }
      // 镜头在画板内 → 插到该画板的镜头处；在画板外空白 → 直接落在页面镜头中心
      return { host: hit || doc.selectedPage, pt: vp }
    }
  } catch (e) { /* ignore */ }
  // ③ 聚焦画板（双击进入的画板）
  try {
    const pageSk = doc.selectedPage.sketchObject
    let raw = typeof pageSk.currentArtboard === 'function' ? pageSk.currentArtboard() : pageSk.currentArtboard
    if (!raw) {
      const view = typeof doc.sketchObject.currentView === 'function' ? doc.sketchObject.currentView() : doc.sketchObject.currentView
      raw = view && (typeof view.currentArtboard === 'function' ? view.currentArtboard() : view.currentArtboard)
    }
    if (raw) {
      const focused = require('sketch').fromSketchObject(raw)
      if (focused && (focused.type === 'Artboard' || focused.type === 'Frame')) return { host: focused, pt: null }
    }
  } catch (e) { /* ignore */ }
  // ④ 第一个画板 ⑤ 当前页
  if (boards.length) return { host: boards[0], pt: null }
  return { host: doc.selectedPage, pt: null }
}

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

  // 插入目标与落点
  const t = pickTarget(doc)
  const host = t.host
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
  // 落点中心（宿主局部坐标）：pt 有值 = 镜头处（页面绝对坐标转宿主局部）；否则宿主中心
  let cx, cy
  if (t.pt) {
    const isBoard = host.type === 'Artboard' || host.type === 'Frame'
    cx = isBoard ? t.pt.x - host.frame.x : t.pt.x
    cy = isBoard ? t.pt.y - host.frame.y : t.pt.y
  } else if (host.type === 'Artboard' || host.type === 'Frame') {
    cx = host.frame.width / 2
    cy = host.frame.height / 2
  } else {
    cx = 120
    cy = 120
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
  // 选中 + 画布镜头定位到新图标：无论画布当前滚到哪，插入后一眼看到落点
  try {
    doc.selectedLayers.layers = [layer]
  } catch (e) { /* ignore */ }
  try {
    doc.centerOnLayer(layer)
  } catch (e) { /* ignore */ }
  toast('图标已插入画布 ✅')
}
