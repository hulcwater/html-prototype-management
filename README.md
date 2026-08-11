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
