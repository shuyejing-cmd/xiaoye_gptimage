# WorkBuddy 安装文件腾讯云分发：简化实施计划

## 目标

保持用户流程不变，只把默认下载地址从 GitHub 改为腾讯云 COS；GitHub 继续作为备用地址。同时修复 Windows 默认禁止脚本和临时文件权限导致的安装失败。

## 本次只做

1. 发布新版本 `1.2.1`，不修改已经公开的 `1.2.0`。
2. 增加 `WORKBUDDY_RELEASE_BASE_URL`，生产环境可配置为腾讯云公开 HTTPS 地址。
3. 生成的清单使用腾讯云 EXE 地址，并包含同版本 GitHub 备用地址。
4. 安装脚本优先从腾讯云下载，失败后自动改用 GitHub；每个地址最多尝试三次。
5. 安装提示词加入 `-ExecutionPolicy Bypass`，并明确重启 WorkBuddy 后再检查余额。
6. 安装脚本在读取安装码前主动收紧文件权限，而不是要求用户手工处理权限。
7. 本地测试、网站构建并试打包；正式文件由 GitHub Actions 只构建一次，再将同一组三个文件原样上传腾讯云。

## 本次不做

- 不做 GitHub Actions 自动上传腾讯云。
- 不新增腾讯云发布账号或复杂权限系统。
- 不强制先开 CDN。
- 不做复杂的多环境发布编排。
- 不修改用户的创建 Key、复制提示词、授权安装、重启启用这四步流程。

## 腾讯云手动发布

先使用独立 COS 存储桶的公开 HTTPS 地址。GitHub Release 成功后，下载其中三个正式文件，不做任何修改，原样上传固定目录：

```text
releases/v1.2.1/
├─ workbuddy-image-mcp.ps1
├─ workbuddy-image-mcp-1.2.1.json
└─ WorkBuddy-Image-MCP-Setup-1.2.1.exe
```

上传顺序为 EXE、脚本、清单。不得在本地重新构建另一份 COS 安装包。三个文件允许公开读取，禁止公开写入。域名 `download.xiaoyeai.cn` 可以在首次安装跑通后再绑定，不阻塞本次验证。

## 验收

- 自动测试通过，网站能构建。
- 提示词使用腾讯云主地址，并保留 GitHub 备用说明。
- 命令包含 `-ExecutionPolicy Bypass`。
- 腾讯云下载失败时会尝试 GitHub。
- 下载后的 EXE 必须通过 SHA-256 校验，失败不能运行或报告成功。
- 临时安装码和下载文件在成功或失败后都会删除。
- 在一台 Windows 电脑完成一次真实安装：复制提示词、授权、安装、重启、开启 `xiaoye-image`、`get_balance` 成功。

## 用户只需处理

- 创建一个用于公开安装文件的 COS 存储桶。
- 在 GitHub 仓库设置 `WORKBUDDY_RELEASE_BASE_URL`，推送 `v1.2.1` 后等待 Release 构建成功。
- 把 GitHub Release 的三个 `1.2.1` 原文件上传到上述腾讯云目录。
- 把腾讯云提供的公开 HTTPS 基础地址告诉开发端，用于设置 `WORKBUDDY_RELEASE_BASE_URL`。
