# Xiaoye WorkBuddy Image MCP

小叶图片生成服务的公开 WorkBuddy MCP bridge 与 Windows 安装器源码。

本仓库只负责本地 bridge、安装器和 GitHub Release 分发。商业后端、用户数据、个人 Key、安装码、数据库和服务端密钥不在本仓库中。

## 使用方式

用户应登录小叶图片 MCP 网站创建个人 Key，然后复制网站生成的 30 分钟一次性安装提示词给 WorkBuddy。提示词优先从腾讯云 COS 下载固定版本安装文件，失败时自动使用本仓库同版本 Release，并始终校验安装器 SHA-256。

安装完成后，在 WorkBuddy 中开启 `xiaoye-image`，并调用 `get_balance` 检查连接。

## Bridge 工具

- `generate_image`：文生图或最多四张参考图的图片生成。
- `get_generation`：查询异步生成任务。
- `get_balance`：查询可用与冻结额度。

## 本地开发

需要 Node.js 22.13 或更高版本。

```powershell
npm ci
npm test
npm run bridge
```

bridge 读取以下环境变量：

- `IMAGE_GATEWAY_URL`
- `IMAGE_API_KEY`
- `ALLOWED_IMAGE_ROOTS`

`IMAGE_GATEWAY_TOKEN` 仅用于兼容旧配置。

## Release

推送 `v1.2.1` 标签会触发 GitHub Actions，在 Windows runner 上测试并生成：

- `workbuddy-image-mcp.ps1`
- `workbuddy-image-mcp-1.2.1.json`
- `WorkBuddy-Image-MCP-Setup-1.2.1.exe`

当前 1.2.1 为未签名公开内测版，Windows 可能显示“未知发布者”。正式文件只由 GitHub Actions 构建一次，并将同一批文件原样镜像到腾讯云 COS。
