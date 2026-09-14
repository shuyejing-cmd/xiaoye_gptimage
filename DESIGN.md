---
name: "WorkBuddy 图片 MCP"
description: "以设计年鉴账页组织可信交付、额度与审核信息的暖白纸张界面。"
colors:
  paper: "#f5f4f1"
  ink: "#17191b"
  muted: "#656967"
  rule: "#c9c7c2"
  seal: "#d8d9ef"
  danger: "#9c2f25"
  success: "#236145"
  focus: "#5859a7"
  field-surface: "#fbfaf7"
  field-border: "#a8a6a1"
  sidebar-surface: "#efeee9"
  navigation-hover: "#e4e3dd"
  success-surface: "#e7f0e9"
  success-border: "#8bb09e"
  danger-surface: "#f4e8e4"
  danger-border: "#cda49c"
  review-ink: "#72530b"
  review-surface: "#f3eddc"
  review-border: "#c5aa6d"
  key-surface: "#e0e1f2"
  code-surface: "#f8f7f4"
  package-hover: "#eeede8"
typography:
  display:
    fontFamily: "Manrope Variable, sans-serif"
    fontSize: "clamp(54px, 8vw, 112px)"
    fontWeight: 520
    lineHeight: 0.9
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Manrope Variable, sans-serif"
    fontSize: "clamp(32px, 4vw, 58px)"
    fontWeight: 560
    lineHeight: 1.02
    letterSpacing: "-0.035em"
  body:
    fontFamily: "Manrope Variable, sans-serif"
    lineHeight: 1.7
  label:
    fontFamily: "JetBrains Mono Variable, monospace"
    fontSize: "10px"
    fontWeight: 500
    letterSpacing: "0.08em"
rounded:
  square: "0"
  circle: "50%"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.square}"
    padding: "14px 20px"
  button-primary-hover:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.square}"
  field:
    backgroundColor: "{colors.field-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.square}"
    padding: "15px 14px"
  navigation-active:
    backgroundColor: "{colors.ink}"
    textColor: "white"
    rounded: "{rounded.square}"
    padding: "12px"
  status-success:
    backgroundColor: "{colors.success-surface}"
    textColor: "{colors.success}"
    typography: "{typography.label}"
    rounded: "{rounded.square}"
    padding: "7px 8px"
  status-danger:
    backgroundColor: "{colors.danger-surface}"
    textColor: "{colors.danger}"
    typography: "{typography.label}"
    rounded: "{rounded.square}"
    padding: "7px 8px"
  status-review:
    backgroundColor: "{colors.review-surface}"
    textColor: "{colors.review-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.square}"
    padding: "7px 8px"
  key-reveal:
    backgroundColor: "{colors.key-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.square}"
    padding: "26px 28px"
  download-plate:
    backgroundColor: "{colors.seal}"
    textColor: "{colors.ink}"
    rounded: "{rounded.square}"
    padding: "42px"
---

# Design System: WorkBuddy 图片 MCP

## Overview

**Creative North Star: "设计年鉴账页 / Design Annual Ledger"**

界面像一本正在使用的设计年鉴账页：暖白纸张承载高密度但可快速核对的信息，墨色文字与细线网格把额度、任务和审核事实排成清楚的账本。淡紫色印章不是装饰性品牌色块，而是只在身份、密钥和下载等关键节点出现的确认痕迹。

整体气质直接、克制、可审计。大号 Manrope 标题给页面明确章节感，JetBrains Mono 负责编号、状态、标签和金额等需要对齐核读的内容；页面不用悬浮卡片制造层次，而以纸色差、边线、栏目和留白建立秩序。

**Key Characteristics:**

- 暖白纸张、近黑墨色与低对比灰线构成长期阅读底色。
- 淡紫印章色只标记关键交付物与一次性信息。
- 方角控件、1px 规则线和账本式分栏保持结构清晰。
- Manrope 承担叙事，JetBrains Mono 承担编号与可核对事实。
- 默认扁平无阴影，交互状态通过反相、底色与描边变化表达。

## Colors

色板以纸张和油墨为主，淡紫是稀少的印章层，绿、红、赭黄只服务于明确状态。

### Primary

- **账页墨色** (`colors.ink`, `#17191b`)：主文字、主按钮、激活导航与注册标记，承担最高信息权重。
- **淡紫印章** (`colors.seal`, `#d8d9ef`)：下载牌与圆形印章的识别色；同族的 `colors.key-surface` (`#e0e1f2`) 专用于一次性 Key 提示。

### Secondary

- **成功绿** (`colors.success`, `#236145`)：成功、已通过、有效和正向额度；与 `colors.success-surface`、`colors.success-border` 组成完整状态。
- **异常红** (`colors.danger`, `#9c2f25`)：失败、驳回、撤销与错误；与 `colors.danger-surface`、`colors.danger-border` 组成完整状态。
- **复核赭色** (`colors.review-ink`, `#72530b`)：未知、人工复核和待审核；与 `colors.review-surface`、`colors.review-border` 配套。
- **焦点紫** (`colors.focus`, `#5859a7`)：全局键盘焦点轮廓，保证交互位置不只依靠颜色或底面变化判断。

### Neutral

- **暖白纸张** (`colors.paper`, `#f5f4f1`)：全局画布与主要内容面。
- **次级墨灰** (`colors.muted`, `#656967`)：说明、时间、账户信息和次级标签。
- **账本规则线** (`colors.rule`, `#c9c7c2`)：栏目、表格、侧栏和列表的 1px 分隔。
- **侧栏纸层** (`colors.sidebar-surface`, `#efeee9`) 与 **悬停纸层** (`colors.navigation-hover`, `#e4e3dd`)：用轻微明度差区分导航区域与悬停状态。
- **字段纸面** (`colors.field-surface`, `#fbfaf7`) 与 **字段描边** (`colors.field-border`, `#a8a6a1`)：输入区域保持纸张质感，同时清楚标出可编辑边界。

### Named Rules

**The Seal Sparingly Rule.** 淡紫只用于印章、一次性 Key 与下载牌等关键确认面，不扩散成普通卡片底色。

**The State Trio Rule.** 每种业务状态同时使用文字色、描边与浅底色，状态含义不得只靠单一颜色表达。

## Typography

**Display Font:** Manrope Variable（后备 `sans-serif`）  
**Body Font:** Manrope Variable（后备 `sans-serif`）  
**Label/Mono Font:** JetBrains Mono Variable（后备 `monospace`）

**Character:** Manrope 的宽阔几何字面提供现代年鉴的章节感；JetBrains Mono 将编号、状态、日期和账本事实收紧为可逐项核读的技术层。

### Hierarchy

- **Display** (520, `typography.display`, line-height 0.9): 仅用于登录首页主标题，使用紧凑行高与负字距形成封面级尺度。
- **Headline** (560, `typography.headline`, line-height 1.02): 用于页面标题与入口标题，保持短句和明显章节边界。
- **Title** (14px, 0.08em, uppercase): 章节标题使用 JetBrains Mono，将页面内容切成账本栏目。
- **Body** (line-height 1.7): 页面说明和长段落使用 Manrope，说明文案最大行长为 65ch。
- **Label** (500, 10px, 0.08em, uppercase): 表头、状态与登记信息使用 JetBrains Mono；表单标签使用 11px 与 0.1em 字距。
- **Ledger Number** (500, 76px, line-height 1): 余额大数字使用表格数字特性；窄屏缩至 52px。

### Named Rules

**The Narrative-and-Fact Rule.** Manrope 讲清楚任务，JetBrains Mono 标记可核对事实；不要把整段正文设成等宽字体。

## Layout

桌面应用壳由 250px 固定侧栏和弹性内容区构成；内容页最大宽度为 1500px，并以 1px 横线、双栏和三栏台账组织信息。登录页首屏使用 `1.35fr / .65fr` 两栏，入口区使用 `180px / 1fr / minmax(300px, 480px)` 三栏；页面级内边距通过 `clamp()` 随视口伸缩。

900px 以下，侧栏缩为 84px 图标栏，页头、台账与安装流程改为单栏，套餐由三列改为纵向列表。700px 以下，后台配置表单由两列改为一列。600px 以下，导航转为 68px 固定底栏，并通过 `repeat(auto-fit, minmax(52px, 1fr))` 分配入口；页面留出 100px 底部空间，表格可水平滚动。360px 以下，登录页主标题缩至 44px。

**The Ruled Grid Rule.** 优先用网格轨道、栏目边线和连续列表建立关系；只有内容语义确实独立时才拆成单独色块。

## Elevation & Depth

系统当前不使用 `box-shadow`。深度来自暖白主纸、略深侧栏纸层、淡紫确认面、浅色状态底和 1px 规则线；悬停通过纸层明度或墨色反相变化表达，不把元素抬离账页。

### Named Rules

**The Ledger-Flat Rule.** 静止面保持无阴影；边线、底色和留白必须先承担结构职责。

## Shapes

按钮、输入框、导航项、状态标签、配置区和提示面均为直角，基础圆角为 `rounded.square`（0）。圆形只留给真正的标记或进度：登录印章和加载指示器使用 `rounded.circle`（50%）。注册十字、下载牌角标和点阵纹理补充印刷登记感。

**The Semantic Circle Rule.** 圆形只表示印章、登记点或旋转进度，不作为通用卡片和按钮轮廓。

## Components

### Buttons

- **Shape:** 直角、1px 墨色描边（`rounded.square`）。
- **Primary:** 墨色底配暖白字，内边距为 14px 20px，使用等宽大写标签。
- **Hover / Focus:** 悬停转为透明底和墨色字；全局 `:focus-visible` 使用 3px 焦点紫轮廓并外移 3px；禁用状态降至 0.45 或 0.5 不透明度并显示等待光标。
- **Text / Danger:** 无底无边框，以 4px 下划线偏移表现次级动作；危险动作改用异常红。

### Inputs / Fields

- **Style:** 近白字段纸面、1px 灰描边、直角轮廓；登录字段内边距为 15px 14px，后台字段为 11px 12px。
- **Focus:** 继承全局 3px 焦点紫轮廓，避免用阴影制造发光。
- **Error / Disabled:** 错误信息使用异常红文字与浅红纸面；禁用控件降低不透明度并显示等待光标。

### Navigation

- **Style:** 桌面侧栏为略深暖白纸层；项目以图标、14px 文字和 12px 内边距排列，默认透明，悬停显示浅灰纸层，激活项用墨色反相。
- **Responsive:** 900px 以下收成 84px 图标栏；600px 以下转为底部网格导航，文字为 9px，图标为 18px。

### Status Tags

- **Style:** 10px 等宽大写标签，7px 8px 内边距、1px 描边和直角轮廓。
- **State:** 成功用绿、失败用红、待复核用赭黄；三类都同时改变文字、描边与浅底色。

### Ledger Rows and Tables

- **Style:** 表格合并边框，表头为 10px 等宽大写标签；行和列表项以底部 1px 规则线分隔，默认不包裹进独立卡片。
- **Density:** 表格单元格为 14px 10px 内边距，列表行为 14px 0；金额使用表格数字特性并右侧对齐。

### Package Tiles

- **Style:** 三列连续账格，单格最小高度 190px，30px 内边距，列间仅用 1px 规则线分隔。
- **State:** 悬停只改变为 `colors.package-hover`；900px 以下改为最小高度 130px 的纵向条目。

### Key Reveal

- **Style:** 淡紫 Key 纸面使用 26px 28px 内边距和双列网格，完整 Key 放在更浅的代码纸面中。
- **Behavior:** 复制动作使用墨色描边透明按钮；关闭按钮保持无底无边框，并提供 44px 触控尺寸。

### Download Plate

- **Style:** 淡紫印章面、42px 内边距、对角 `+` 登记标记和大号下载图标；主按钮占满宽度。
- **Responsive:** 600px 以下内边距收至 32px，不改变方角与无阴影原则。

## Do's and Don'ts

### Do:

- **Do** 用暖白纸面、墨色和 1px 规则线组织高密度账户信息。
- **Do** 让编号、日期、金额、状态和表头使用 JetBrains Mono 与表格数字特性。
- **Do** 为状态同时提供文字、描边、底色和可读标签。
- **Do** 在 900px、700px、600px 和 360px 的既有断点上延续相同的信息优先级。
- **Do** 把淡紫色保留给印章式确认、一次性密钥和下载交付物。

### Don't:

- **Don't** 为普通卡片、按钮或列表加入圆角胶囊轮廓。
- **Don't** 用投影堆叠台账层级；先使用规则线、纸色差和留白。
- **Don't** 把成功、失败或待复核只表达为颜色点或无文字图标。
- **Don't** 让正文、说明或长段落全部使用等宽字体。
- **Don't** 把淡紫印章色扩散成大面积通用背景或常规悬停色。
