# Inkline · 墨斗 🖌 — Sketch 标注 / 交付 / 素材插件

Kitchen + Sketch Measure 组合体：在设计稿上"弹墨线"——标注、规范交付、图标与素材填充。

Kitchen 和 Sketch Measure 两大经典插件已不再支持新版 Sketch，原有标注、切图、尺寸查看等功能无法继续使用。本插件基于 WorkBuddy 开发，命名 **Inkline・墨斗**，复刻并优化设计稿标注、导出切图、查看图层信息等交付能力，为 Sketch 用户提供稳定可用的替代方案。

## 开发进度

| 步骤 | 内容 | 状态 |
|---|---|---|
| Step 0 | 工程搭建 + 基础菜单 | ✅ 已通过 |
| Step 1 | 侧边工具栏面板 | ✅ 已通过 |
| Step 2 | 标注四件套（尺寸/间距/属性/清除） | ✅ 已通过 |
| Step 3 | 离线 HTML 规范导出 | ✅ 已通过 |
| Step 4 | 图标库（Kitchen 式独立窗口，Iconify 免登录图源） | ✅ 已通过 |
| Step 5 | Mock 文本/图片填充 | ✅ 已通过 |
| Step 6a | 切图导出 + 颜色/字体规范收集 | ✅ 已通过 |
| Step 6c | 注释便签 / 色板管理 + 切图按编组建文件夹（标注样式自定义已按用户要求移除） | ✅ 待测试 |
| Step 6b | iconfont 登录版（需配合授权实测） | ⬜ 排到最后 |

## 版本号规则

`X.Y.Z`：小更新滚动最后一位（0.1.1 → 0.1.2）；大功能/大改升第二位（0.2.0）；正式发布升第一位（1.0.0）。当前 **v0.4.15**。

## 安装测试（Step 0）

1. 打开 Sketch → `Plugins → Manage Plugins → Install Plugin from Disk…`，选择本目录下的 `inkline.sketchplugin`（或直接双击；如装过旧 Kitchen3 先卸载）
2. 菜单栏 `Plugins → Inkline · 墨斗 → 使用帮助`
3. **测试通过标准**：弹出「Inkline · 墨斗」欢迎弹窗

## 开发命令

```bash
cd inkline
npm install        # 首次
npm run build      # 构建 → inkline.sketchplugin（需 NODE_OPTIONS=--openssl-legacy-provider）
npm run watch      # 开发时增量构建
```

构建后双击 `inkline.sketchplugin` 覆盖安装，重启 Sketch 生效。
