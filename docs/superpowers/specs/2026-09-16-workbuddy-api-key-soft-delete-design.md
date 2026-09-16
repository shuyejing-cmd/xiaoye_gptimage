# WorkBuddy API Key 软删除设计

## 目标

用户可以删除自己的个人 API Key。删除后 Key 立即失效、从用户列表隐藏，并且不占用每位用户最多 3 个有效 Key 的上限。历史生成、安装令牌和审计关系继续保留。

## 数据模型

为 `api_keys` 增加可空字段 `deleted_at timestamptz`。删除时在同一条更新语句中：

- 将 `status` 设为 `revoked`；
- 写入 `revoked_at` 和 `deleted_at`；
- 将 `encrypted_key` 清空，避免已删除 Key 仍可被网站恢复显示。

不物理删除 `api_keys` 行，保证 `installation_tokens.api_key_id` 等历史外键有效。

## 服务与接口

- `apiKeyService.delete({ userId, keyId })` 只允许删除属于当前用户的 Key。
- 删除现有 Key 后立即无法通过个人 Key 鉴权，也无法兑换此前为该 Key 创建但尚未使用的安装令牌。
- 对同一个 Key 重复删除返回成功，保持接口幂等；删除不存在或属于其他用户的 Key统一返回 `404 api_key_not_found`。
- `apiKeyService.list(userId)` 过滤 `deleted_at is not null` 的记录。
- 创建 Key 的 3 个上限只统计 `status='active' and deleted_at is null`。已撤销和已删除 Key 都不占用上限。
- 网站继续使用 `DELETE /api/api-keys/:id`，语义从“仅撤销”调整为“软删除”。

## 用户界面

- Key 操作按钮显示为“删除”。
- 确认提示明确说明：删除后当前 WorkBuddy 配置立即失效，需要重新创建 Key 才能恢复使用。
- 删除成功后重新加载列表，被删除的 Key 不再显示，有效 Key 数量同步更新。

## 错误处理与审计

- 删除操作写入 `audit_events`，动作名为 `delete_api_key`，目标为 Key ID。
- 服务端不在响应或日志中返回完整 Key、Key 密文或安装令牌。
- 数据库更新与审计事件写入同一事务，避免只删除但没有审计记录。

## 测试范围

- 删除后原 Key 立即鉴权失败。
- 删除后列表不再返回该 Key，密文字段被清空。
- 删除后可以创建替代 Key，且不触发 3 Key 上限。
- 删除后的未消费安装令牌无法兑换。
- 重复删除保持成功；其他用户删除时返回 404。
- HTTP 接口和网站按钮使用“删除”语义。

