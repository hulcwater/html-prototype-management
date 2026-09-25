## 改造目标
将外部 API 上传已有原型新版本的定位方式从内部数字 `id` 改为公开且稳定的 `preview_id`，避免调用方依赖数据库主键。

## 接口变更
把外部接口从：

```text
POST /api/v1/prototypes/:id/versions
```

改为：

```text
POST /api/v1/prototypes/:previewId/versions
```

调用方先调用 `POST /api/v1/prototypes`，保存返回值中的 `data.preview_id`，之后使用该值上传新版本：

```bash
curl -X POST "https://html-prototype-management.pages.dev/api/v1/prototypes/<preview_id>/versions" \
  -H "Authorization: Bearer <API_KEY>" \
  -F "uploader=orders-ci" \
  -F "update_notes=更新说明" \
  -F "file=@./prototype-v2.zip"
```

## 实现改动

1. 修改 `src/routes/api-v1.ts`
   - 路由参数由 `:id` 改名为 `:previewId`。
   - 使用现有 `db.getPrototypeByPreviewId()` 查询原型。
   - 对空的 `preview_id` 返回 `VALIDATION_ERROR`。
   - 查不到时返回明确的 `NOT_FOUND` 错误。
   - 后续内部处理仍使用数据库中的 `prototype.id`，因此 R2 路径、上传记录、版本清理逻辑不变。

2. 保持管理后台接口不变
   - 现有后台接口 `POST /api/prototypes/:id/upload` 继续使用数字 ID，因为这是内部管理接口，不属于此次外部 API 合约。
   - 不修改数据库表结构；`preview_id` 已有唯一约束和查询索引。

3. 更新 `README.md` 和 `DEPLOY.md`
   - 明确说明 `data.preview_id` 是外部调用方应保存的标识。
   - 标注 `data.id` 只是内部数据库 ID，不应作为外部版本上传参数。
   - 将所有外部上传示例改成 `<preview_id>`。

4. 验证
   - 类型检查和 diff 检查。
   - 本地启动服务，用 API Key 创建原型，读取返回的 `preview_id`，再使用该值上传新版本。
   - 验证错误的 `preview_id` 返回 404。
   - 验证原有管理后台数字 ID 上传接口仍未被改动。

## 兼容性决策
不在同一个路径上自动猜测数字 ID 或 `preview_id`，避免未来出现数字形式标识时产生歧义。新的外部接口以 `preview_id` 为唯一正式用法；如果已有外部调用方已经使用旧数字 ID，需要单独评估是否增加明确的临时兼容路径。