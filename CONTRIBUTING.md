# 更新规则

本仓库是 **mirro-fov** 内/外后视镜视野法规校核工具的代码仓库。所有代码和文档更新遵循以下规则。

## 提交信息规范

格式: `类型: 描述`

| 类型 | 用途 |
|---|---|
| `feat:` | 新功能 |
| `fix:` | 修复 bug |
| `refactor:` | 重构, 不改变行为 |
| `docs:` | 文档改动 |
| `chore:` | 配置/构建/依赖 |
| `test:` | 测试改动 |

示例:
- `feat: 后挡风 STEP 轮廓提取`
- `fix: 后挡风距边连线跳变`
- `docs: 工作流执行计划`

## 提交内容规范

- 每次提交**写清楚改了什么** (中文描述)
- 一次提交只做一件事 (单一职责)
- 提交前跑 `npm test` (155 断言全绿)
- 提交后如果改了 `index.html` / `app.js`, 递增 `?v=` 版本号

## 远程仓库内容边界

**入库** (可公开):
- 引擎代码 (`engine/`)
- 前端代码 (`public/`)
- 后端路由 (`routes.js`)
- 模板数据 (`*.example.json`)
- 开发框架文档 (README / CONTRIBUTING)

**不入库** (仅本地, 见 .gitignore):
- 真实车型数据 (`data/vehicles/*.json`, `data/exterior/*.json`)
- 内部开发文档 (`HANDOFF.md`, `docs/DEVELOPMENT_SPEC.md`, `docs/exterior-mirror-inputs.md`)
- 平台落地页 (`modules/smart/public/index.html`)
- 供应商数据 / 产品代号 / 平台部署细节

## 版本标签

发布时打 tag, 格式: `vX.Y.Z`

| 位 | 含义 |
|---|---|
| X | 主版本: 不兼容改动 |
| Y | 次版本: 新功能 |
| Z | 补丁: bug 修复 |

当前基线: **v1.0.0** (首次功能完整)

打 tag 命令:
```bash
git tag -a v1.1.0 -m "后挡风 STEP 轮廓提取 + 工作流优化"
git push origin v1.1.0
```

## 分支策略

- `main`: 稳定版本, 只接收测试通过的提交
- 开发在本地 `clean-push` 分支, 验证后合并到 `main` 推送
