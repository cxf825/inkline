// 让插件窗口"跟随 Sketch"——工具栏与图标库共用
//
// 判定用 NSDocumentController 数文档（mainWindow() 会被面板类窗口干扰，不可靠）：
//   没有任何打开的文档        → 关闭窗口
//   有文档但窗口全部最小化     → 隐藏窗口
//   有可见的文档窗口          → 确保窗口显示
//
// 双保险：JS 定时器（150ms 兜底）+ NSWindowWillMiniaturize 等系统通知（即时响应）。
// 关键：WillMiniaturize 在最小化精灵动画开始【前】触发，窗口即时隐藏，
// 不必等 DidMiniaturize（那是动画结束后约 0.3-0.5s 才发）。

// 我们自己的窗口标题：这些窗口的最小化/关闭不应影响跟随判定
const OUR_TITLES = ['Inkline · 墨斗', 'Inkline 图标库', 'Inkline · 自定义词库', 'Inkline']

export function docWindowState() {
  const docs = NSDocumentController.sharedDocumentController().documents()
  const n = docs.count()
  if (n === 0) return 'none'
  for (let i = 0; i < n; i++) {
    const wcs = docs.objectAtIndex(i).windowControllers()
    for (let j = 0; j < wcs.count(); j++) {
      const w = wcs.objectAtIndex(j).window()
      if (w && !w.isMiniaturized()) return 'visible'
    }
  }
  return 'minimized'
}

// 给窗口接上跟随逻辑；返回 dispose 函数（窗口关闭时调用，清理定时器与观察者）
export function attachFollow(win) {
  let hiddenByFollow = false
  let disposed = false

  function showAgain() {
    hiddenByFollow = false
    try { win.show() } catch (e) { /* ignore */ }
    try { win.setAlwaysOnTop(true, 'floating', 1) } catch (e) { /* ignore */ }
    try { win.moveTop() } catch (e) { /* ignore */ }
  }

  function checkFollow(forceMin) {
    if (disposed) return
    try {
      const st = forceMin ? 'minimized' : docWindowState()
      if (st === 'visible') {
        if (hiddenByFollow) showAgain()
      } else if (st === 'minimized') {
        if (!hiddenByFollow) {
          hiddenByFollow = true
          try { win.hide() } catch (e) { /* ignore */ }
        }
      } else {
        clearInterval(timer)
        try { win.close() } catch (e) { /* ignore */ }
      }
    } catch (e) { /* ignore */ }
  }

  const timer = setInterval(checkFollow, 150)

  const NC = NSNotificationCenter.defaultCenter()
  const observers = []
  ;[
    'NSWindowWillMiniaturizeNotification',
    'NSWindowDidMiniaturizeNotification',
    'NSWindowDidDeminiaturizeNotification',
    'NSWindowWillCloseNotification',
  ].forEach(function (name) {
    try {
      observers.push(
        NC.addObserverForName_object_queue_block_(name, null, null, function (notif) {
          if (disposed) return
          if (name === 'NSWindowWillMiniaturizeNotification') {
            // 排除我们自己的窗口（工具栏/图标库/词库）
            try {
              const w = notif && notif.object()
              if (w && OUR_TITLES.indexOf(String(w.title() || '')) !== -1) return
            } catch (e) { /* ignore */ }
            checkFollow(true)
            return
          }
          checkFollow()
        })
      )
    } catch (e) { /* ignore */ }
  })

  return function dispose() {
    disposed = true
    clearInterval(timer)
    observers.forEach(function (o) {
      try { NC.removeObserver_(o) } catch (e) { /* ignore */ }
    })
  }
}
