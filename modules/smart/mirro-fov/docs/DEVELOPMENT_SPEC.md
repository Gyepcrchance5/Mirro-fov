# mirro-fov 开发与维护规范

> 内外后视镜视野法规校核模块 · GB 15084-2022 I/III 类
> 归属: 智能硬件组 (`modules/smart/mirro-fov/`)
> JS 主开发版本 · 155 断言全绿 · Python 引擎已同步 (66 断言)

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
| Landing 改为动作优先 | ❌ 待实现 |
| 新建向导 UI | ❌ 待实现 |
| 后挡风 STEP 提取 | ✅ 已完成 (11.6 复盘) |
| 外镜 STEP 提取 | ❌ 待实现 |
| STEP 上传 API | ❌ 待实现 (当前只有命令行) |

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
