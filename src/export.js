import sketch, { getSelectedDocument } from 'sketch'
import { toast } from './panel-ref.js'
import { PREFIX, absRect } from './util.js'

function stamp() {
  const d = new Date()
  const p = function (n) { return (n < 10 ? '0' : '') + n }
  return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
}

function fileExists(p) {
  return NSFileManager.defaultManager().fileExistsAtPath_(p)
}

function readBase64(p) {
  const d = NSData.dataWithContentsOfFile_(p)
  if (!d) return null
  return '' + d.base64EncodedStringWithOptions_(0)
}

function writeText(path, str) {
  NSString.stringWithString(str).writeToFile_atomically_encoding_error_(path, true, 4, nil)
}

function collectLayers(layer, origin, out, stats) {
  const kids = layer.layers || []
  kids.forEach(function (k) { collectLayers(k, origin, out, stats) })
  if (layer.type === 'Artboard' || layer.type === 'Page' || layer.type === 'SymbolMaster') return
  if (layer.name.indexOf(PREFIX) === 0) return // 跳过标注层
  const r = absRect(layer)
  const info = {
    n: layer.name,
    t: layer.type,
    x: Math.round(r.x - origin.x),
    y: Math.round(r.y - origin.y),
    w: Math.round(r.w),
    h: Math.round(r.h)
  }
  if (info.w <= 0 || info.h <= 0) return
  try {
    if (layer.style.opacity < 1) info.o = Math.round(layer.style.opacity * 100)
  } catch (e) { /* ignore */ }
  try {
    info.f = layer.style.fills
      .filter(function (f) { return f.enabled !== false && f.fillType === 'Color' })
      .map(function (f) { return f.color.slice(0, 7) })
    info.bd = layer.style.borders
      .filter(function (f) { return f.enabled !== false && f.fillType === 'Color' })
      .map(function (f) { return f.color.slice(0, 7) })
  } catch (e) { /* ignore */ }
  try {
    let cr = 0
    if (layer.points && layer.points.length) {
      layer.points.forEach(function (pt) { if (pt.cornerRadius > cr) cr = pt.cornerRadius })
    }
    if (cr > 0) info.rad = Math.round(cr)
  } catch (e) { /* ignore */ }
  if (layer.type === 'Text') {
    try {
      const st = layer.style
      info.tx = {
        fo: st.fontFamily || '',
        fs: st.fontSize || 0,
        lh: st.lineHeight || 0,
        c: st.textColor ? String(st.textColor).slice(0, 7) : '',
        s: String(layer.text).slice(0, 200)
      }
    } catch (e) { /* ignore */ }
  }
  // 全局规范统计：颜色 + 字体
  if (stats) {
    (info.f || []).concat(info.bd || []).forEach(function (c) {
      const k = c.toUpperCase()
      stats.colors[k] = (stats.colors[k] || 0) + 1
    })
    if (info.tx && info.tx.fs) {
      const k = [info.tx.fo || '默认字体', Math.round(info.tx.fs), Math.round(info.tx.lh || 0), (info.tx.c || '').toUpperCase()].join('|')
      stats.fonts[k] = (stats.fonts[k] || 0) + 1
      if (info.tx.c) {
        const ck = info.tx.c.toUpperCase()
        stats.colors[ck] = (stats.colors[ck] || 0) + 1
      }
    }
  }
  out.push(info)
}

export function exportSpec() {
  const doc = getSelectedDocument()
  if (!doc) return
  const isBoard = function (l) { return l.type === 'Artboard' || l.type === 'Frame' }
  // 只导出选中的画板，未选中不兜底（用户要求：必须选中画板再导出）
  const arts = doc.selectedLayers.layers.filter(isBoard)
  if (!arts.length) {
    toast('请选中画板导出规范')
    return
  }

  // 让用户选择保存位置（Kitchen 式：可选目录 + 自定义文件夹名）
  const panel = NSSavePanel.savePanel()
  panel.setTitle_('导出 Inkline 设计规范')
  panel.setNameFieldStringValue_('Inkline-Spec-' + stamp())
  panel.setCanCreateDirectories_(true)
  panel.setDirectoryURL_(NSURL.fileURLWithPath_(NSHomeDirectory() + '/Desktop'))
  const res = panel.runModal()
  if (Number(res) !== 1) {
    toast('已取消导出')
    return
  }
  const folder = '' + panel.URL().path()
  NSFileManager.defaultManager().createDirectoryAtPath_withIntermediateDirectories_attributes_error_(folder, true, nil, nil)

  const data = []
  const stats = { colors: {}, fonts: {} }
  arts.forEach(function (a) {
    const ar = absRect(a)
    // 导出画板 PNG @2x
    let pngPath = null
    try {
      sketch.export(a, {
        output: folder,
        formats: 'png',
        scales: '2',
        'use-id-for-name': true,
        overwriting: true
      })
    } catch (e) { /* ignore */ }
    const candidates = [a.id + '@2x.png', a.id + '@1x.png', a.id + '.png']
    for (let i = 0; i < candidates.length; i++) {
      if (fileExists(folder + '/' + candidates[i])) {
        pngPath = folder + '/' + candidates[i]
        break
      }
    }
    const b64 = pngPath ? readBase64(pngPath) : null
    const layers = []
    collectLayers(a, ar, layers, stats)
    const marks = collectMarks(doc.selectedPage, ar)
    data.push({
      name: a.name,
      w: Math.round(ar.w),
      h: Math.round(ar.h),
      img: b64 ? 'data:image/png;base64,' + b64 : null,
      layers: layers,
      marks: marks
    })
  })

  // 规范清单：颜色按出现次数排序，字体按 字体|字号|行高|颜色 分组
  const colorList = Object.keys(stats.colors)
    .map(function (c) { return { c: c, n: stats.colors[c] } })
    .sort(function (a, b) { return b.n - a.n })
  const fontList = Object.keys(stats.fonts)
    .map(function (k) {
      const p = k.split('|')
      return { fo: p[0], fs: Number(p[1]), lh: Number(p[2]), c: p[3], n: stats.fonts[k] }
    })
    .sort(function (a, b) { return b.n - a.n })

  const html = buildHtml(data, folder, colorList, fontList)
  const htmlPath = folder + '/index.html'
  writeText(htmlPath, html)
  NSWorkspace.sharedWorkspace().openURL_(NSURL.fileURLWithPath(htmlPath))
  toast('已导出 ' + data.length + ' 个画板 → ' + folder)
}

// 收集画板范围内的 Inkline 标注（线条 + 文字标签），用于在规范页中还原
function walkLeaves(layer, out) {
  const kids = layer.layers || []
  if (!kids.length) {
    out.push(layer)
    return
  }
  kids.forEach(function (k) { walkLeaves(k, out) })
}

function collectMarks(page, ar) {
  const marks = []
  page.layers.forEach(function (g) {
    if (g.name.indexOf(PREFIX) !== 0) return
    const leaves = []
    walkLeaves(g, leaves)
    leaves.forEach(function (l) {
      if (l.name === PREFIX + 'card') return // 卡片底框只服务画布阅读，规范页中跳过（文字标签自带白底）
      const r = absRect(l)
      const x1 = Math.max(r.x, ar.x)
      const y1 = Math.max(r.y, ar.y)
      const x2 = Math.min(r.x + r.w, ar.x + ar.w)
      const y2 = Math.min(r.y + r.h, ar.y + ar.h)
      if (x2 - x1 < 1 || y2 - y1 < 1) return
      let color = '#E24B4AFF'
      try {
        const fs = l.style.fills.filter(function (f) { return f.enabled !== false })
        if (fs.length) color = String(fs[0].color) // 保留 8 位 hex 的透明度
      } catch (e) { /* ignore */ }
      const m = {
        x: Math.round(x1 - ar.x),
        y: Math.round(y1 - ar.y),
        w: Math.round(x2 - x1),
        h: Math.round(y2 - y1),
        c: color
      }
      if (l.type === 'Text') {
        m.s = String(l.text)
        try { m.fs = l.style.fontSize || 11 } catch (e) { m.fs = 11 }
      }
      marks.push(m)
    })
  })
  return marks
}

function buildHtml(data, folder, colorList, fontList) {
  const json = JSON.stringify({ arts: data, colors: colorList || [], fonts: fontList || [], time: new Date().toLocaleString(), path: folder }).replace(/</g, '\\u003c')
  return '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<title>Inkline · 墨斗 设计规范</title>\n<style>\n' +
    '*{margin:0;padding:0;box-sizing:border-box}\n' +
    'body{font-family:-apple-system,"PingFang SC",sans-serif;display:flex;height:100vh;background:#FAF9F6;color:#2B2B2B}\n' +
    '#side{width:200px;border-right:1px solid #E5E2DA;overflow:auto;padding:10px}\n' +
    '#side h2{font-size:12px;color:#999;margin:6px 4px;letter-spacing:1px}\n' +
    '.ab{padding:9px 10px;border-radius:8px;cursor:pointer;font-size:13px;margin-bottom:4px;border:1px solid transparent;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n' +
    '.ab:hover{background:#F1EEE6}\n' +
    '.ab.on{background:rgba(56,104,230,0.10);border-color:#3868E6;color:#3868E6;font-weight:600}\n' +
    '#mid{flex:1;display:flex;flex-direction:column;overflow:hidden}\n' +
    '#topbar{padding:12px 18px;border-bottom:1px solid #E5E2DA;display:flex;align-items:center;gap:10px;background:#fff}\n' +
    '#topbar .seal{width:20px;height:20px;background:#C0392B;border-radius:4px;color:#fff;font-size:12px;line-height:20px;text-align:center}\n' +
    '#topbar b{font-size:14px}\n' +
    '#topbar span{font-size:12px;color:#999}\n' +
    '#mkt{margin-left:auto;font-size:12px;padding:5px 12px;border-radius:6px;border:1px solid #E5E2DA;background:#fff;cursor:pointer}\n' +
    '#mkt:hover{background:#F1EEE6}\n' +
    '#stage{flex:1;overflow:auto;padding:30px;display:flex;justify-content:center;align-items:flex-start}\n' +
    '.board{position:relative;box-shadow:0 2px 14px rgba(0,0,0,0.10);background:#fff}\n' +
    '.board img{display:block;width:100%}\n' +
    '.ov{position:absolute;border:1px solid transparent}\n' +
    '.ov:hover{border:1px dashed #C0392B;background:rgba(192,57,43,0.06);cursor:pointer}\n' +
    '.ov.sel{border:1px solid #C0392B;background:rgba(192,57,43,0.08)}\n' +
    '#spec{width:300px;border-left:1px solid #E5E2DA;background:#fff;overflow:auto;padding:16px}\n' +
    '#spec h3{font-size:14px;margin-bottom:2px;word-break:break-all}\n' +
    '#spec .meta{font-size:12px;color:#888;margin-bottom:10px}\n' +
    '.sw{display:inline-block;width:14px;height:14px;border-radius:3px;border:1px solid #DDD;vertical-align:-2px;margin-right:4px}\n' +
    '.row{font-size:12px;margin:5px 0;color:#444}\n' +
    'pre{background:#1F1F1F;color:#D8D8D8;font-size:11px;line-height:1.7;padding:12px;border-radius:8px;margin-top:10px;overflow:auto}\n' +
    '.hint{color:#BBB;font-size:13px;text-align:center;margin-top:40px}\n' +
    '.tab{font-size:12px;padding:5px 14px;border-radius:6px;border:1px solid #E5E2DA;background:#fff;cursor:pointer;margin-left:6px}\n' +
    '.tab:hover{background:#F1EEE6}\n' +
    '.tab.on{background:#3868E6;border-color:#3868E6;color:#fff;font-weight:600}\n' +
    '#palette{flex:1;overflow:auto;padding:30px 40px;display:none}\n' +
    '#palette h3{font-size:15px;margin:24px 0 14px}\n' +
    '#palette h3:first-child{margin-top:0}\n' +
    '.cgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px}\n' +
    '.ccard{background:#fff;border:1px solid #E5E2DA;border-radius:10px;padding:10px;cursor:pointer;transition:transform .1s}\n' +
    '.ccard:hover{transform:translateY(-2px);border-color:#3868E6}\n' +
    '.cchip{height:44px;border-radius:6px;border:1px solid rgba(0,0,0,0.08)}\n' +
    '.cmeta{font-size:12px;margin-top:8px;display:flex;justify-content:space-between;color:#444}\n' +
    '.cmeta b{color:#999;font-weight:500}\n' +
    'table.ftab{width:100%;border-collapse:collapse;background:#fff;border:1px solid #E5E2DA;border-radius:10px;overflow:hidden;font-size:13px}\n' +
    '.ftab th{background:#F1EEE6;text-align:left;padding:9px 12px;font-size:12px;color:#666}\n' +
    '.ftab td{padding:9px 12px;border-top:1px solid #F0EDE5;color:#333}\n' +
    '.ftab .num{color:#999;font-size:12px}\n' +
    '#copied{position:fixed;top:16px;left:50%;transform:translateX(-50%);background:rgba(31,31,31,.92);color:#fff;font-size:12px;padding:6px 14px;border-radius:6px;opacity:0;transition:opacity .2s;pointer-events:none}\n' +
    '#copied.show{opacity:1}\n' +
    '</style>\n</head>\n<body>\n' +
    '<div id="side"><h2>画板</h2><div id="ablist"></div></div>\n' +
    '<div id="mid"><div id="topbar"><span class="seal">墨</span><b>Inkline · 墨斗 设计规范</b><span id="artname"></span><span id="extime"></span><span style="flex:1"></span><button class="tab on" id="tabArt" onclick="showTab(\'art\')">设计稿</button><button class="tab" id="tabColor" onclick="showTab(\'color\')">颜色规范</button><button class="tab" id="tabFont" onclick="showTab(\'font\')">字体规范</button><button id="mkt" onclick="toggleMk()">隐藏标注</button></div><div id="stage"></div><div id="palette"></div></div>\n' +
    '<div id="spec"><div class="hint">点击画板中的图层<br>查看标注与 CSS</div></div>\n' +
    '<div id="copied"></div>\n' +
    '<script>var DATA=' + json + ';</script>\n' +
    '<script>\n' +
    'var arts=DATA.arts,cur=0,selEl=null,SHOWMK=true;\n' +
    'function showTab(t){\n' +
    '  ["art","color","font"].forEach(function(x){var b=document.getElementById("tab"+x.charAt(0).toUpperCase()+x.slice(1));if(b)b.className="tab"+(x===t?" on":"")});\n' +
    '  document.getElementById("stage").style.display=t==="art"?"":"none";\n' +
    '  document.getElementById("spec").style.display=t==="art"?"":"none";\n' +
    '  document.getElementById("mkt").style.display=t==="art"?"":"none";\n' +
    '  var p=document.getElementById("palette");\n' +
    '  if(t==="art"){p.style.display="none";return}\n' +
    '  p.style.display="";\n' +
    '  if(t==="color")renderColors();else renderFonts();\n' +
    '}\n' +
    'function copyHex(c){\n' +
    '  var ta=document.createElement("textarea");ta.value=c;document.body.appendChild(ta);ta.select();\n' +
    '  try{document.execCommand("copy");var t=document.getElementById("copied");t.textContent="已复制 "+c;t.classList.add("show");setTimeout(function(){t.classList.remove("show")},1200)}catch(e){}\n' +
    '  document.body.removeChild(ta);\n' +
    '}\n' +
    'function renderColors(){\n' +
    '  var p=document.getElementById("palette");\n' +
    '  var cs=DATA.colors||[];\n' +
    '  var h="<h3>颜色规范 · "+cs.length+" 色</h3><div class=cgrid>";\n' +
    '  cs.forEach(function(c){h+=\'<div class=ccard onclick="copyHex(\\\'\'+c.c+\'\\\')"><div class=cchip style=background:\'+c.c+\'></div><div class=cmeta><span>\'+c.c+\'</span><b>\'+c.n+\' 次</b></div></div>\'});\n' +
    '  h+="</div>";\n' +
    '  if(!cs.length)h=\'<h3>颜色规范</h3><div class=hint>本页没有收集到颜色</div>\';\n' +
    '  p.innerHTML=h;\n' +
    '}\n' +
    'function renderFonts(){\n' +
    '  var p=document.getElementById("palette");\n' +
    '  var fs=DATA.fonts||[];\n' +
    '  var h="<h3>字体规范 · "+fs.length+" 组</h3>";\n' +
    '  if(fs.length){\n' +
    '    h+=\'<table class=ftab><tr><th>字体</th><th>字号</th><th>行高</th><th>颜色</th><th>使用次数</th></tr>\';\n' +
    '    fs.forEach(function(f){h+="<tr><td>"+esc(f.fo)+"</td><td>"+f.fs+"px</td><td>"+(f.lh?f.lh+"px":"-")+"</td><td>"+(f.c?\'<span class=sw style=background:\'+f.c+\'></span>\'+f.c:"-")+"</td><td class=num>"+f.n+"</td></tr>"});\n' +
    '    h+="</table>";\n' +
    '  } else h+=\'<div class=hint>本页没有收集到字体样式</div>\';\n' +
    '  p.innerHTML=h;\n' +
    '}\n' +
    'function toggleMk(){SHOWMK=!SHOWMK;Array.prototype.forEach.call(document.querySelectorAll(".mk"),function(d){d.style.display=SHOWMK?"":"none"});var b=document.getElementById("mkt");b.textContent=SHOWMK?"隐藏标注":"显示标注";b.style.background=SHOWMK?"":"#3868E6";b.style.color=SHOWMK?"":"#fff"}\n' +
    'function esc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}\n' +
    'function render(){\n' +
    '  var list=document.getElementById("ablist");list.innerHTML="";\n' +
    '  arts.forEach(function(a,i){var d=document.createElement("div");d.className="ab"+(i===cur?" on":"");d.textContent=a.name;d.onclick=function(){cur=i;selEl=null;render()};list.appendChild(d)});\n' +
    '  var a=arts[cur],stage=document.getElementById("stage");stage.innerHTML="";\n' +
    '  document.getElementById("artname").textContent=a.name+" · "+a.w+"×"+a.h+"px · "+a.layers.length+" 图层";\n' +
    '  document.getElementById("extime").textContent="导出于 "+(DATA.time||"")+" · 标注 "+((a.marks||[]).length)+" 处";\n' +
    '  var board=document.createElement("div");board.className="board";board.style.width=a.w+"px";\n' +
    '  if(a.img){var img=document.createElement("img");img.src=a.img;board.appendChild(img)}\n' +
    '  else{board.style.height=a.h+"px";board.style.background="#EFEDE7"}\n' +
    '  a.layers.forEach(function(l,idx){\n' +
    '    var o=document.createElement("div");o.className="ov";o.setAttribute("data-i",idx);\n' +
    '    o.style.left=(l.x/a.w*100)+"%";o.style.top=(l.y/a.h*100)+"%";o.style.width=(l.w/a.w*100)+"%";o.style.height=(l.h/a.h*100)+"%";\n' +
    '    o.onclick=function(){if(selEl)selEl.classList.remove("sel");selEl=o;o.classList.add("sel");show(l)};\n' +
    '    board.appendChild(o);\n' +
    '  });\n' +
    '  (a.marks||[]).forEach(function(m){\n' +
    '    var d=document.createElement("div");d.className="mk";var st="position:absolute;pointer-events:none;";\n' +
    '    if(m.s){\n' +
    '      st+="left:"+m.x+"px;top:"+(m.y-1)+"px;font-size:"+Math.max(10,m.fs||11)+"px;color:"+m.c+";background:rgba(255,255,255,0.92);padding:0 3px;border-radius:3px;white-space:nowrap;line-height:1.3;";\n' +
    '      d.textContent=m.s;\n' +
    '    }else{\n' +
    '      st+="background:"+m.c+";left:"+(m.w<3?m.x-1:m.x)+"px;top:"+(m.h<3?m.y-1:m.y)+"px;width:"+(m.w<3?2:m.w)+"px;height:"+(m.h<3?2:m.h)+"px;";\n' +
    '    }\n' +
    '    d.style.cssText=st;if(!SHOWMK)d.style.display="none";\n' +
    '    board.appendChild(d);\n' +
    '  });\n' +
    '  stage.appendChild(board);\n' +
    '}\n' +
    'function show(l){\n' +
    '  var s=document.getElementById("spec"),h="<h3>"+esc(l.n)+"</h3>";\n' +
    '  h+="<div class=meta>"+esc(l.t)+" · "+l.w+" × "+l.h+"px · ("+l.x+", "+l.y+")</div>";\n' +
    '  (l.f||[]).forEach(function(c){h+="<div class=row><span class=sw style=background:"+c+"></span>填充 "+c+"</div>"});\n' +
    '  (l.bd||[]).forEach(function(c){h+="<div class=row><span class=sw style=background:"+c+"></span>描边 "+c+"</div>"});\n' +
    '  if(l.rad)h+="<div class=row>圆角 "+l.rad+"px</div>";\n' +
    '  if(l.o!==undefined)h+="<div class=row>透明度 "+l.o+"%</div>";\n' +
    '  if(l.tx){h+="<div class=row>"+esc(l.tx.fo)+" "+l.tx.fs+"px"+(l.tx.lh?" / 行高 "+l.tx.lh:"")+"</div>";\n' +
    '    if(l.tx.c)h+="<div class=row><span class=sw style=background:"+l.tx.c+"></span>文字 "+l.tx.c+"</div>";\n' +
    '    if(l.tx.s)h+="<div class=row>内容："+esc(l.tx.s.slice(0,60))+"</div>";}\n' +
    '  var css="";\n' +
    '  css+="width: "+l.w+"px;\\nheight: "+l.h+"px;\\n";\n' +
    '  if(l.f&&l.f.length)css+="background: "+l.f[0]+";\\n";\n' +
    '  if(l.bd&&l.bd.length)css+="border: 1px solid "+l.bd[0]+";\\n";\n' +
    '  if(l.rad)css+="border-radius: "+l.rad+"px;\\n";\n' +
    '  if(l.o!==undefined)css+="opacity: "+(l.o/100)+";\\n";\n' +
    '  if(l.tx){if(l.tx.fo)css+="font-family: "+l.tx.fo+";\\n";if(l.tx.fs)css+="font-size: "+l.tx.fs+"px;\\n";if(l.tx.lh)css+="line-height: "+l.tx.lh+"px;\\n";if(l.tx.c)css+="color: "+l.tx.c+";\\n"}\n' +
    '  h+="<pre>"+esc(css)+"</pre>";\n' +
    '  s.innerHTML=h;\n' +
    '}\n' +
    'render();\n' +
    '</script>\n</body>\n</html>\n'
}
