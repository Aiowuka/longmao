# 自有后台接入契约

Longmao 不内置学校域名。真实链路只连接你在本机配置文件里明确声明的自有后台 origin。

## 配置

复制示例：

```sh
cp config/backend.example.json config/backend.json
```

Windows PowerShell：

```powershell
Copy-Item config/backend.example.json config/backend.json
```

`config/backend.json` 已加入 `.gitignore`。也可以通过 `LONGMAO_BACKEND_CONFIG` 指向其他本地 JSON 文件。

远程后台必须使用 HTTPS；只有 `localhost`、`127.0.0.1`、`::1` 允许 HTTP。

## 登录态自动捕获

Longmao 连接 WMPFDebugger 的 `ws://127.0.0.1:62000`，启用 CDP 的 Network / Runtime / Page domain。

只有 Network 事件同时满足以下条件才会尝试获取 Token：

1. URL origin 与 `backend.json.origin` 完全一致；
2. URL pathname 命中 `auth.capture.pathPrefixes`。

可从两类位置提取：

- `requestHeaderNames` 指定的请求头；
- `responseJsonPaths` 指定的 JSON 响应字段。

Token 只保存在 Longmao Node 进程内存中。网页只能看到脱敏预览和长度，不提供读取原始 Token 的 Web API。

## Longmao v1 后台契约

### profile（可选）

```http
GET /api/me
Authorization: Bearer <token>
```

返回任意 JSON；只在本机控制台展示。

### tasks（可选）

```http
GET /api/run/tasks
Authorization: Bearer <token>
```

返回任意 JSON。Longmao 当前不依赖具体结构，任务 ID 由运行表单填写。

### start（必须）

请求：

```json
{
  "taskId": "task-001",
  "synthetic": true,
  "client": {
    "name": "longmao",
    "contractVersion": 1
  },
  "plan": {
    "distanceMeters": 3000,
    "durationSeconds": 1200,
    "startedAt": "..."
  }
}
```

响应中必须存在 `ids.runIdPath` 指向的场次 ID。例如默认：

```json
{"runId":"run-123"}
```

### submit（必须）

请求：

```json
{
  "runId": "run-123",
  "taskId": "task-001",
  "track": {
    "synthetic": true,
    "generatedBy": "longmao-test-generator",
    "summary": {},
    "points": []
  }
}
```

轨迹由 Longmao 本地生成，并明确带 `synthetic: true`，用于你的测试后台。

响应可包含 `ids.receiptIdPath`。如果不存在，Longmao 使用 runId 作为 receiptId。

### receipt（可选）

默认：

```http
GET /api/run/receipts/{receiptId}
```

用于最终回执验证。

## 状态机

```text
WMPF 登录
  ↓
CDP 捕获自有后台 Token（仅内存）
  ↓
profile（可选）
  ↓
tasks（可选）
  ↓
生成 synthetic run
  ↓
start
  ↓
submit
  ↓
receipt（可选）
```

Longmao 不提供“任意 URL + 任意 Header + 任意 Body”的通用重放接口。后台 origin、端点和 Token 捕获规则全部来自本地白名单配置。
