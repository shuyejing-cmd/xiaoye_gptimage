---
name: workbuddy-image-workflow
description: 在 WorkBuddy 中处理明确的图片生成、参考图编辑、生图提示词优化或 xiaoye-image 连接检查；纯讨论图片创意时不自动生图。
version: 0.5.0
display_name: "生图与本地下载"
display_name_en: "Image Generation & Download"
description_zh: "检测 xiaoye-image，按用户意愿优化或原样使用提示词，生成并保存图片。"
visibility: private
---

# WorkBuddy 图片工作流

## 何时使用

- 用户明确要求生成或编辑图片、检查 `xiaoye-image` 是否可用，或只想优化生图提示词时使用；`生成图片：` 前缀仍然有效，但不是必需的。
- 用户只是在讨论创意、询问能力或比较方案时，不调用生图工具。用户只要优化提示词时，只返回提示词，不调用 `generate_image`。
- 一张成品最多调用一次 `generate_image`。用户明确要求多张时按指定张数分别生成，每张成功交付按服务器返回的 `points_cost` 扣积分；不自行增加张数。不要因超时、断线或结果不确定而重新提交；用返回的 `request_id` 调用 `get_generation` 查询原任务。

## 连接与安装

1. 先检查本次 WorkBuddy 会话是否暴露 `xiaoye-image` 的 `generate_image`、`get_generation`、`get_balance`。只有在需要生图或用户要求检测连接时才检查，不必在普通聊天中反复检查。
2. 工具存在时调用 `get_balance` 验证连接、可用积分和当前价目表；若积分不足，停止生图并告知用户。鉴权或连接失败时说明实际错误，不猜测已经安装成功。
3. 工具不存在时，不猜本机 `command`、`args`、Key 或配置路径，也不手工拼接 `mcp.json`。引导用户登录 `https://xiaoyeai.cn` 创建个人 Key，复制网站当次生成的安装提示词交给 WorkBuddy；安装码有时效且一次性使用，不把安装码或固定安装命令写进本 Skill。安装后按网站提示重启 WorkBuddy、启用并信任 `xiaoye-image`，再用 `get_balance` 检查。
4. 不展示或记录个人 Key、安装码、网关 Token、COS 凭证或完整签名下载 URL。

## 提示词处理

- 用户说“原样使用”“不要优化”“直接用我的提示词”等时，除去用于控制调用的前缀和独立参数行，把用户的提示词原文传给 `generate_image`；不要翻译、扩写、删改或先要求确认。
- 用户给出较完整的画面描述时，默认保留其措辞和结构。主体、构图、风格、文字、参考图角色及禁止事项等信息已经明确，就不为了“优化”而改写。
- 用户给出简短需求且未拒绝优化时，可轻量补足能直接看见的画面信息，例如构图、主体位置、光线、色彩或材质。保留用户已指定的细节，不凭空加入人物、品牌、文字、数量、风格或相互矛盾的要求。不需要固定模板或堆砌形容词。
- 用户明确要求“先优化给我看”时，给出一版可编辑的提示词并停下，不自动生图。只有关键歧义会明显改变主体或编辑范围时，问一个简短问题；其他情况直接按已知要求处理。
- 图生图要说清每张参考图的作用，以及“改什么、保留什么”。需要精确文字时，保留引号内的原文并描述位置；画面比例与分辨率属于工具参数，不混入画面提示词。以上做法参考 [OpenAI Image Prompting Guide](https://developers.openai.com/api/docs/guides/image-prompting?site_locale=en)，但用户原意优先。

## MCP 参数与参考图

- `generate_image` 必填 `prompt`；可选 `size`、`resolution`、`reference_image_paths`。未指定或显式 `auto` 时后端采用 `size=1:1`、`resolution=2k`。Ext 价格版本 2 为 1K 2 积分、默认 2K 2 积分、4K 3 积分，参考图不加价；始终以 `get_balance.price_table` 的实时结果为准。Ext 下服务端无参考图时用 Flare，有参考图时用 Sunburst；Skill 不自行改模型。若管理员临时切回价格版本 1，按余额接口返回的旧价目表报价。
- 用户明确指定档位时照用；未指定时直接用服务端默认档。生成前可根据 `get_balance` 的价目表告知本次预计积分，不要求每张图再确认一次。即使绕过本 Skill，后端仍按同一价目表扣分。
- 提示词最多 3000 字符。优化时保留用户原意并简洁表达，不为凑长度增加细节；用户已给完整提示词或要求原样使用时不要重写。
- Ext 的 `size` 可用 `auto`、`1:1`、`3:2`、`2:3`、`4:3`、`3:4`、`5:4`、`4:5`、`16:9`、`9:16`、`21:9`；`resolution` 可用 `auto`、`1k`、`2k`、`4k`。Ext 不提供 `quality` 或 `output_format` 选择，不向工具传这两个字段；用户要 low/high 或指定文件格式时说明当前服务不支持，不悄悄改成其他档位。仅当 `get_balance.price_version=1` 时才按回退渠道的质量档与格式能力处理。
- 参考图最多 4 张，保持用户指定顺序；只接受 PNG/JPEG/WebP，单张不超过 4 MiB。使用当前 WorkBuddy 实际授权读取目录中的本机绝对路径，不写死某个人的目录。附件路径不在授权目录时，可复制到授权目录中的新文件以完成本次生图；不得覆盖同名文件。无法取得合规本机路径时停止，不拿网络 URL 冒充路径。
- 有参考图时统一传 `reference_image_paths` 数组；不要同时传单数 `reference_image_path`。无参考图时不传该字段。

## 结果与失败

1. 调用一次 `generate_image`。若得到 `request_id` 但尚未成功，用 `get_generation` 查询同一任务；`queued`、`submitting`、`provider_pending`、`output_persisting`、`unknown`、`manual_review` 等状态都不是成功，不再次生成。
2. 只有状态为 `succeeded` 且返回非空 `image_url` 才下载。`failed` 时如实说明失败；长时间未完成时给用户 `request_id` 并说明之后可继续查询，不声称已生成。
3. 默认将成功图片下载到当前用户的 `Downloads/WorkBuddy Images`，文件名用 `<request_id>.<实际格式>`；验证文件存在且非空后，用 WorkBuddy 可用的文件展示工具呈现，或提供本地绝对路径。下载失败只报告下载失败，保留任务 ID 供有效期内重新获取链接，不重新生成或重复扣费。不要在回复中输出完整签名 URL。
