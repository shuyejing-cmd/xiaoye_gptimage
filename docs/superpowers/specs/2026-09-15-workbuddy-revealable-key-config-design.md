# WorkBuddy 可重复查看 Key 与 MCP 配置设计

## 目标

用户登录网站后，可以在“MCP Key”页面持续查看自己仍有效的完整 Key，并一键复制可直接粘贴到 WorkBuddy 的完整 JSON 配置。

## 安全模型

- Key 创建后继续保存 HMAC 摘要作为网关鉴权依据。
- 完整 Key 另用独立的 `API_KEY_ENCRYPTION_KEY` 经 AES-256-GCM 加密后保存；数据库不保存明文。
- 只有已登录且属于 Key 所有者的会话可以读取明文。Key 列表响应设置 `Cache-Control: no-store`。
- 加密主密钥只存在于服务器环境变量，不进入数据库、日志、备份或前端构建。
- 老 Key 没有密文时显示“旧 Key 无法恢复，请重新创建”；启动时已知明文的 legacy 管理员 Key可补写密文。
- 撤销的 Key 不再返回完整值。

## WorkBuddy 配置

网站为每个可查看的有效 Key 生成：

```json
{
  "mcpServers": {
    "xiaoye-image": {
      "command": "C:/Program Files/WorkBuddy Image MCP/runtime/node.exe",
      "args": ["C:/Program Files/WorkBuddy Image MCP/app/src/index.mjs"],
      "env": {
        "ALLOWED_IMAGE_ROOTS": "%USERPROFILE%/Pictures",
        "IMAGE_GATEWAY_URL": "https://xiaoyeai.cn",
        "IMAGE_API_KEY": "wb_live_..."
      }
    }
  }
}
```

bridge 在本机展开 `%USERPROFILE%`，因此默认配置不要求用户修改 Windows 用户名。配置假定安装器使用默认安装目录；自定义安装目录的用户仍应使用安装器修复配置。

## 页面交互

- 有效 Key 直接显示完整值，并提供“复制 Key”。
- 每个有效 Key 下方显示格式化 JSON，提供“复制完整配置”。
- 复制成功或失败均显示明确的无障碍状态文字。
- 旧 Key、撤销 Key 不显示完整值或可用配置。
- 页面延续暖白账页、方角、规则线与等宽代码样式，不引入弹窗。

## 验收

- 新 Key 的数据库行不含明文，但同一用户重新登录后仍能取回完整 Key。
- 其他用户无法读取该 Key；撤销后不能再返回完整值或用于鉴权。
- 篡改密文无法解密。
- 生成 JSON 可解析，包含正确路径、网关、Key 和 `%USERPROFILE%/Pictures`。
- 本地 bridge 能将 `%USERPROFILE%` 展开为真实目录。

