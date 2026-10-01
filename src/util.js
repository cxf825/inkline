// 跨模块共享的小工具：标注前缀、纯官方 API 坐标计算、色值处理、窗口存活检测

// 标注/便签图层统一前缀：清除标注、规范导出、色板收集都靠它识别并跳过
export const PREFIX = 'INK-'

// 窗口引用是否仍然可用。
// sketch-module-web-view 的窗口会被所属 fiber 的 onCleanup 连带销毁，
// 模块级引用随即变成"僵尸"——此后 getBounds/setPosition/executeJavaScript
// 全部静默异常，表现为"功能突然哑掉"。所有持有窗口引用的模块在复用前
// 必须先过这道检测，不通过就当 null 处理并重建。
export function isLive(win) {
  if (!win) return false
  try {
    if (win._destroyed) return false
    win.getBounds()
    return true
  } catch (e) {
    return false
  }
}

// 图层画布绝对坐标：从当前图层逐层向上累加 frame（相对父级坐标）。
// 不依赖底层 MSLayer API（Sketch 2026 已移除 absoluteRect）
export function absRect(layer) {
  let x = layer.frame.x
  let y = layer.frame.y
  let p = layer.parent
  while (p && p.type !== 'Page') {
    x += p.frame.x
    y += p.frame.y
    p = p.parent
  }
  return { x: x, y: y, w: layer.frame.width, h: layer.frame.height }
}

// 从 Sketch 色值字符串（#RRGGBB 或 #RRGGBBAA）取前 6 位大写 hex，失败返回 null
export function hex6(c) {
  if (typeof c !== 'string') return null
  const m = c.match(/^#?([0-9a-fA-F]{6})/)
  return m ? ('#' + m[1].toUpperCase()) : null
}

// 严格归一：只接受完整 6 位或 8 位 hex，统一返回 #RRGGBB 大写（用户输入校验用）
export function normHex(c) {
  if (typeof c !== 'string') return null
  const m = c.match(/^#?([0-9a-fA-F]{6})(?:[0-9a-fA-F]{2})?$/)
  return m ? ('#' + m[1].toUpperCase()) : null
}
