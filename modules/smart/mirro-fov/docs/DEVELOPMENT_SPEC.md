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
