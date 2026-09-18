---
name: "WorkBuddy 图片 MCP"
description: "以草地柔光、个人角色与液态玻璃构成的自然绿工作台。"
colors:
  meadow: "#dff3d4"
  glass: "rgba(250, 255, 246, 0.68)"
  glass-solid: "#f4fced"
  forest: "#1f6848"
  ink: "#17372b"
  muted: "#537262"
  glass-border: "rgba(255, 255, 255, 0.72)"
  inner-rule: "rgba(48, 105, 73, 0.16)"
  success: "#2f7955"
  review: "#8b681e"
  danger: "#a33f35"
  focus: "#245f91"
typography:
  display:
    fontFamily: "Manrope Variable, sans-serif"
    fontSize: "clamp(42px, 5vw, 72px)"
    fontWeight: 650
    lineHeight: 1.02
    letterSpacing: "-0.045em"
  headline:
    fontFamily: "Manrope Variable, sans-serif"
    fontSize: "clamp(32px, 3.4vw, 52px)"
    fontWeight: 650
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  body:
    fontFamily: "Manrope Variable, sans-serif"
    lineHeight: 1.65
  mono:
    fontFamily: "JetBrains Mono Variable, monospace"
    fontSize: "12px"
    lineHeight: 1.6
rounded:
  panel: "26px"
  card: "18px"
  control: "14px"
  pill: "999px"
components:
  glass-panel:
    backgroundColor: "{colors.glass}"
    borderColor: "{colors.glass-border}"
    rounded: "{rounded.panel}"
    backdropBlur: "22px"
  button-primary:
    backgroundColor: "{colors.forest}"
    textColor: "white"
    rounded: "{rounded.control}"
    padding: "12px 18px"
  button-secondary:
    backgroundColor: "{colors.glass}"
    textColor: "{colors.forest}"
    rounded: "{rounded.control}"
    padding: "12px 18px"
  field:
    backgroundColor: "rgba(255, 255, 255, 0.72)"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "14px 16px"
  status:
    rounded: "{rounded.pill}"
    padding: "6px 10px"
---

# Design System: WorkBuddy 图片 MCP

## Creative North Star

**风行工作台 / Meadow Glass Workspace**

登录页像进入一片明亮草地，用户端像放在草地柔光中的半透明工作台。自然绿负责安静和亲和，玻璃材质负责组织任务，深森林绿负责明确行动。

个人角色是品牌记忆点，不是持续占据内容的吉祥物：登录页作为主要角色，进入应用后只保留侧栏底部的小型头像。

## Mode

用户端以 **Operate** 为主。视觉表达必须服务于查余额、创建 Key、复制安装提示词、充值和查看状态。登录页可以更有氛围，进入工作台后信息密度与可读性优先。

## Color Rules

- `meadow` 是背景基色，不直接承担正文底色。
- `glass` 用于应用壳和主要面板；代码、表格和长文本使用更实的 `glass-solid`。
- `forest` 只用于主操作、当前导航和关键数字。
- 成功、待审核和危险状态分别使用 `success`、`review`、`danger`，同时必须有文字或图标。
- 焦点始终使用蓝色 `focus`，避免与绿色状态混淆。

## Material Rules

液态玻璃由半透明底、亮边、内高光、背景模糊和低强度环境阴影共同构成。任何单一属性都不能被当成完整玻璃效果。

单屏最多三个明显层级：

1. 应用壳或登录框。
2. 主要内容面板。
3. 按钮或状态控件。

不要在每个列表行上继续叠加阴影。列表内部优先使用透明度变化和细分隔线。

## Typography

- Manrope Variable 用于标题、正文、按钮和导航。
- JetBrains Mono Variable 用于 Key、任务编号、日期和代码。
- 页面标题最大约 52px；只有登录页品牌标题可达到 72px。
- 正文最大行宽约 65ch。
- 数字使用表格数字特性，金额和额度保持对齐。

## Layout

桌面应用使用窄型玻璃侧栏和最大宽度内容容器。主要断点：

- 1100px 以上：完整侧栏，Key 双栏工作台。
- 760–1100px：窄侧栏，Key 左栏收窄。
- 760px 以下：固定底部导航，内容单列。
- 420px 以下：减少页面边距和模糊强度，代码区允许横向滚动。

## Key Workspace

Key 页面采用固定的双栏任务结构：左侧 Key 列表，右侧当前 Key 详情。顶部只保留标题、有效数量与创建按钮。

左侧每项包含名称、公开前缀、状态和最近使用时间。右侧包含完整 Key、复制操作、安装提示词、重新生成和删除。安装提示词默认展开并设置最大高度。

移动端改为上下结构，但信息顺序和操作名称保持不变。

## Buttons

- 主按钮：深森林绿半透明渐变、白字、亮边和内高光。
- 次级按钮：乳白玻璃、森林绿文字。
- 危险按钮：浅红玻璃、深红文字。
- hover 增加亮度并上移 1–2px；active 回落并轻微缩小。
- 动画持续 150–240ms，支持 `prefers-reduced-motion`。

## Inputs

输入框使用高不透明乳白底，确保背景图不会影响阅读。边框采用浅绿色规则线，焦点使用 3px 蓝色外轮廓。错误同时改变边框、说明文字和图标。

## Navigation

桌面侧栏保持紧凑。当前页面使用深绿色柔和高亮；底部个人区显示小型头像和邮箱。手机端导航固定在底部，保留图标和短标签。

## Imagery

- 草地风景图用于登录页完整背景和用户端低对比背景层。
- 人物头像在登录页突出，在用户端只作为小型头像。
- 不叠加无意义花草贴纸、持续飘叶、粒子或复杂视差。
- 背景必须有遮罩或玻璃面，确保文字对比度。

## Accessibility

- 所有操作支持键盘。
- `:focus-visible` 使用蓝色焦点轮廓。
- 图标按钮提供中文可访问名称。
- 状态不只依赖颜色。
- 交互最小触控高度为 44px。
- 支持减少动态效果。

## Do

- 用自然绿表达品牌，用高对比浅色面承载数据。
- 让 Key、提示词和复制操作在一个工作台内完成。
- 保持玻璃层级克制，优先保证可读性。
- 在移动端维持相同的信息顺序。

## Don't

- 不让人物头像重复占据业务页面主区域。
- 不把每个列表项做成独立悬浮卡。
- 不用超大标题挤压操作区。
- 不用绿色单独表示成功或失败。
- 不增加影响操作的持续动画。
