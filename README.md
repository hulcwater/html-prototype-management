# HTML 原型管理工具

一个用于集中管理 HTML 原型文件的轻量工具，支持按模块分类组织原型、上传静态资源，并提供在线预览、版本记录等能力，适用于产品/设计团队内部的原型共享与归档。

---

## 界面预览

### 原型列表
左侧为模块导航栏，支持按业务模块（如采购、交付、品质、仓库等）筛选原型。右侧以卡片形式展示当前模块下的所有原型，每张卡片显示原型名称、所属模块、最近更新时间，并提供快捷预览入口。

### 新建原型
点击右上角「新建原型」按钮，填写以下信息后即可创建：

| 字段 | 是否必填 | 说明 |
|------|----------|------|
| 所属模块 | 必填 | 从已有模块中选择 |
| 原型名称 | 必填 | 如：采购订单管理 |
| 描述 | 选填 | 简短描述原型用途 |
| 原型文件 | 必填 | 支持 `.html` 文件或静态资源 `.zip` 包，可点击上传或拖拽 |

### 原型详情
点击任意原型卡片后弹出详情面板，包含以下信息与操作：

**基本信息**

| 字段 | 说明 |
|------|------|
| 预览链接 | 自动生成的在线预览地址，支持一键复制 |
| 所属模块 | 该原型归属的业务模块 |
| 更新时间 | 最近一次文件更新时间 |
| 创建时间 | 原型首次创建时间 |

**操作按钮**

| 操作 | 说明 |
|------|------|
| 编辑 | 修改原型名称、描述等基本信息 |
| 打开预览 | 在新标签页中打开原型预览页面 |
| 下载源文件 | 下载当前版本的原始上传文件 |
| 更新文件 | 上传新版本文件，保留历史上传记录 |
| 删除 | 删除该原型 |

**上传记录**

展示该原型的所有历史上传记录，每条记录包含：
- 上传时间
- 文件数量
- 文件大小

### 模块管理
左侧导航栏底部点击「新增模块」，输入模块名称（如：采购、交付、品质）即可创建。已有模块支持编辑与删除。

---

## 技术栈

- **运行时**：Cloudflare Workers（本地开发使用 Node.js + Hono）
- **语言**：TypeScript
- **数据库**：Cloudflare D1（本地使用 sql.js / SQLite）
- **对象存储**：Cloudflare R2（本地使用文件系统）
- **前端**：原生 HTML / CSS / JavaScript（单页应用）

---

## 快速开始

### 前置要求

- Node.js >= 18
- npm >= 9

> PowerShell 执行策略限制？以管理员身份运行一次：
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
> ```

### 1. 安装依赖

```bash
npm install
```

### 2. 初始化本地数据库

```bash
npm run db:init:local
```

### 3. 启动开发服务器

```bash
npm run dev
```

服务默认运行在 `http://localhost:8787`，浏览器访问即可使用。

---

## 访问密码保护

管理后台（`http://localhost:8787`）默认启用密码保护；**原型预览链接（`/preview/<previewId>/`）无需密码即可打开**，便于直接分享给他人。

**首次启动**时程序会自动生成一个随机访问密码，打印在终端控制台，同时保存到项目根目录 `.env.auth`（已加入 `.gitignore`，不会提交）。

**自定义/重置密码**（任选其一）：

| 方式 | 说明 |
|------|------|
| 环境变量 `AUTH_PASSWORD` | 设置明文密码，例如 PowerShell：`$env:AUTH_PASSWORD="你的密码"; npm run dev`（优先级最高） |
| 环境变量 `AUTH_PASSWORD_HASH` | 设置 SHA-256 十六进制哈希（用于生产环境 secret） |
| 删除 `.env.auth` | 下次启动自动重新生成随机密码 |

> 密码经 SHA-256 哈希存储，登录成功后通过 HttpOnly Cookie 记住登录状态：勾选「记住我」30 天内免登录，不勾选则关闭浏览器后需重新登录。侧边栏底部可随时「退出登录」。

---

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动本地开发服务器（端口 8787） |
| `npm run db:init:local` | 初始化本地 SQLite 数据库 |
| `npm run type-check` | TypeScript 类型检查 |
| `npm run deploy` | 部署静态资源到 Cloudflare Pages |
| `npm run deploy:worker` | 部署 Worker 到 Cloudflare |
| `npm run db:init` | 在本地 D1 上执行 schema（需配置 wrangler） |
| `npm run db:init:remote` | 在远程 D1 上执行 schema |

---

## 外部项目 API

外部项目通过版本化接口 `/api/v1` 创建原型或上传最新版本。该接口使用独立 API Key 鉴权，不会复用管理后台的登录 Cookie。

### 1. 创建 API Key

先使用管理后台登录产生的 Cookie 调用以下接口。完整的 `api_key` **仅在创建时返回一次**，请立即保存到调用项目的密钥管理系统；服务端只保存其 SHA-256 哈希。

```bash
curl -X POST http://localhost:8787/api/api-keys \
  -H "Content-Type: application/json" \
  -H "Cookie: proto_session=<后台登录后的 Cookie>" \
  -d '{"name":"订单系统 CI"}'
```

响应示例：

```json
{
  "ok": true,
  "data": {
    "id": 1,
    "name": "订单系统 CI",
    "key_prefix": "pk_xxxxxxxx…",
    "created_at": "2026-09-25 10:00:00",
    "api_key": "pk_请妥善保存的完整密钥"
  }
}
```

可通过 `GET /api/api-keys` 查看 Key 的名称、前缀、最后使用时间和撤销状态；通过 `DELETE /api/api-keys/:id` 立即撤销。二者同样需要后台登录 Cookie。

### 2. 调用约定

将 API Key 作为 Bearer Token 放到 `Authorization` 请求头：

```http
Authorization: Bearer pk_xxxxxxxxxxxxxxxxx
```

以下示例的 Base URL 为 `http://localhost:8787`。部署后请替换成实际的 Worker 或 Pages 域名。`/api/v1` 即使未开启后台密码保护也始终要求有效 API Key。

所有 JSON 成功响应使用：

```json
{ "ok": true, "data": {} }
```

错误响应使用：

```json
{
  "ok": false,
  "error": {
    "code": "UNAUTHORIZED | VALIDATION_ERROR | NOT_FOUND | UPLOAD_ERROR",
    "message": "可读的错误说明"
  }
}
```

上传请求使用 `multipart/form-data`，仅支持 `.html` 和 `.zip` 文件，单个文件最大 **25 MB**。

### 3. 查询模块

创建原型前先查询目标模块，取得 `module_id`：

```bash
curl http://localhost:8787/api/v1/modules \
  -H "Authorization: Bearer $PROTOTYPE_API_KEY"
```

### 4. 新建原型并上传首个版本

```bash
curl -X POST http://localhost:8787/api/v1/prototypes \
  -H "Authorization: Bearer $PROTOTYPE_API_KEY" \
  -F "name=订单管理原型" \
  -F "module_id=1" \
  -F "description=由订单系统 CI 自动发布" \
  -F "file=@./dist/prototype.zip"
```

成功后请保存 `data.preview_id`：它是外部 API 使用的公开原型标识，后续上传新版本时需要传入。`data.id` 是内部数据库 ID，外部调用无需使用；`data.preview_url` 是始终指向最新版本的稳定预览地址，`data.latest_record.preview_url` 是固定到本次版本的预览地址。

### 5. 上传已有原型的最新版本

```bash
curl -X POST http://localhost:8787/api/v1/prototypes/<preview_id>/versions \
  -H "Authorization: Bearer $PROTOTYPE_API_KEY" \
  -F "uploader=orders-ci" \
  -F "update_notes=优化订单列表筛选交互" \
  -F "file=@./dist/prototype-v2.zip"
```

将 `<preview_id>` 替换为创建原型响应中的 `data.preview_id`，不是内部数字 `data.id`。接口返回 HTTP `201`，其中 `data.prototype.preview_url` 指向新上传的最新版本，`data.version.preview_url` 固定指向本次上传版本。每次上传都会保留为独立记录；管理后台现有的版本保留策略仍会清理超出上限的旧版本。

---

## 目录结构

```
html-prototype-management/
├── src/
│   ├── index.ts          # Hono 应用入口
│   ├── db.ts             # D1 数据库连接
│   ├── types.ts          # TypeScript 类型定义
│   └── routes/
│       ├── modules.ts    # 模块相关 API
│       ├── prototypes.ts # 原型相关 API
│       └── preview.ts    # 预览相关 API
├── functions/
│   └── [[route]].ts      # Cloudflare Pages Functions 路由
├── public/               # 前端静态资源
│   ├── index.html
│   └── static/
├── dev-server.ts         # 本地开发服务器（Node.js）
├── d1-adapter.ts         # D1 → sql.js 适配器
├── r2-adapter.ts         # R2 → 本地文件系统适配器
├── schema.sql            # 数据库表结构
├── wrangler.toml         # Cloudflare Workers 配置
└── package.json
```

---

## 生产部署

部署到 Cloudflare 需要先完成以下准备：

1. 注册 [Cloudflare](https://dash.cloudflare.com) 账号
2. 安装并登录 Wrangler：
   ```bash
   npm install -g wrangler
   wrangler login
   ```
3. 在 Cloudflare Dashboard 中创建 D1 数据库和 R2 Bucket，然后更新 `wrangler.toml` 中的 `database_id` 和 `bucket_name`
4. 执行初始化：
   ```bash
   npm run db:init
   ```
5. 部署：
   ```bash
   npm run deploy:worker
   npm run deploy
   ```

---

## License

MIT
