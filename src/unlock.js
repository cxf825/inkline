import { getSelectedDocument } from 'sketch'
import { toast } from './panel-ref.js'

// 一键解锁当前页全部锁定图层（含组内子图层）
export function unlockAll() {
  const doc = getSelectedDocument()
  if (!doc) {
    toast('请先打开一个文档')
    return
  }
  let count = 0
  let failed = 0
  function walk(layers) {
    (layers || []).forEach(function (l) {
      try {
        if (l.locked) {
          l.locked = false
          count++
        }
      } catch (e) {
        failed++
      }
      if (l.layers) walk(l.layers)
    })
  }
  try {
    walk(doc.selectedPage.layers)
  } catch (e) {
    toast('解锁失败：' + (e.message || e))
    return
  }
  if (count) {
    toast('已解锁 ' + count + ' 个锁定图层 ✅' + (failed ? '（' + failed + ' 个失败）' : ''))
  } else {
    toast('当前页没有锁定图层')
  }
}
