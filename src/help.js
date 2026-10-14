import BrowserWindow from 'sketch-module-web-view'
import { VERSION } from './version.js'
import { isLive } from './util.js'

// 使用帮助：自绘窗口替代系统 UI.alert（原生弹窗图标被系统压到 64pt，Logo 太小）
// 窗口标题已加入 follow.js 的 OUR_TITLES 白名单，最小化不会误触发工具栏隐藏

let helpWin = null
let helpSeq = 0

export default function () {
  if (helpWin) {
    if (isLive(helpWin)) {
      try { helpWin.show() } catch (e) { /* ignore */ }
      return
    }
    helpWin = null // 僵尸引用：丢弃重建
  }

  const win = new BrowserWindow({
    identifier: 'inkline.help.v1.' + (++helpSeq),
    width: 480,
    height: 640,
    resizable: false,
    movable: true,
    title: '墨斗·Inkline · 使用帮助',
    alwaysOnTop: true,
    hidesOnDeactivate: true,
    remembersWindowFrame: false
  })
  helpWin = win
  win.on('closed', function () {
    if (helpWin === win) helpWin = null
  })

  const wc = win.webContents
  wc.on('requestHelp', function () {
    try {
      wc.executeJavaScript('window.__setVersion(' + JSON.stringify(VERSION) + ')')
    } catch (e) { /* ignore */ }
  })
  wc.on('close', function () {
    try { win.close() } catch (e) { /* ignore */ }
  })

  win.once('ready-to-show', function () {
    win.show()
    try { win.setAlwaysOnTop(true, 'floating', 1) } catch (e) { /* ignore */ }
  })
  win.loadURL(require('./resources/help.html'))
}
