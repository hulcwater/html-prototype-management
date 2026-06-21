# 部署到 Cloudflare Workers

## 前置要求

- Node.js 18+
- Cloudflare 账号
- 安装 Wrangler CLI：`npm install -g wrangler`
- 登录：`wrangler login`

## 一次性初始化

### 1. 安装依赖

```bash
npm install
```

### 2. 创建 D1 数据库

```bash
wrangler d1 create html-prototypes
```

命令输出类似：
```
✅ Created D1 database 'html-prototypes'
[[d1_databases]]
binding = "DB"
database_name = "html-prototypes"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

将输出的 `database_id` 填入 `wrangler.toml` 中：

```toml
[[d1_databases]]
binding = "DB"
database_name = "html-prototypes"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"  # ← 替换这里
```

### 3. 创建 R2 存储桶

```bash
wrangler r2 bucket create html-prototypes
```

### 4. 初始化数据库表结构

```bash
# 本地开发环境
npm run db:init

# 线上环境
npm run db:init:remote
```

## 本地开发

```bash
npm run dev
```

访问 `http://localhost:8787`

> 本地开发时 D1 和 R2 使用本地模拟，数据存储在 `.wrangler/` 目录下。

## 部署到 Cloudflare

```bash
npm run deploy
```

部署完成后会输出 Worker 的访问地址，如：
```
https://html-prototype-management.your-subdomain.workers.dev
```

## 项目结构

```
├── src/
│   ├── index.ts          # Hono 主入口，路由注册
│   ├── types.ts          # TypeScript 类型定义
│   ├── db.ts             # D1 数据库操作函数
│   └── routes/
│       ├── modules.ts    # /api/modules 模块管理
│       ├── prototypes.ts # /api/prototypes 原型管理 + R2 文件上传
│       └── preview.ts    # /preview/:id 从 R2 提供预览
├── public/               # 前端静态文件（Workers Assets 托管）
│   ├── index.html
│   └── static/
│       ├── app.js
│       └── style.css
├── schema.sql            # D1 建表 SQL
├── wrangler.toml         # Cloudflare Workers 配置
├── package.json
└── tsconfig.json
```

## Flask → Hono 迁移对照

| Flask (Python) | Hono (TypeScript) |
|---|---|
| SQLite 本地文件 | Cloudflare D1 |
| `uploads/sources/` 本地磁盘 | R2 `sources/<id>/...` |
| `uploads/previews/` 本地磁盘 | R2 `previews/<preview_id>/...` |
| Flask-SQLAlchemy ORM | 原生 D1 SQL 查询 |
| `zipfile` 模块 | `fflate` (JS zip 库) |
| `send_from_directory` | R2 Object.body 直接返回 |

## 注意事项

- **文件大小限制**：Cloudflare Workers 请求体默认上限 100MB（付费计划可调整）。
- **CPU 时间限制**：Workers 免费计划每次请求 10ms CPU，处理大 ZIP 可能超限；付费计划 30s。
- **R2 免费额度**：每月 10GB 存储 + 1000 万次 Class B 操作（GET），适合中小规模使用。
- **D1 免费额度**：每天 500 万次读取 + 10 万次写入，5GB 存储。
