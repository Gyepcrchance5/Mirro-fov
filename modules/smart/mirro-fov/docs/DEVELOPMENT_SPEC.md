# mirro-fov 开发与维护规范

> 内外后视镜视野法规校核模块 · GB 15084-2022 I/III 类
> 归属: 智能硬件组 (`modules/smart/mirro-fov/`)
> JS 主开发版本 · 155 断言全绿 · Python 引擎已同步 (66 断言)

---

## 0. 写代码前速查表 (每次必看, 30 秒)

> 不管写什么代码，先过这个清单。违反任何一条 = bug。

### HTML
- [ ] 卡片用 `.param-row > .col > .card.shadow-sm.h-100 > .card-header + .card-body` 结构 (§18.2.3)
- [ ] label + `<small class="unit">单位</small>` + `<input class="form-control form-control-sm">`
- [ ] 图表区用 `.panel-frame > .panel-bar > .panel-title + .panel-count`
- [ ] 按钮配色: 卡片内 `btn-solid`(蓝主) / `btn-outline-accent`(蓝描边) / `btn-outline-danger`(红)
- [ ] landing 大按钮用 `btn btn-primary btn-lg landing-btn` (已有模式, 不改)
- [ ] badge 颜色用 `badge-pass` / `badge-fail` CSS 类, 不内联 style (landing 除外, 已有模式)

### JavaScript
- [ ] 事件绑定全部用 `addEventListener`，**禁止 `onclick=`** (现有代码 0 个 onclick)
- [ ] 页面切换用 `el.style.display = '' / 'none'`，不用 class toggle
- [ ] 用户输入用 `parseFloat` + `isNaN` 检查 (NaN 防御)
- [ ] DOM 引用用 `$(id)` (已有别名 `const $ = id => document.getElementById(id)`)
- [ ] fetch 用 `callJson(url, body)` (已有封装, 自动处理错误)
- [ ] 每次改 index.html 或 app.js 后递增 `?v=` 版本号

### CSS
- [ ] **不改 `style.css`** (L0 冻结)
- [ ] 不自定义颜色/字体, 用 `:root` token (`--accent` / `--pass` / `--fail` 等)
- [ ] 不重写已有 CSS 组件类, 只引用

### 后端 (routes.js)
- [ ] POST 路由加 `jsonParser` (不用全局 `express.json()`)
- [ ] 路径用 `__dirname` 相对路径
- [ ] 错误用 `friendlyError(e)` 包装
- [ ] `edgeDistanceTo` 返回字段是 `ex`/`ey` (不是 `x`/`y`)

### 后挡风视图 (§10.1)
- [ ] 投影用 Y-Z 直投 (`widthVec=[0,1,0]`, `upVec=[0,0,1]`)，不依赖法线
- [ ] padding 按短边算 `min(宽,高)*0.15+20`，不用 `scaleanchor`
- [ ] 距边连线: BL→左侧竖向边, BR→右侧竖向边, +X→上方横向边 (固定不跳变)

### STEP 轮廓 (§11.6)
- [ ] B 样条采样后按 VERTEX_POINT 裁剪 (飞线根因)
- [ ] 退化边 (<5mm) 跳过
- [ ] JSON 中用 `null` 不用 `NaN`
- [ ] 切换车型时先清空 `currentOutlineLocal` / `currentRwOutline`

### 测试
- [ ] `npm test` 155 断言全绿
- [ ] 浏览器 Ctrl+Shift+R 强刷后无报错

---

## 1. 目录结构

### 1.1 当前 (独立开发)

```
mirro-fov-js/
├── engine/                  L1 共享引擎 + L2 分类引擎
│   ├── shared/              L1 纯数学 (geometry, plane, polygon)
│   ├── inner/               L2 内镜 (平面镜 + 五线法)
│   └── exterior/            L2 外镜 (凸球面 + 三角视野)
├── public/                  L0 设计模板 + L4 前端实例
│   ├── style.css            [L0 冻结] 全部 CSS token 和组件类
│   ├── index.html           landing + 内镜页 + 外镜页
│   └── app.js               前端交互逻辑
├── data/                    L5 车型数据
│   ├── vehicles/            内镜车型 JSON
│   └── exterior/            外镜车型 JSON
├── docs/                    文档 (本文件 + 外镜数学讨论稿)
├── routes.js                L3 API 路由
├── _test_server.js          本地测试服务器
├── package.json
└── HANDOFF.md               主文档 (架构细节/算法陷阱/判据体系/变更历史)
```

### 1.2 目标 (平台上线)

```
modules/smart/               ← 交付给管理员的整个文件夹
├── public/
│   └── index.html           组落地页 (5 Tab + MODULES 卡片)
└── mirro-fov/
    ├── engine/              同上 (L1 + L2)
    ├── public/              同上 (L0 + L4)
    ├── data/                同上 (L5)
    ├── docs/
    │   └── DEVELOPMENT_SPEC.md  本文件
    ├── routes.js            [改: 删全局 json parser + 加 static 路由]
    ├── README.md            管理员接入说明
    ├── HANDOFF.md           主文档
    ├── package.json
    └── _test_server.js      本地测试 (规范允许保留)
```

---

## 2. 架构分层 (L0–L6)

| 层 | 名称 | 目录 | 性质 | 修改规则 |
|---|---|---|---|---|
| **L0** | 设计系统模板 | `public/style.css` | 🔒 冻结 | 只引用, 不重写。禁止在页面中自定义颜色/字体/CSS 组件类 |
| **L1** | 共享引擎 | `engine/shared/` | 📦 引用 | 纯数学，内外镜通用。新函数先放业务目录，确认两处复用再提升 |
| **L2** | 分类引擎 | `engine/{inner,exterior}/` | ✏️ 扩展 | 每类镜子独立目录，只依赖 L1 |
| **L3** | API 路由 | `routes.js` | ✏️ 扩展 | `module.exports = router`，不调 `express.json()`（平台全局挂载） |
| **L4** | 前端实例 | `public/index.html` + `app.js` | ✏️ 扩展 | HTML 必须从 L0 模板骨架出发，用 L0 CSS 类 |
| **L5** | 数据 | `data/{vehicles,exterior}/` | ✏️ 扩展 | 整车坐标系, snake_case, 米制, JSON |
| **L6** | 文档 | `HANDOFF.md` + `docs/` | 📖 参考 | 每次改动记录到 HANDOFF §最新 |

### 2.1 L0 冻结规则 (违反即为 bug)

1. **禁止自定义颜色**: 页面中 `color` / `background` 必须来自 `:root` token
2. **禁止重写 CSS 组件**: 只用 `style.css` 已有类名，不新写等价样式覆盖
3. **字体不分裂**: 统一 `var(--sans)` / `var(--mono)`，不引入第三方字体
4. **HTML 从模板出发**: 顶栏/参数卡/判据面板/图表区 按固定 HTML 骨架搭建
5. **Plotly 布局锁定**: font/paper_bgcolor/plot_bgcolor/margin 已定稿

---

## 3. 路由规范 (L3)

### 3.1 基础模板

```javascript
const express = require('express');
const path = require('path');
const router = express.Router();

// 业务路由 (需要 body 的自己加 express.json())
router.post('/api/verify', express.json(), (req, res) => {
  // ...
});

// 静态文件 + 首页 (放最后)
router.use(express.static(path.join(__dirname, 'public')));
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

module.exports = router;
```

### 3.2 注意事项

- **不调全局 `express.json()`** — 平台 `server.js` 已挂载，全局调会重复解析
- **路径用 `__dirname`** — 迁移后自动适应新目录
- **不监听端口** — 只导出 `router`
- **用户信息**: 平台自动注入 `req.user = { open_id, name, department, avatar }`

---

## 4. 数据规范 (L5)

### 4.1 JSON Schema (内镜车型)

```json
{
  "vehicle": { "name": "Modena" },
  "mirror": { "width": 0.224796, "height": 0.050794, "pivot": [2.88, 0.0, 1.44], ... },
  "driver": { "eye_center": [3.24, -0.385, 1.372], "interpupillary_distance": 0.065 },
  "ground": { "front_mid": [0.5, 0.0, 0.199], "rear_mid": [5.9, 0.0, 0.185] },
  "rear_window": { "outline": [[...], ...], "transparent_zone": [[...], ...] },
  "regulation": { "standard": "GB 15084", "mirror_class": "I", "far_distance": 60 }
}
```

### 4.2 JSON Schema (外镜车型)

```json
{
  "vehicle": { "name": "TBD" },
  "driver": { "eye_center": [...], "eye_left_raw": [...], "eye_right_raw": [...], "interpupillary_distance": 0.065 },
  "ground": { "front_mid": [...], "rear_mid": [...] },
  "door_panel": { "door_outer_Y_left": -1.005, "door_outer_Y_right": 1.005 },
  "exterior_mirror_left": {
    "sr_nominal": 1.230, "sr_fit": 1.260,
    "outline_raw": [[...], ...],
    "supplier_sphere_center": [...],
    "turret_axis_p1": [...], "rotation_axis_dir": [...]
  },
  "exterior_mirror_right": { ... },
  "regulation": { "standard": "GB 15084", "mirror_class": "III", "width_near": 1, "dist_near": 4, "width_far": 4, "dist_far": 20 }
}
```

**规则**: snake_case · 米制 (m) · 坐标系 X+=后方 Y+=乘客右 Z+=上 · 文件放在模块 `data/` 下

---

## 5. 开发流程

### 5.1 新增镜子类型

```
1. L2: engine/<新类型>/ → 纯函数 + test-<新类型>.js
2. L4: public/index.html → 加页面 div (从 L0 HTML 骨架出发)
3. L4: public/app.js → 加 init<新类型>() + do<新类型>Verify()
4. L3: routes.js → 加 /api/<新类型>/* 路由
5. L5: data/<新类型>/ → 创建 JSON schema
6. L6: HANDOFF.md → 新增 §xx 说明
```

### 5.2 修改现有功能

```
1. L2: 改 engine/ → 跑对应 test-*.js 确保断言仍通过
2. L3: 改 routes.js → 不调 express.json()
3. L4: 改 public/ → 严格用 L0 CSS 类, 不自定义颜色
4. npm test → 155 断言全绿
5. HANDOFF.md → 记录变更
```

### 5.3 改 CSS / 设计语言

```
1. 只改 public/style.css 的 :root token 或组件类
2. 刷新浏览器验证所有页面 (landing + 内镜 + 外镜)
3. 确保 L0 模板骨架对应的 HTML 组件全部兼容
```

---

## 6. 测试规范

### 6.1 必须跑的命令

```bash
cd modules/smart/mirro-fov    # 或当前项目根目录
npm test                        # 155 断言, 任一失败非0退出
npm start                       # 启动 → http://localhost:3000
```

### 6.2 浏览器验证清单

- [ ] Landing 页两张卡片正常渲染
- [ ] 内镜页：车型切换 · 校核 · 自动搜角 · 镜中倒影图 · 后挡风图 全部正常
- [ ] 外镜页：校核 · 自动搜角 · 缩放滑块 · 左/右投影图正常
- [ ] 按钮配色一致（`btn-solid` 蓝 / `btn-outline-accent` 蓝描边 / `btn-outline-danger` 红描边）
- [ ] 控制台无报错 (F12)

### 6.3 Python 测试

```bash
cd ../Mirro-fov
python tests/test_exterior_mirror.py   # 66 断言
```

---

## 7. 平台发布流程

### 7.1 发布前自检

```bash
cd modules/smart/mirro-fov
npm install          # 确保依赖完整
npm test             # 155 断言全绿
npm start            # 本地验证
```

### 7.2 交付

将 `modules/smart/` 整个文件夹发给平台管理员。

### 7.3 管理员操作 (写在 README.md 里告知)

```javascript
// server.js 挂载
const mirroFovRoutes = require('./modules/smart/mirro-fov/routes');
app.use('/mirro-fov', moduleAuth('mirro-fov'), mirroFovRoutes);
```

npm 包: 无额外依赖 (`express` + `js-yaml` 平台已有)

### 7.4 平台降级

- **3DE 按钮**: 平台无 Python/CATIA，前端检测并灰掉按钮 + tooltip "平台环境不支持 3DE 读取，请本地使用"
- **AI Widget**: `<script src="/ai-widget.js">` 在 `index.html` 底部

---

## 8. 常用命令速查

```bash
# JS
npm test                         # 全量测试 (155 断言)
npm start                        # 启动本地服务器
node engine/inner/test.js        # 只跑内镜 (49)
node engine/exterior/test-exterior.js  # 只跑外镜 (55)
node engine/exterior/test-sphere-fit.js # 只跑拟合 (51)
node engine/exterior/verify-real.js [left|right]  # 真实数据校核

# Python
python tests/test_exterior_mirror.py               # 外镜引擎 (66)
python scripts/probe_curve_hybrid.py               # 3DE 曲线探测

# Git
git log --oneline -10                              # 最近提交
```

---

## 9. 外部依赖

| 依赖 | 用途 | 备注 |
|---|---|---|
| Node.js v16+ | 运行时 | |
| express | Web 框架 | 平台已提供 |
| js-yaml | 3DE YAML 转 JSON | 仅 `/api/catia` 路由用 |
| numpy | Python 引擎 | 仅 Python 端 |
| pywin32 | CATIA COM 连接 | 仅本机 3DE 读取 |
| Plotly.js | 前端图表 | CDN 加载, 离线时隐藏 |
| Bootstrap 5 | 前端框架 | CDN 加载 |

---

## 10. 关键约定 (改代码前必读)

1. **坐标系**: X+=后方, Y+=乘客右, Z+=上。单位 m。角度度 (内部弧度)。
2. **NaN 防御**: 所有几何函数输入校验 `isFinite`，NaN/Infinity 返回 null/false
3. **双眼交集**: 外镜判据用双眼交集 (两眼的反射点都在镜面内+margin 才可见)
4. **planar-cut 盲区**: 共面轮廓下 SR 错误 → 球心静默平移而残差恒0，唯一防线是 crossCheck
5. **Python 是 3DE 唯一入口**: JS 通过 spawn 代理 Python。Python 外镜引擎已移植 (`mirror_fov/exterior_mirror.py`)
6. **HANDOFF.md 是主文档**: 算法细节、判据体系、历史变更都看 HANDOFF，本文件是开发操作规范

### 10.1 后挡风视图渲染规范

后挡风视图 (2D 投影图) 的显示规则，改之前必看：

#### 投影方式
- **Y-Z 直投** (u=Y, v=Z)，不依赖平面法线
- 原因: 后挡风可能近乎水平 (法线 Z 分量大)，法线投影法会导致"上"方向偏到 +X
- `buildProjection` 中 `widthVec=[0,1,0]`, `upVec=[0,0,1]`，不可改

#### 画幅 padding
- `pad = min(宽, 高) * 0.15 + 20` (按短边算)
- 不用 `scaleanchor` (等比例锁定会让扁形状被压缩成细缝)

#### 距边连线 (红色虚线)
3 条中心线各固定连到一个边，**不随角度跳变**：

| 线 | 固定连到 | 筛选条件 |
|---|---|---|
| C→BL (左) | 后挡风左侧竖向边 | 左半 (midU<0) 且竖向 (dv>du) |
| C→BR (右) | 后挡风右侧竖向边 | 右半 (midU>0) 且竖向 (dv>du) |
| C→+X (后) | 后挡风上方横向边 | 上半 (midV>0) 且横向 (du>dv) |

- **竖向边** = Z 方向跨度 > Y 方向跨度 (dv>du) = 左右侧边
- **横向边** = Y 方向跨度 > Z 方向跨度 (du>dv) = 上/下边
- 退回机制: 对应区域无匹配边则搜全部
- `edgeDistanceTo` 返回字段是 `ex`/`ey` (不是 `x`/`y`)

#### STEP 轮廓的车型隔离
- `currentOutlineLocal` / `currentRwOutline` 在 `loadVehicleConfig` 开头**先清空**
- 防止切换车型时上一个车型的 STEP 轮廓残留
- 有 `outline_path` / `rear_window.outline_path` 的车型才加载 STEP 轮廓，无则用简化点
6. **HANDOFF.md 是主文档**: 算法细节、判据体系、历史变更都看 HANDOFF，本文件是开发操作规范

---

## 11. 用户工作流设计 (2026-08-11 定稿, 待实现)

### 11.1 入口设计: 动作优先 (方案 A)

Landing 页两个入口卡片，按用户意图分（不按镜子类型分）：

```
Landing:
  [📋 校核已有车型]    [📥 新建车型]

校核已有 → 选镜子类型(内/外) → 选车型 → 校核页
新建车型 → 选镜子类型(内/外) → 新建向导 → 保存 → 自动校核
```

### 11.2 新建车型向导 (5 步)

```
Step 0: 基本信息
  - 车型名称 (手输)
  - 镜子类型: 内后视镜 I 类 / 外后视镜 III 类
  - 侧别 (仅外镜): 左 / 右 / 双侧
  → 决定后续面名匹配规则、几何判定、是否需要后挡风、点坐标选哪些

Step 1: 镜面轮廓 (STEP)
  - 上传镜片 STEP 文件
  - 自动识别反射面 (按 Step 0 类型用不同规则)
  - 内镜: 面名含"内镜片/镜面/lens", 平面 Z≈50mm, 半模镜像补全
  - 外镜: 面名含"外镜片/球面/convex", 凸面 SR≈1260mm, 无镜像
  - 降级: 自动识别失败 → 列出所有面供手动选
  - 坐标系校验: 检查坐标范围是否在整车合理区间

Step 2: 后挡风轮廓 (仅内镜)
  - 上传后挡风 STEP (可选)
  - 自动识别后挡风面 (面名含"后挡风/rear window/backlight")
  - 提取完整边界 (所有边缝合, 非只取最长边)
  - 或跳过 → 后续用 3DE 手动选 7 点

Step 3: 点坐标 (3DE COM 或手输)
  - 方式一: 从 3DE 读取 (需本机 3DE)
    内镜: pivot / center_zero / 眼点 / 地面×2
    外镜: 眼点 / 地面×2 / 车门×2 / 轴线×3 (每侧)
  - 方式二: 手动输入坐标表单

Step 4: 标量参数
  内镜: yaw / pitch / 圆角R / 瞳距
  外镜: SR标称 / SR公差 / 调节角度

Step 5: 确认 & 保存
  - 生成车型 JSON + outline JSON
  - 自动进入校核页
```

### 11.3 STEP 文件处理规则

| 镜子类型 | 面名匹配 | 几何判定 | 边界处理 | 镜像 |
|---|---|---|---|---|
| 内镜镜面 | 内镜片/镜面/lens/reflect | 平面(X跨<5), Z≈50, Y≈112半 | 取最长边 | 是(Y对称) |
| 内镜后挡风 | 后挡风/rear window/backlight | 大面(Y跨>500, Z跨>300) | 全部边缝合 | 否 |
| 外镜镜面 | 外镜片/球面/convex/exterior | 凸面(非平面), SR≈1260 | 全部边缝合 | 否 |

### 11.4 坐标系校验

STEP 解析后检查坐标范围:
- X: 0~7000mm (整车长度)
- Y: -2000~2000mm (整车宽度)
- Z: 0~3000mm (整车高度)

超出范围 → 提示"可能从零件层级导出, 请从装配层级重新导出"

### 11.5 待实现状态

| 功能 | 状态 |
|---|---|
| Landing 改为动作优先 | ❌ 待实现 (见 §12 执行计划) |
| 新建向导 UI | ❌ 待实现 (见 §12 执行计划) |
| 后挡风 STEP 提取 | ✅ 已完成 (11.6 复盘) |
| 外镜 STEP 提取 | ❌ 待实现 |
| STEP 上传 API | ❌ 待实现 (见 §12 执行计划) |

---

## 12. 工作流开发执行计划 (2026-08-11, 交 Haiku 执行)

> 本节是给执行 agent 的详细设计文档，每个步骤精确到 HTML 结构 / JS 函数签名 / API 格式。
> 执行 agent 不需要做设计决策，按步骤实现即可。
> **前提**: 严格遵循 §10.1 后挡风视图渲染规范 + §18 L0 设计系统冻结规则。

### 12.1 总体改动范围

| 文件 | 改动 | 说明 |
|---|---|---|
| `public/index.html` | 改 landing + 加向导页 HTML | 新增 3 个 div: mirror-type-page / wizard-inner-page |
| `public/app.js` | 改 landing 路由 + 加向导逻辑 + 参数卡只读 | 新增 ~200 行 |
| `routes.js` | 加 STEP 上传 API + 轮廓解析 | 新增 2 个路由 |
| `public/style.css` | **不改** | L0 冻结，用已有 CSS 类 |

#### 开发规范约束 (执行 agent 必须遵守)

1. **L0 冻结** (§18.2.4): 不改 `style.css`，不加自定义颜色/字体，用已有 CSS 类
2. **按钮配色**: landing 页大按钮用 `btn btn-primary btn-lg landing-btn` (现有模式); 卡片内按钮用 `btn-solid` / `btn-outline-accent`
3. **事件绑定**: 全部用 `addEventListener`，**禁止 `onclick=`** 内联处理器 (现有代码 0 个 onclick)
4. **页面切换**: 用 `el.style.display = '' / 'none'` (现有模式)，不用 class toggle
5. **版本号**: 每次改 `index.html` 或 `app.js` 后，递增 `?v=` 版本号 (如 `20260811d` → `20260811e`)
6. **透光区**: 有 STEP 后挡风轮廓时不隐藏透光区卡，改为只读 + 显示"透光区 = 整体轮廓"
7. **NaN 防御**: 所有用户输入用 `parseFloat` + `isNaN` 检查
8. **测试**: 每步完成后 `npm test` 必须 155 断言全绿

### 12.2 Landing 页改造 (index.html)

**当前**: 两张卡片 (内后视镜 / 外后视镜)
**改为**: 两张卡片 (校核已有车型 / 新建车型)

```html
<!-- 替换现有 #landing-page 内的 .landing-cards 内容 -->
<div class="landing-cards">
  <div class="landing-card landing-card-verify">
    <h4>校核已有车型</h4>
    <h6 class="text-muted">选择已有数据 · 调整参数 · 查看结果</h6>
    <p class="landing-desc">加载已保存的车型数据，调整角度/参数后校核</p>
    <span class="badge" style="background:#34c759">就绪</span>
    <button id="enter-verify-btn" class="btn btn-primary btn-lg landing-btn">进入</button>
  </div>
  <div class="landing-card landing-card-new">
    <h4>新建车型</h4>
    <h6 class="text-muted">STEP 轮廓 + 3DE 选点 + 参数</h6>
    <p class="landing-desc">从 STEP 文件提取轮廓，3DE 读取点坐标，创建新车型</p>
    <span class="badge" style="background:#0071e3">向导</span>
    <button id="enter-new-btn" class="btn btn-primary btn-lg landing-btn">开始</button>
  </div>
</div>
```

**新增两个中间选择页** (在 landing-page 和 inner-page 之间):

```html
<!-- 镜子类型选择页 (校核/新建共用) -->
<div id="mirror-type-page" style="display:none">
  <div class="top-bar">
    <button id="type-back-btn" class="btn btn-outline-secondary btn-sm me-2">← 返回</button>
    <h4 class="top-title mb-0">选择镜子类型</h4>
  </div>
  <div class="landing-cards" style="margin-top:40px">
    <div class="landing-card">
      <h4>内后视镜</h4>
      <h6 class="text-muted">GB 15084 I 类 · 平面镜</h6>
      <p class="landing-desc">五线法 · 镜中倒影 · 后挡风穿透</p>
      <button id="select-inner-btn" class="btn btn-solid btn-lg landing-btn">选择</button>
    </div>
    <div class="landing-card">
      <h4>外后视镜</h4>
      <h6 class="text-muted">GB 15084 III 类 · 凸球面镜</h6>
      <p class="landing-desc">球面反射 · 双眼交集 · 地面三角形视野</p>
      <button id="select-exterior-btn" class="btn btn-solid btn-lg landing-btn">选择</button>
    </div>
  </div>
</div>
```

### 12.3 页面路由逻辑 (app.js)

**当前 4 个页面**: landing / inner / exterior
**改为 6 个页面**: landing / mirror-type / inner / exterior / wizard-inner / wizard-exterior

```javascript
// 页面路由
const pages = ['landing-page', 'mirror-type-page', 'inner-page', 'exterior-page',
               'wizard-inner-page', 'wizard-exterior-page'];

function showPage(name) {
  pages.forEach(id => {
    const el = $(id);
    if (el) el.style.display = id === name + '-page' ? '' : 'none';
  });
  // 懒初始化
  if (name === 'inner' && !innerPage.__inited) { innerPage.__inited = true; initInner(); }
  if (name === 'exterior' && !exteriorPage.__inited) { exteriorPage.__inited = true; initExterior(); }
  if (name === 'wizard-inner' && !$('wizard-inner-page').__inited) { $('wizard-inner-page').__inited = true; initWizardInner(); }
  if (name === 'wizard-exterior' && !$('wizard-exterior-page').__inited) { $('wizard-exterior-page').__inited = true; initWizardExterior(); }
}

// 按钮绑定
$('enter-verify-btn').addEventListener('click', () => showPage('mirror-type'));
$('enter-new-btn').addEventListener('click', () => { wizardMode = 'new'; showPage('mirror-type'); });
$('type-back-btn').addEventListener('click', () => showPage('landing'));
$('select-inner-btn').addEventListener('click', () => {
  if (wizardMode === 'new') showPage('wizard-inner'); else showPage('inner');
});
$('select-exterior-btn').addEventListener('click', () => {
  if (wizardMode === 'new') showPage('wizard-exterior'); else showPage('exterior');
});
```

### 12.4 校核页参数卡调整 (app.js)

**规则**: 有 STEP 轮廓的参数卡改为只读 + 显示"STEP N 点"，无 STEP 的保持可编辑。

```javascript
// 在 loadVehicleConfig 末尾加:
function updateCardReadonlyState(cfg) {
  // 镜面尺寸卡: 有 outlineLocal 则只读
  const hasOutline = !!cfg.outlineLocal;
  ['width', 'height', 'corner-r'].forEach(id => {
    const el = $(id);
    el.readOnly = hasOutline;
    el.style.opacity = hasOutline ? '0.6' : '';
  });
  // 尺寸卡副标题显示 STEP 点数
  const sizeHeader = document.querySelector('#param-row .col:nth-child(2) .card-header small');
  if (sizeHeader) sizeHeader.textContent = hasOutline ? `STEP ${cfg.outlineLocal.length} 点轮廓` : '反射涂层有效区域';

  // 后挡风 CAS 卡: 有 rwOutlineFull 则只读
  const hasRwOutline = !!cfg.rwOutlineFull;
  for (let i = 0; i < 7; i++) {
    ['x', 'y', 'z'].forEach(ax => {
      const el = $(`rw-c${i}-${ax}`);
      if (el) { el.readOnly = hasRwOutline; el.style.opacity = hasRwOutline ? '0.6' : ''; }
    });
  }
  const rwTitle = $('rw-section-title');
  if (rwTitle) rwTitle.textContent = hasRwOutline ? `后挡风 STEP ${cfg.rwOutlineFull.length} 点轮廓` : '后挡风 CAS 轮廓 (7 点)';
}
```

**保留可编辑的卡**: 镜面角度 (yaw/pitch) / 球铰 pivot / 镜面中心 / 眼点中心 / 地面前后端
**改为只读的卡**: 镜面尺寸 (有 STEP 时) / 后挡风 CAS 点 (有 STEP 时)
**隐藏的卡**: 透光区 (有 STEP 后挡风轮廓时隐藏, 透光区=整个轮廓)

### 12.5 STEP 上传 API (routes.js)

```javascript
// 文件上传需要 express.static 中间件已配置 (已有)
// 用 multer 处理文件上传? 不——平台规范说"如需新 npm 包告知管理员"。
// 改用: 前端 FileReader 读文件内容 → POST base64 → 后端写临时文件 → spawn Python 解析

const STEP_UPLOAD_DIR = path.join(__dirname, 'data', 'tmp');

router.post('/api/step/upload', jsonParser, async (req, res) => {
  const { filename, content } = req.body; // content = base64
  if (!filename || !content) return res.status(400).json({ ok: false, error: '缺少文件' });
  // 写临时 STEP 文件
  fs.mkdirSync(STEP_UPLOAD_DIR, { recursive: true });
  const stepPath = path.join(STEP_UPLOAD_DIR, filename.replace(/[^a-zA-Z0-9.-]/g, '_'));
  fs.writeFileSync(stepPath, Buffer.from(content, 'base64'));
  // spawn Python 解析 (step_rear_window.py 或 step_topology.py)
  // ... 返回轮廓 JSON
});
```

**注意**: 大 STEP 文件 (49MB) base64 编码后 ~65MB，可能超过 express.json() 默认限制。
改用 `express.json({ limit: '100mb' })` 仅对此路由生效:
```javascript
router.post('/api/step/upload', express.json({ limit: '100mb' }), async (req, res) => { ... });
```

### 12.6 新建向导 UI (index.html + app.js)

向导页用单页多步骤方式 (不用多页面), 用 `data-step` 控制显示。
**注意**: 所有按钮用 `id` + `addEventListener` 绑定，**禁止 `onclick=`**。

```html
<div id="wizard-inner-page" style="display:none">
  <div class="top-bar">
    <button id="wiz-inner-back" class="btn btn-outline-secondary btn-sm me-2">← 返回</button>
    <h4 class="top-title mb-0">新建内后视镜车型</h4>
  </div>

  <!-- Step 0: 基本信息 -->
  <div class="wizard-step" data-step="0">
    <div class="section-title">步骤 1/4: 基本信息</div>
    <div class="row g-2 mb-2 param-row">
      <div class="col" style="min-width:200px">
        <div class="card shadow-sm h-100">
          <div class="card-header py-1 px-2"><div class="card-title mb-0">车型信息</div></div>
          <div class="card-body py-2 px-2">
            <div class="mb-2"><label class="mb-0" style="font-size:13px">车型名称 </label><input id="wiz-name" type="text" class="form-control form-control-sm" placeholder="例如: 新车型A"></div>
          </div>
        </div>
      </div>
    </div>
    <button id="wiz-step0-next" class="btn btn-solid btn-sm">下一步</button>
  </div>

  <!-- Step 1: STEP 上传 -->
  <div class="wizard-step" data-step="1" style="display:none">
    <div class="section-title">步骤 2/4: 镜面轮廓 (STEP)</div>
    <div class="card shadow-sm mb-2"><div class="card-body py-2 px-2">
      <input id="wiz-mirror-step" type="file" accept=".stp,.step" class="form-control form-control-sm mb-2">
      <button id="wiz-parse-mirror" class="btn btn-solid btn-sm">解析镜面轮廓</button>
      <div id="wiz-mirror-result" class="text-muted mt-1" style="font-size:12px">等待上传...</div>
    </div></div>
    <div class="section-title">后挡风轮廓 (可选, 可跳过)</div>
    <div class="card shadow-sm mb-2"><div class="card-body py-2 px-2">
      <input id="wiz-rw-step" type="file" accept=".stp,.step" class="form-control form-control-sm mb-2">
      <button id="wiz-parse-rw" class="btn btn-solid btn-sm">解析后挡风轮廓</button>
      <div id="wiz-rw-result" class="text-muted mt-1" style="font-size:12px">可跳过, 后续用 3DE 手动选点</div>
    </div></div>
    <button id="wiz-step1-prev" class="btn btn-outline-accent btn-sm me-1">上一步</button>
    <button id="wiz-step1-next" class="btn btn-solid btn-sm">下一步</button>
  </div>

  <!-- Step 2: 点坐标 -->
  <div class="wizard-step" data-step="2" style="display:none">
    <div class="section-title">步骤 3/4: 点坐标</div>
    <div class="card shadow-sm mb-2"><div class="card-body py-2 px-2">
      <button id="wiz-catia-btn" class="btn btn-solid btn-sm mb-2">从 3DE 读取</button>
      <small class="text-muted">或手动输入坐标 (mm)</small>
      <!-- 5 个点的输入框, 用 .param-row .card 结构 (同校核页) -->
      <!-- 每个点一个 .col > .card, 含 3 个 input (X/Y/Z) -->
      <!-- id 命名: wiz-pvt-x / wiz-pvt-y / wiz-pvt-z / wiz-cz-x / ... -->
      <!-- 点: pivot / center_zero / eye / ground_front / ground_rear -->
      <div class="row g-2 param-row" id="wiz-points-grid"></div>
    </div></div>
    <button id="wiz-step2-prev" class="btn btn-outline-accent btn-sm me-1">上一步</button>
    <button id="wiz-step2-next" class="btn btn-solid btn-sm">下一步</button>
  </div>

  <!-- Step 3: 标量参数 + 保存 -->
  <div class="wizard-step" data-step="3" style="display:none">
    <div class="section-title">步骤 4/4: 参数 & 保存</div>
    <div class="row g-2 mb-2 param-row">
      <div class="col" style="min-width:130px">
        <div class="card shadow-sm h-100">
          <div class="card-header py-1 px-2"><div class="card-title mb-0">角度</div></div>
          <div class="card-body py-2 px-2">
            <div class="mb-2"><label class="mb-0" style="font-size:13px">yaw </label><small class="unit">°</small><input id="wiz-yaw" type="number" step="any" class="form-control form-control-sm" value="-23.5"></div>
            <div class="mb-2"><label class="mb-0" style="font-size:13px">pitch </label><small class="unit">°</small><input id="wiz-pitch" type="number" step="any" class="form-control form-control-sm" value="5.0"></div>
          </div>
        </div>
      </div>
      <div class="col" style="min-width:130px">
        <div class="card shadow-sm h-100">
          <div class="card-header py-1 px-2"><div class="card-title mb-0">其他</div></div>
          <div class="card-body py-2 px-2">
            <div class="mb-2"><label class="mb-0" style="font-size:13px">圆角R </label><small class="unit">mm</small><input id="wiz-corner" type="number" step="any" class="form-control form-control-sm" value="10"></div>
            <div class="mb-2"><label class="mb-0" style="font-size:13px">瞳距 </label><small class="unit">mm</small><input id="wiz-ipd" type="number" step="any" class="form-control form-control-sm" value="65"></div>
          </div>
        </div>
      </div>
    </div>
    <button id="wiz-step3-prev" class="btn btn-outline-accent btn-sm me-1">上一步</button>
    <button id="wiz-save-btn" class="btn btn-solid btn-sm">保存并校核</button>
  </div>
</div>
```

**Step 2 点坐标输入框** (JS 动态生成, 结构同校核页参数卡):

```javascript
// 5 个点, 每个点一个 .col > .card
const wizPoints = [
  { id: 'pvt', label: '球铰 pivot', default: [2883.07, 0, 1441.017] },
  { id: 'cz',  label: '镜面中心',   default: [2909.215, 0.007, 1441.88] },
  { id: 'eye', label: '眼点中心',   default: [3243.09, -385, 1372] },
  { id: 'gf',  label: '地面前端',   default: [500, 0, 193.209] },
  { id: 'gr',  label: '地面后端',   default: [5900, 0, 193.209] },
];
// 每个 .card 里 3 个 input: id="wiz-{id}-x", id="wiz-{id}-y", id="wiz-{id}-z"
// 用 .param-row .card .card-header .card-body 结构 (同 §18.2.3 参数卡骨架)
// label + small.unit + input.form-control-sm
```

### 12.7 向导逻辑 (app.js)

**全部用 `addEventListener`，禁止 `onclick=`**。

```javascript
let wizardMode = 'verify'; // 'verify' 或 'new'
let wizardData = { name: '', mirrorOutline: null, rwOutline: null, points: null };

function wizardNext(current) {
  document.querySelector(`.wizard-step[data-step="${current}"]`).style.display = 'none';
  document.querySelector(`.wizard-step[data-step="${current+1}"]`).style.display = '';
}
function wizardPrev(current) {
  document.querySelector(`.wizard-step[data-step="${current}"]`).style.display = 'none';
  document.querySelector(`.wizard-step[data-step="${current-1}"]`).style.display = '';
}

function initWizardInner() {
  // 动态生成 Step 2 点坐标输入卡
  buildWizardPoints();
  // 步骤导航 (全 addEventListener)
  $('wiz-inner-back').addEventListener('click', () => showPage('mirror-type'));
  $('wiz-step0-next').addEventListener('click', () => { wizardData.name = $('wiz-name').value || '新车型'; wizardNext(0); });
  $('wiz-step1-prev').addEventListener('click', () => wizardPrev(1));
  $('wiz-step1-next').addEventListener('click', () => wizardNext(1));
  $('wiz-step2-prev').addEventListener('click', () => wizardPrev(2));
  $('wiz-step2-next').addEventListener('click', () => wizardNext(2));
  $('wiz-step3-prev').addEventListener('click', () => wizardPrev(3));
  // STEP 解析
  $('wiz-parse-mirror').addEventListener('click', () => parseStepFile($('wiz-mirror-step'), $('wiz-mirror-result'), 'mirror'));
  $('wiz-parse-rw').addEventListener('click', () => parseStepFile($('wiz-rw-step'), $('wiz-rw-result'), 'rear-window'));
  // 3DE 读取
  $('wiz-catia-btn').addEventListener('click', doWizCatia);
  // 保存
  $('wiz-save-btn').addEventListener('click', saveNewVehicle);
}

// STEP 上传 + 解析
async function parseStepFile(fileInput, resultDiv, type) {
  const file = fileInput.files[0];
  if (!file) { resultDiv.textContent = '请先选择文件'; return; }
  resultDiv.textContent = '解析中... (大文件可能需要 30 秒)';
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const resp = await fetch(API_BASE + '/step/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, content: btoa(e.target.result), type }),
      });
      const data = await resp.json();
      if (data.ok) {
        resultDiv.innerHTML = `✅ 提取 ${data.outline_count} 点轮廓`;
        if (type === 'mirror') wizardData.mirrorOutline = data.outline;
        else wizardData.rwOutline = data.outline;
      } else {
        resultDiv.innerHTML = `❌ ${data.error}`;
      }
    } catch (err) { resultDiv.innerHTML = `❌ ${err.message}`; }
  };
  reader.readAsBinaryString(file);
}

// 3DE 读取 (复用现有 catia_extract, 读完后填充 wiz 点输入框)
async function doWizCatia() {
  // 同 doCatia 流程, 但读完后填充 wiz-pvt-x/y/z 等输入框而非校核页输入框
  // ... (实现时参考现有 doCatia, 改填充目标 id)
}

// 保存新车型
async function saveNewVehicle() {
  // 1. 收集参数: wiz-yaw/pitch/corner/ipd + wiz-pvt/cz/eye/gf/gr 坐标
  // 2. 组装 modena.json 格式的 vehicle JSON (snake_case + m)
  // 3. 如有 mirrorOutline: 保存 outline 文件, JSON 加 mirror.outline_path
  // 4. 如有 rwOutline: 保存 rear-window 文件, JSON 加 rear_window.outline_path
  // 5. POST /api/vehicles/save (复用现有保存 API)
  // 6. 切换到校核页: showPage('inner') + loadVehicleConfig(新路径) + doVerify()
}
```

### 12.8 执行顺序 (给 Haiku 的任务拆分)

| 步骤 | 内容 | 文件 | 预计行数 |
|---|---|---|---|
| **1** | Landing 页改为动作优先 (两张卡片: 校核/新建) | index.html + app.js | ~30 行 |
| **2** | 加镜子类型选择页 (内/外镜) | index.html + app.js | ~40 行 |
| **3** | 校核页参数卡只读逻辑 (有 STEP 时只读) | app.js | ~30 行 |
| **4** | STEP 上传 API (base64 → 临时文件 → spawn Python) | routes.js | ~50 行 |
| **5** | 新建向导 HTML (4 步表单) | index.html | ~80 行 |
| **6** | 向导 JS 逻辑 (步骤切换 + STEP 解析 + 保存) | app.js | ~120 行 |
| **7** | 验证 (npm test + npm start + 浏览器测试) | — | — |

**每步独立可验证**: 完成一步后刷新浏览器确认不报错, 再做下一步。

### 12.9 不做的事 (Haiku 不需要实现)

- 外镜 STEP 提取 (凸球面面名/几何判定不同, 后续单独做)
- 外镜新建向导 (结构同内镜, 数据不同, 内镜跑通后复制改)
- Python step_rear_window.py 合并裁剪逻辑 (当前用命令行验证, API 集成后续做)
- AI 助手深度集成 (window.__aiActions)
- 平台落地页 modules/smart/public/index.html (已有)

### 11.6 STEP 轮廓提取复盘 (2026-08-11)

#### 遇到的问题与解决

| # | 问题 | 根因 | 解决方案 | 通用规则 |
|---|---|---|---|---|
| 1 | **面名不匹配** | 后挡风面名是"玻璃"不是"后挡风" | `--list` 列出所有面 → `--face-id` 手动指定 | 面名匹配失败时降级为手动选面 |
| 2 | **飞线** | B 样条曲线比 EDGE_CURVE 顶点范围长，采样超出边的实际起止点 | 采样后按 VERTEX_POINT 坐标裁剪，只保留 v_start~v_end 之间的点 | **B 样条必须裁剪** |
| 3 | **散点** | 退化边 (<5mm) 采了 30 个点，点挤在一起 | 采样时按边长度自适应：`<5mm` 跳过 | **退化边跳过** |
| 4 | **中心线误判** | 中心线检测条件 `Y跨<5` 误杀了 Y=540 处的短边 (Y跨4mm 但不在中心) | 改为 `Y跨<5 AND |Y均值|<10` | **中心线检测需同时判 Y 值范围** |
| 5 | **左右不对称** | STEP 数据本身不对称 (右735mm vs 左571mm)，待实物确认 | 按实际数据写入，标注待确认 | **STEP 数据即真实，不强行对称** |
| 6 | **上下颠倒** | 后挡风面近乎水平 (法线Z=0.95)，旧投影用法线×宽度向量算"上"方向，结果 +X 为主而非 +Z | 投影改为直接用 Y-Z (从车后看)，不依赖法线 | **视图投影用 Y-Z 直投，不依赖法线** |
| 7 | **JSON NaN 不合法** | Python `json.dump` 写 `NaN`，JS `JSON.parse` 不接受 | 用 `null` 替代，JS 端 `p[0]==null ? NaN : ...` | **JSON 中用 null 不用 NaN** |
| 8 | **轮廓点序不连续** | EDGE_LOOP 拓扑顺序 ≠ 空间顺序，B 样条参数方向 ≠ 顶点方向 | 按顶点裁剪 + orient 翻转 + 左右半 `right+left` 拼接 | **裁剪后 EDGE_LOOP 顺序即正确** |

#### 标准提取流程 (后挡风 / 任意面轮廓)

```
1. 解析 STEP → entities + points
2. 找目标面 (面名匹配, 失败则 --list 手动选)
3. 按 EDGE_LOOP 顺序遍历边:
   a. 跳过退化边 (length < 5mm)
   b. 跳过中心线边 (Y跨<5 AND |Y均值|<10)  ← 仅对称面需要
   c. 采样 B 样条 (n=30 点)
   d. 裁剪: 找 v_start/v_end 在采样序列中的位置, 只保留之间部分  ← 关键!
   e. 对齐: pts[0] 对齐 v_start
   f. orient=False 时翻转
   g. 拼接到轮廓 (去首点重复)
4. 多面合并: right_outer + left_outer (不翻转, 中心线已在各自半边中跳过)
5. 闭合: 首尾距离 >5mm 则追加首点
6. 坐标系校验: X/Y/Z 范围在整车合理区间
7. 输出 JSON (mm, 整车坐标)
```

#### 视图投影规则

- **后挡风视图**: 直接 Y-Z 投影 (u=Y, v=Z)，不依赖平面法线
  - 原因: 后挡风可能近乎水平 (法线 Z 分量大)，法线投影法会导致"上"方向偏到 +X
  - Y-Z 直投保证任意倾斜角度下"上" = 整车 Z+
- **镜面视图**: 用局部 UV 坐标 (已在 ExteriorMirror/Mirror 类中实现，不受影响)

#### 后续待验证

| # | 事项 | 说明 |
|---|---|---|
| 1 | 左右对称性 | 右735mm vs 左571mm，需实物确认是否设计不对称 |
| 2 | 外镜 STEP 提取 | 凸球面，面名/几何判定不同，需适配 |
| 3 | 透光区提取 | 当前后挡风透光区 = 整个轮廓 (无独立透光区)，如需分离需找面的 FACE_BOUND (内环) |
| 4 | STEP 上传 API | 当前只有命令行 (`step_rear_window.py`)，需加前端上传 + API |
| 5 | `step_rear_window.py` 集成裁剪逻辑 | 当前裁剪逻辑在临时脚本中，需合并到 `step_rear_window.py` 的 `sample_edge_curve` |
