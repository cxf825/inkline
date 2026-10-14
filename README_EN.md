<div align="center">
  <img src="assets/logo.svg" width="112" alt="Inkline Logo">

  # Inkline 墨斗

  **Annotation / hand-off / asset toolkit for Sketch — "snap an ink line" onto your designs**

  [![Release](https://img.shields.io/github/v/release/cxf825/inkline?color=3868E6)](https://github.com/cxf825/inkline/releases)
  [![License: MIT](https://img.shields.io/badge/License-MIT-3868E6.svg)](LICENSE)
  ![Sketch](https://img.shields.io/badge/Sketch-2026%20%2B-2B2B2B)
  ![Platform](https://img.shields.io/badge/platform-macOS-F1EEE6)

  English ｜ [简体中文](README.md)
</div>

---

## Why

Kitchen and Sketch Measure — the two classic hand-off plugins for Sketch — no longer work with recent Sketch versions. **Inkline** recreates and modernizes their core capabilities into one actively maintained plugin:

- 🖊 **Hand-off essentials**: width / height / spacing annotations, numbered notes, asset export, offline HTML spec
- 📊 **Charts**: bar / line / pie charts inserted as **editable vector layer groups**
- 🔌 **Fully offline**: no server, no telemetry — all data stays on your machine

> 💡 The entire codebase and UI of this plugin were built with [WorkBuddy](https://www.workbuddy.cn) — feature design, implementation, UI polish and release pipeline, all AI-assisted.

## Install

1. Download the latest `inkline-vX.Y.Z.sketchplugin.zip` from [**Releases**](https://github.com/cxf825/inkline/releases) and unzip
2. Double-click `inkline.sketchplugin` (uninstall any older Kitchen3 / Inkline copy first)
3. Restart Sketch — find `Plugins → 墨斗·Inkline` in the menu bar

Toggle the toolbar via the plugin menu or **⌃⌘B**.

<div align="center">
  <img src="assets/screenshots/toolbar.png" width="760" alt="Inkline floating toolbar">
</div>

---

## Features

### Annotations

One-click dimension marks for the selected layers, generated as `INK-`-prefixed layers with a consistent 10pt / red-blue-purple color system — clear them all anytime.

| Action | Shortcut |
|---|---|
| Mark widths | ⌃⇧2 |
| Mark heights | ⌃⇧6 |
| Mark spacing (to artboard edges, or between layers) | ⌃⇧3 |
| Mark text properties (font size / line height / color) | ⌃⇧4 |
| Numbered sticky notes | ⌃⌥N |
| Clear all annotations | ⌃⇧5 |

### Charts (⌃⌥C)

<div align="center">
  <img src="assets/screenshots/chart.png" width="640" alt="Data charts">
</div>

Fill in data → live preview → insert onto the canvas. **Bar** (vertical / horizontal), **line**, **pie / donut**.

- Sizes refer to the **chart body itself**; donut ring width (0 = solid), white stroke 0–8pt
- Legend sits 40pt to the right and is inserted as its **own group**, draggable independently
- Brand-blue mono (default) or an 8-color palette; rounded bars, value labels, grid lines toggleable
- Inserted as real vectors + native text layers — everything stays editable in Sketch

### Asset export (⌃⌥E)

<div align="center">
  <img src="assets/screenshots/slices.png" width="480" alt="Asset export">
</div>

Pick platforms and scales in a spec window, export to any folder (choices are remembered):

- **iOS**: @1x / @2x / @3x with standard naming + SVG
- **Android**: ldpi 0.75× ~ xxxhdpi 4×, auto-sorted into `drawable-*` folders as `name.png`

### Icon library (⌃⌥I)

<div align="center">
  <img src="assets/screenshots/icons.png" width="640" alt="Icon library">
</div>

- **Local mode**: search the entire Iconify catalog (Ant Design / Material / Tabler…) with Chinese or English keywords, click to insert
- **iconfont.cn mode**: embedded web view that keeps your existing login, collections and projects

After inserting, the icon is auto-selected and the canvas centers on it.

### Offline HTML spec (⌃⇧E)

Export the current page as a **single-file offline HTML spec**: artboard previews with toggleable annotation overlays, plus auto-collected color & type sheets. No environment needed — just open it.

### Mock data

- **Text** (⌃⌥T): smart matching by layer name — layers named “phone / email / price / name / date” get matching fake data
- **Images** (⌃⌥M): random image fills, optionally from a local folder
- **Custom word lists**: separate editor window, persisted locally

### Also included

- **Grid slicing**: split any shape into rows × cols with gap and margins
- **Palette**: scan document colors by frequency + personal swatches, click to copy
- **Unlock everything** (⌃⇧L): unlock all locked layers on the page, including deeply nested ones

## Development

```bash
git clone https://github.com/cxf825/inkline.git
cd inkline
npm install
NODE_OPTIONS=--openssl-legacy-provider npm run build   # → inkline.sketchplugin
NODE_OPTIONS=--openssl-legacy-provider npm run watch   # incremental builds
```

## License

[MIT](LICENSE) © cxf825
