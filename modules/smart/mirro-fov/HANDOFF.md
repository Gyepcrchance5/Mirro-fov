# HANDOFF — mirro-fov-js (JS 主版本)

> ⚠️ **脱敏说明**: 本文已脱敏入库——真实坐标已替换为示例值、车型代号替换为「车型A/B/C」、供应商数据已抽象化。精确值仅存本地敏感数据（data/ 下未入库文件）。
> **最近更新**: 2026-08-18 (v2.4.0, 最新变更见文末「v2.1~v2.4 变更摘要」+ CHANGELOG.md)
> **状态**: npm test 170 全绿 ✅ | test_step_extraction.py 6/6 ✅ | 左镜✅ / 右镜❌(几何极限)
> **接手者必读**: 本文 + `CHANGELOG.md`(更新日志) + `docs/DEVELOPMENT_SPEC.md`(开发规范) + `docs/DEVELOPMENT_EXPERIENCE.md`(经验沉淀)
> **运行**: `npm start` → http://localhost:3000; `npm test`; `python python/test_step_extraction.py`

---

## 0. 本日工作总结 (2026-08-12)

### 完成
- **提取公共层** (`python/step_topology.py` + `python/step_verify.py`): 顶点锚定采样/自检闸门(连续闭合+无飞线+跨度)/重复描边清理/半模镜像 — 内镜/外镜/后挡风三路径统一, 外镜 0.000mm 回归保持
- **前端重构** (`public/index.html` `public/style.css` `public/app.js`): 黄金比例卡 360×222+8pt 网格/居中美学/无 emoji/绿=状态蓝=动作配色/STEP 进度轮询/选文件自动解析/双视图显式高度自适应
- **上传链路**: base64 编码冻结 → 原始二进制 (`express.raw` + `type:()=>true`); 后挡风输出 `outline_mm` 键名+单位链修复; stderr 详情回传
- **Bug 修复**: 车型数据不同步(pages.inner 未定义) / 默认车型不一致 / 保存崩溃(initInner 顺序) / 异步渲染竞态 / 视图白屏(CSS aspect-ratio→显式像素) / 对抗性审核 5 bugs
- **回归防线**: `python/test_step_extraction.py` 6/6 + npm test 170/170
- **文档**: README 补环境要求 + CHANGELOG 更新日志 + 目录结构补 python/
- **记忆**: `frontend-design-principles` + `common-problem-one-pass` 存入 Claude memory
- **gitignore**: `data/tmp/` → `**/data/tmp/` (原锚定根目录从未生效)

### 关键约定 (同步到后续设计)
- 前端设计理念: 居中/克制无emoji/黄金比例卡 360×222/8pt 网格/绿=已有蓝=新建/字数不强制对齐
- 开发原则: 同类问题抽公共层全路径一起修, 不逐点打补丁
- 配色语义: 蓝=动作(全站按钮统一), 绿=状态(仅 chip, 与内部 PASS 徽章同义)
- 提交后验收: 先 `node --check` + `npm test` + `python python/test_step_extraction.py` 再推送

### 明日待办

| # | 事项 | 细节 |
|---|---|---|
| 1 | **外镜补齐 (阶段三)** | 外镜新建向导 + 外镜 CRUD (保存/删除/另存为), 当前 alert 占位 |
| 2 | **外镜 3DE 读取** | ext-catia-btn 接线 |
| 3 | **后挡风面选择 UI** | 自动选面失败时用户可在界面换候选面 (--face-id 仅命令行可用) |
| 4 | **车型B/车型A STEP 回归** | 提取回归只有 车型C, 另两车型 STEP 不在库 |
| 5 | **DEVELOPMENT_SPEC.md** | 未记录新公共提取层 (锚定/闸门/去重/半模镜像) |
| 6 | **GitHub 版本 tag/Release** | 未建 |
| 7 | **data/vehicles 残留** | 测试文件清理 |
| 8 | **根 README 过时描述** | 功能列表/目录结构/本地测试命令需与模块 README 对齐 |

### 最近提交 (10 commits)
```
9d0d09e fix(web): 对抗性审核修复 — 5 bugs (NaN/硬编码/Enter泄露/rwMM/重复代码)
942422b fix(web): 视图高度改用显式像素计算
6a85b20 fix(web): 异步竞态导致新建车型后数据不同步
7f13135 fix(web): 保存并校核崩溃 + STEP 提取进度显示
59d1a00 docs: 新增 CHANGELOG + README 补新工作流/STEP 接口
8b32a65 docs: README 补环境要求
cb37edf fix: gitignore data/tmp
b664993 feat(web): 视觉重构 + 工作流配色语义 + STEP 上传链路修复
91ea608 feat(step): 提取公共层 — 三条路径统一接入 + 回归测试
419b40f chore: 移除误提交的临时 STEP 文件
```

---

## 1. 项目定位

依据 **GB 15084-2022 I类内后视镜**法规,用三维几何模型校核内后视镜视野。本仓库是 **JS 主版本**,Python 版 (`../Mirro-fov/`) 退为算法参考。

**法规核心**: 驾驶员眼点后方 60m 处,宽 20m(±10m)的水平地平线,经后挡风玻璃被左右眼点观察到。

**主判据**: 五线虚像连线法 — 5 条射线全命中反射面 → PASS。

**坐标系**: 整车坐标系,原点=车身参考点。X+=后方, Y+=乘客右, Z+=上。单位 m,角度度。内部计算全部整车坐标系,无坐标转换。

---

## 2. 文件结构

> **分层视图 (L0–L6)**: 详见 §18。简记: [L0] `style.css` = 设计系统模板(冻结) · [L1] `engine/shared/` = 共享纯数学 · [L2] `engine/{inner,exterior}/` = 分类引擎 · [L3] `routes.js` = API · [L4] `public/` = 前端实例 · [L5] `data/` = 数据 · [L6] `HANDOFF.md` + `docs/` = 文档。

```
mirro-fov-js/
├── engine/                 纯 JS 计算引擎 (零外部依赖), 按 共享/内镜/外镜 三目录分类
│   ├── shared/              [L1] 共享纯数学 (内外都用)
│   │   ├── geometry.js       向量/矩阵/旋转/虚像点反射 + 罗德里格斯 (全共享)
│   │   ├── plane.js          地面模型 Ground + rayPlaneIntersect (从原 ground.js 提出)
│   │   └── polygon.js        2D 多边形谓词 pointInPolygon2D + edgeDistanceTo (从原 rear-window.js 提出)
│   ├── inner/               [L2] 内镜专用 (平面镜 + 五线法)
│   │   ├── mirror.js         Mirror 模型 (球铰刚体, 圆角判定, isOnReflectiveSurface 含 NaN 防御)
│   │   ├── ground.js         反射法FOV(124点)/双眼并集/单眼判据 + reflectRay
│   │   ├── five-line.js      五线校核 (主判据) + 凸包 + 三角形判定
│   │   ├── virtual-image.js  虚像眼法 (参考判据, 4角欠采样)
│   │   ├── rear-window.js    后挡风建模/穿透判定/投影覆盖/2D投影
│   │   ├── optimizer.js      pitch 二分优化 (默认 pitchRange [-5,15], 已修符号约定 bug)
│   │   ├── auto-verify.js    两阶段自动搜角 + computeAngleSummary
│   │   └── test.js           内镜验证 (49 断言, node engine/inner/test.js, 失败非0退出)
│   └── exterior/           [L2] 外镜专用 (凸球面镜)
│       ├── spherical.js      球面求交/反射 (精确闭式解)
│       ├── exterior-mirror.js 外后视镜 (凸球面/轴线旋转/三角形边界线判据/±3°搜索)
│       ├── sphere-fit.js     球心拟合 (共面/非共面双路径) + projectToSphere + 一致性闸门 + 供应商球心校核
│       ├── test-exterior.js  外镜验证 (55 断言, node engine/exterior/test-exterior.js)
│       └── test-sphere-fit.js 球面拟合验证 (51 断言, node engine/exterior/test-sphere-fit.js)
├── routes.js              [L3] Express 路由 (8 API) + fullVerify + loadVehicleJson/loadDefaultConfig
├── public/                 [L4 + L0] 前端实例 + 设计系统模板 (Bootstrap 5 + Plotly.js CDN)
│   ├── index.html           内镜页 + 外镜页 + landing
│   ├── style.css            [L0] 设计系统模板 — Design Tokens + 全部 CSS 组件类 (冻结)
│   └── app.js               前端逻辑 (内镜 + 外镜混合)
├── data/                   [L5] 车型配置 (整车坐标系, JSON, snake_case + 米制)
│   ├── vehicles/            内镜车型
│   │   ├── 车型A.json        车型A 默认车型 (yaw=-23.5 pitch=5, 5/5 PASS)
│   │   └── 车型B.json        车型B (yaw=-22 pitch=8, 5/5 PASS)
│   └── exterior/            外镜车型
│       └── exterior-vehicle-draft.json  真实数据草稿 (未跟踪)
├── docs/                   [L6] 辅助文档 (外镜数学模型等)
├── _test_server.js        [L3] 本地测试服务器 (node _test_server.js → http://localhost:3000)
├── package.json             npm 依赖 (express + js-yaml); npm start = node _test_server.js
├── HANDOFF.md              [L6] 本文件 — 主文档
└── README.md                管理员操作说明
```

---

## 3. 运行

```bash
npm start                   # 启动服务器 → http://localhost:3000
npm test                    # 一键跑全部三套 (49+55+51=170 断言, 任一失败即非0退出并跳过后续)
node engine/inner/test.js           # 内镜引擎测试 (49 断言, 失败非0退出)
node engine/exterior/test-exterior.js # 外镜引擎测试 (55 断言, 失败非0退出)
node engine/exterior/test-sphere-fit.js # 球面拟合测试 (51 断言, 失败非0退出)
node _test_server.js        # 等价 npm start
```

依赖: `express`(服务器) + `js-yaml`(3DE 读 YAML 转 JSON)。前端 Plotly.js 走 CDN(离线时图表隐藏,判定仍显示)。

---

## 4. API 清单 (routes.js)

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/vehicles` | 车型列表 (扫 data/vehicles/*.json) |
| GET | `/api/config?path=` | 车型配置 (扁平 mm 字段, 供前端填表; path 越界已防护) |
| POST | `/api/verify` | 单角度校核 (返回五线/参考判据/镜中倒影/后挡风视图数据) |
| POST | `/api/optimize` | pitch 二分优化 (返回最优 pitch + 收敛信息) |
| POST | `/api/auto-search` | 两阶段自动搜角 (返回 bestYaw/bestPitch + 热图) |
| POST | `/api/vehicles/save` | 保存车型 (path 越界防护 + 默认车型保护) |
| POST | `/api/vehicles/delete` | 删除车型 (path 越界防护 + 默认车型保护) |
| POST | `/api/catia` | 3DE 读取 (代理 Python catia_extract, spawn 前删旧 yaml 防假成功 + 10min 超时) |

---

## 5. 判据体系 (已定稿,勿改)

### 5.1 主判据 = 五线法 (engine/five-line.js)

5 条射线全部命中反射面(含圆角判定 `isOnReflectiveSurface`) → PASS:
1. 中心虚像眼 → BL(−10m)
2. 中心虚像眼 → BR(+10m)
3. 中心虚像眼 → +X 正后方(辅助线,提供三角形高度差)
4. 左虚像眼 → BR(交叉线)
5. 右虚像眼 → BL(交叉线)

- `mirrorPass = 5 条 onMirror 全 true`
- 后挡风穿透 `rearWindowPass` **仅报告不判定**:中心眼 3 线交点全落透光区 → true

### 5.2 参考判据 (engine/inner/ground.js + virtual-image.js, 非主判据)

- `computeFovForEye`(反射法,124点采样):单眼判据偏严,偏航时左眼常 FAIL(非 bug)
- `verifyBinocularUnion`(双眼并集):左右眼 FOV 并集覆盖 ±10m → PASS
- `computeFovViaVirtualEye`(虚像眼法,4角欠采样):yaw≠0 时与反射法有约 0.07m 差异(欠采样)

### 5.3 实车结果 (车型A, yaw=-23.5° pitch=5.0°)

五线法 5/5 PASS。命中点与 Python `main.py --config data/vehicles/车型A.yaml` **逐位一致** (lx/ly 完全相同)。

---

## 6. 核心算法陷阱 (改之前必看)

1. **镜面 = 球铰安装刚体**: `center = pivot + R(yaw,pitch)·armOffset`, `R = Rz(yaw)@Ry(pitch)`(先偏航后俯仰)。`armOffset = centerZero − pivot`。调节后镜面中心会偏移(非原地旋转)。
2. **法线零位 `[+1,0,0]` 朝车尾**。`reflectRay` 用反向光线追踪: `incident = normalize(mirrorPoint − eye)`,反射 `r = d − 2(d·n)n`。正常 `d·n < 0`(约 −0.91)。
3. **五线第 3 条线是 "+X 正后方"** 辅助线,不是 BC 端点。从中心虚像眼沿 `[1,0,0]` 打射线。
4. **眼点左右约定**: left = center − [0,ipd/2,0] (Y−), right = center + [0,ipd/2,0] (Y+)。顺序 [left, right, center]。曾反向致 4/5,已修,勿再翻转。
5. **`isOnReflectiveSurface` 含 NaN 防御**: 非有限值返回 false(曾因 NaN 击穿边界判断返回 true → 假 PASS)。
6. **pitch 优化器符号约定**: pitch 越正 → 法线越上仰 → 反射光越向下 → Z_min 越低。默认 `pitchRange=[-5,15]`。Python 旧版 `(-30,-1)` 方向反了永远走不到二分。
7. **浮点修约**: `loadVehicleJson` 米→毫米 `round3`; `fullVerify` 返回 `lx/ly` 用 `round1`(0.1mm,对齐 Python),坐标向量 `round4`,参考判据 `roundNums` 递归。消除 `4541.63` 尾巴。
8. **reflectRay/rayPlaneIntersect 只在 ground.js**: geometry.js 曾有错误版本(返回值不符 Python),已删。想用反射/求交只能从 ground.js 导入。

---

## 7. 车型数据格式 (data/vehicles/*.json)

```json
{
  "vehicle": { "name": "车型A" },
  "mirror": {
    "width": 0.225, "height": 0.051, "corner_radius": 0.010,
    "pivot": [2.88, 0.0, 1.44],
    "center_zero": [2.91, 0, 1.44],
    "arm_offset": [0.026, 0, 0.001],
    "yaw": -23.5, "pitch": 5.0
  },
  "driver": { "eye_center": [3.24, -0.385, 1.372], "interpupillary_distance": 0.065 },
  "ground": { "front_mid": [0.5, 0.0, 0.20], "rear_mid": [5.9, 0.0, 0.19] },
  "rear_window": {
    "outline": [[4.54,-0.57,1.49], ...],
    "transparent_zone": [[4.71,-0.51,1.45], ...]
  },
  "regulation": { "standard": "GB 15084", "mirror_class": "I", "far_distance": 60.0, "required_width_at_far": 20.0 },
  "tolerance": { "coverage_y": 0.5, "ground_visible_z": 1.0, "pitch_convergence": 0.1 },
  "visualization": { "ground_plane_z": 0.19 }
}
```

- **snake_case + 米制**(与 Python YAML 同结构,仅格式 JSON)
- **坡度地面**: `ground.front_mid`/`rear_mid` 两点定线,φ = atan2(dz, dx)。车型A φ≈−0.16°, 车型B φ≈−0.37°
- **transparent_zone 缺失/空数组** → fallback 到 outline(透光区=整体玻璃)
- **arm_offset 冗余**: 有 center_zero 时自动计算,字段保留向后兼容
- **scanVehicles 只扫 *.json**: Python 旧 YAML 车型不可见(已迁移为 JSON)

---

## 8. 自动搜角逻辑 (engine/auto-verify.js)

两阶段网格搜索,用五线法 `mirrorPass` 判定:

1. **阶段1 种子区** (yaw ∈ [−42°,−18°], pitch ∈ [−10°,10°], 步长 2°): 找到第一个 PASS 立即返回。种子在 yaw≈−30°(法线偏向驾驶员侧,经验最易 PASS)。车型A 找到 yaw=−24°/pitch=4°。
2. **阶段2 全范围兜底** (yaw ∈ [−45°,15°]): 阶段1没找到才扫,跳过已扫种子区。

热循环用轻量 `fiveHit`(只算五线 nHit,不算参考判据);找到后对 best 角度算一次完整 `computeAngleSummary`。

---

## 9. 3DE 读取链路 (routes.js /api/catia)

JS 不能直接 COM,代理调用 Python `catia_extract`:

```
前端点"从3DE读取" → POST /api/catia → spawn python -m mirror_fov.catia_extract
  → CATIA GUI 手动选点 → 输出 YAML → js-yaml 解析 → 转 JSON 存 data/vehicles/ → 自动切换
```

- **stdio: 'inherit'**: 用户在服务终端完成选点/输入(比 Python dashboard 的 capture_output 更好,Python 把提示吞了)
- **spawn 前删旧 yaml**: 防止连接失败(exit 0 不生成新文件)时读到陈旧数据 → 假成功
- **10 分钟超时**: 防止用户走开未完成选点导致请求永久挂起
- **依赖**: 本机装 Python + pywin32 + CATIA/3DE。缺任一会报错(信息明确)
- **numpy 标签风险**: catia_extract 当前用 `float()` 转换不产生 numpy 标签,但旧版曾产生(`extracted.yaml` 有 `!!python/object/apply:numpy.*`),js-yaml 解析会崩。已 catch 给出"转换失败"提示

---

## 10. 已修复的问题清单 (2026-08-04 会话)

### 算法正确性
- `test.js` 假 PASS: 漏传 farDist → NaN → isOn(NaN,NaN)=true → 假 5/5。改为读车型文件 + 断言 yaw=−24°
- `isOnReflectiveSurface` NaN 防御: 非有限值返回 false
- `optimizer.js` pitch 符号 bug: 默认 pitchRange `(-30,-1)`→`(-5,15)`,现能收敛到 pitch≈3.3°
- `geometry.js` 删死函数: reflectRay/rayPlaneIntersect 与 Python 语义不符,正确版在 ground.js

### 数据迁移
- 新增 车型A.json + 车型B.json(含坡度地面,从 Python YAML 迁移)
- 删 default.json(平地退化版) + config.json(camelCase 死文件)
- DEFAULT_VEHICLE → 车型A.json

### 功能补齐
- 前端法规线倒影曲线渲染 + BL/BR 端点标记
- 后挡风投影覆盖 `rearWindowProjectionOnMirror`
- /api/optimize 路由
- 浮点尾巴全局修约
- 卡片 subtitle 补齐(镜面角度/镜面尺寸)

### 安全/鲁棒性
- CRITICAL: /api/config + /api/vehicles/save path 越界任意读写 → 加 startsWith(VEHICLES_DIR) 防护
- CRITICAL: npm start 坏(package.json 指向 routes.js 不 listen)→ 改为 _test_server.js
- HIGH: save 覆盖默认车型 → 加默认车型保护
- HIGH: 默认车型保护大小写敏感 → isDefaultVehicle() toLowerCase 比较 (Windows FS 不区分大小写, '车型A.json' 与 '车型A.json' 同文件, 严格 === 可被大小写变体绕过覆盖/删除默认车型)
- HIGH: padToN([]) 崩溃致车型从列表消失 → 空数组防御
- HIGH: 3DE 陈旧 yaml 假成功 + 无超时 → 删旧 yaml + 10min 超时
- HIGH: 前端 readParams 在 try 外 → 移入 try
- MEDIUM: verify NaN 输入静默假 FAIL → Number.isFinite 校验
- MEDIUM: Mirror 构造器不拒 NaN → Number.isFinite 检查
- MEDIUM: Plotly 离线掩盖判定 → typeof Plotly guard
- MEDIUM: regulationCurve NaN 点穿过滤 → Number.isFinite 过滤
- MEDIUM: transparent_zone=[] 假 FAIL → length>=3 才用

---

## 11. 待办状态

### 11.1 内后视镜 LOW 待办 (已全部清零)

原记录的 7 项 LOW 待办已全部处理:

| 原待办 | 处理 |
|--------|------|
| 死导入清理 (routes.js execFile / auto-verify.js verifyAngle) | 已删 (f060232) |
| 底层函数单元测试 | test.js 新增 section 8 (f060232) |
| verify 报错旧图未清 | doVerify catch 里 Plotly.react 清空双图 + panel/rw 计数复位 |
| 无"另存为新车型"UI | 新增"另存为"按钮 + doSaveAs (不传 path → 后端新建文件) |
| 双击回车重复请求 | doVerify 加 verifyBusy 请求锁 + 按钮禁用 |
| 错误信息泄漏内部 | routes.js friendlyError: TypeError/ENOENT 转通用提示, 业务错误保留 |
| migration_js.md 过时 | 该文件已不存在 (git 历史亦无), 该项作废 |

### 11.2 外后视镜视野校核 (全新方向, 引擎已实现 ✅)

**GB 15084 III 类凸球面镜** (本车外镜定为 III 类, 单球面, 2026-08-05 确认), 与内后视镜(平面镜+五线法)是**另一套建模**。landing 页有"外后视镜"卡片但 `进入` 按钮 disabled。

- **状态**: 引擎 + 单元测试已完成 (外镜 50 + 球面拟合 51 断言), **API/前端未做**; 真实数据已到货 (2026-08-05), 缺轴线 p2; 引擎 III 类视野适配已完成 ✅
- **数学文档**: `../Mirro-fov/docs/exterior_mirror.md`(数学模型与人工流程, 讨论稿)
- **法规要点**: 凸球面镜 **SR 设计 1230±30, 校核用上限 1260** (实测数据恰在 1260 球面, = worst-case); 地面**两个三角形视野区**; 安全距离>3mm; 调节 ±3°
- ✅ **III 类视野已适配**: 引擎 `buildTriangles` 已参数化并显式按 GB 15084-2022 **III 类**工作 (近区: 1m 宽, 从两眼垂面后 4m 起; 远区: 4m 宽, 从眼后 20m 至地平线), 数值读 regulation 的 `dist_near/width_near/dist_far/width_far` (与数据 schema 一致), 缺省即 III 类 (4/1/20/4), 不再硬编码。基准用 `door_outer_Y` (车门最外点, 法规口径"车辆最外点含镜壳"仍待确认); II 类未做 (无数据验证, 参数化支持未来扩展)
- **与内镜区别**: 球面反射(非平面) / 绕**转向器轴线**旋转(非球铰) / 2D 三角形判据(非 1D 五线) / 无遮挡物(侧窗不处理)

**已实现模块** (2026-08-04 已重构为 共享/内镜/外镜 三目录):
- `engine/exterior/spherical.js` — `raySphereIntersect`(精确二次方程闭式解) + `sphereReflectDir`(法线=交点→球心)
- `engine/exterior/exterior-mirror.js` — `ExteriorMirror`(凸球面/帽面局部坐标/绕轴旋转 `rotated()`)/ `DoorPanel` / `findMirrorPointsForTarget`(全球面扫描求反射点)/ `buildTriangles` / `verifyExterior`(边界线判据)/ `searchExteriorAngles`(±3° 网格)
- `engine/shared/geometry.js` 增量 — `rodriguesRotate` / `rotatePointAroundAxis`
- `engine/exterior/test-exterior.js` — 50 断言 (纯几何构造, 不依赖真实车型)

**7 项待确认 — 决策状态** (引擎已按以下拍板实现, 详见 `../Mirro-fov/docs/exterior_mirror.md#L205`):
| # | 待确认 | 决策 |
|---|--------|------|
| 1 | 判据采样策略 | **边界线可见** (三边 N 内点 + 顶点采样, N=20) |
| 2 | PASS/FAIL 逻辑 | 边全采样可见 → 边 PASS; 三边 PASS → 三角 PASS; near && far → mirrorPass |
| 3 | 用眼数 | **中心眼** (未做双眼并集) |
| 4 | 球面反射 | **精确球面公式** (二次方程闭式解, 非近似平面) |
| 5 | 轴线模型 | **Line(方向+过点)**, 绕轴用罗德里格斯旋转 |
| 6 | 非矩形边界 | **outline 点数组** (N≥4, 在球面上, 类似内镜 rear_window) |
| 7 | ±3° 基准 | 以当前安装角为零位, 绕轴线 ±3° 网格搜索 |

**已知关键点**:
- LHD 左外镜「向外」= −Y: 近线 X=eye+4, Y 从 door_outer_Y 到 door_outer_Y−1; 远线 X=eye+20, Y 到 door_outer_Y−4
- 球面矢高 ≈5.9mm > 3mm 安全距离 → **必须精确解**, 不能用直线穿球近似
- `findMirrorPointsForTarget` 全球面扫描 f(θ) 变号区间求根 (曾用 outline 投影角做 bracket, 因帽面在 qHat 反方向时投影角跨越 ±180° 端点同号误判无解 — 环绕 bug, 已改全球面扫描)
- 反射解算误差 ~1e-14 m (构造往返验证)

**后续待办** (优先级从高到低):

**🔴 最高优先 — 真实数据接入** (数据已到货, 唯一硬缺轴线 p2; 引擎 III 类适配已完成):
- **2026-08-05 供应商数据已到货**, 已入草稿 `data/exterior/exterior-vehicle-draft.json` (未跟踪)。已到: 球心(左右) /
  轮廓点(左右各6) / SR(1230±30) / 眼点 / 地面2点 / 车门最外点 / 轴线 p1(左右各1)。
  **已确认**: X+=后方(与内镜同坐标系) / LHD / 单球面 / mirror_class=III / SR 校核用 1260
- 🔴 **唯一硬缺 — 轴线 p2**: 每侧只有 1 个轴线点, 引擎 `turretAxisDir=normalize(p2−p1)` 需 2 点定线。
  左右现有两点是横穿车身的对称点 (dy≈1996), 不是单侧轴线。需供应商左右镜各补第 2 个轴线点
- ⚠️ **关键发现 — sr_fit 盲区已实证** (2026-08-05, 引擎实测):
  - 数据点物理在 **R=1260 校核球面上**, 不在 1230 设计面 (轮廓+供应商球心隐含 R=1260.000mm, 极差 0.001mm)
  - 左右轮廓**都共面** (RMS 0.34mm < 0.5mm → planar-cut 路径), 球心高度 h=√(SR²−r²) **依赖传入 SR**
  - **必须拟合传 `srDesign=1260` (= sr_fit), 不是 1230!** 实测: 传 1230 → 球心沿法线静默偏 30mm (残差恒0=盲区),
    crossCheck 30mm❌ + 一致性闸门 30mm❌ 双拦截; 传 1260 → 球心与供应商 0.00mm 完全一致 ✅
  - 引擎 `srDesign` 参数语义 = "点所在球面的 SR", 非设计标称。1230±30 仅作元数据, 不进拟合
  - 故 JSON schema 加 `sr_nominal`(1.230) + `sr_fit`(1.260) 字段; `projectToSphere(1260)` 是 no-op (位移 0.0002mm)
- ✅ **引擎 III 类适配已完成**: `buildTriangles` 参数化, 读 regulation 的 `dist_near/width_near/dist_far/width_far`
  (缺省即 III 类 4/1/20/4, 与 GB 15084-2022 III 类一致), verifyExterior/searchExteriorAngles 透传 regulation
- **球心拟合已落地** (`engine/exterior/sphere-fit.js`, 51 断言): 自动检测轮廓共面/非共面分支 —
  非共面: 等距定球心(与SR无关); 共面(平面切割, 常见): 面内圆+`h=√(SR²−r²)`沿面法线偏移,
  需 srDesign+眼点定侧 (凸球球心与眼点异侧)。校核用 srVerify=sr_fit, `projectToSphere` 投到 srVerify 球面。
  **自洽防线**: `validateOutlineOnSphere` 一致性闸门 + 供应商球心 `crossCheck` (容差 5mm;
  **planar-cut 盲区**: SR 错→球心静默平移而残差恒0, 交叉校核是唯一防线 → 供应商球心务必拿到, 已到货 ✅)
- **轴线到齐后的接入流程**: 补 p2 → 推导 turretAxisDir → 拟合(传 sr_fit=1260) → crossCheck → 填 JSON →
  verifyExterior/searchExteriorAngles (III 类视野已适配) → 出 PASS/FAIL 结论

**🟡 MED — 建模决策待确认**:
- 三角形顶点 T = 镜面 Z 最高点沿 X 投影, 是文档简化, 是否符合法规判读需确认

**🟢 LOW~MED — 代码待做**:
- ~~球面拟合工具 `fitSphereCenter`~~ → **已完成** (`sphere-fit.js` 双路径, 51 断言, 2026-08-05)
- API: `/api/exterior-verify` + `/api/exterior-search` 路由 (参考 /api/verify 风格)
- 前端: landing 外镜卡片启用 + 外镜参数页
- 数据: `exterior_mirror_left` + `door_panel` schema **草稿已落地** (`data/exterior/exterior-vehicle-draft.json`, 未跟踪; 见 `docs/exterior-mirror-inputs.md` §3, 纯点坐标版); 轴线 p2 到齐后转正
- 3DE: 扩展 `catia_extract` 读外镜参数 (轮廓点/轴线点, 现只读内镜; 若数据全走供应商可降优先)
- 验证: 真实车型数据下的 PASS (当前测试用放大帽面验证聚合逻辑)
- 范围: 先做**左外后视镜**(LHD, Y−); 和 3DE 接入是两条并行线, 不阻塞内镜使用
- **开发流程**: 与内镜一致 —— JS 端开发测试 → 验证通过后同步 Python(JS 为主开发版本)

---

## 12. Python 侧已知 bug (JS 已修, 勿用 Python 当 FAIL 基准)

| Python bug | 位置 | JS 对应 |
|------------|------|---------|
| `optimizer.py:144` 用未定义 `ground_z` | NameError, 二分收尾路径必崩 | optimizer.js:78 正确传 ground |
| `engine.py:536-558` 失败返回 `(None,0,0)` 元组, `h is not None` 恒真 | 射线完全错过镜面平面时假 PASS | five-line.js:69-75 返回 null 且正确拦截 |

Python 回归测试 `test_geometry.py:420-437` 名为"测二分主路径"但实际走早返回,从未覆盖到这两个 bug。**勿拿 Python 的 FAIL 结果当校验 JS 的基准**——可能把 JS 的正确 FAIL 误判为"不一致"。

---

## 13. 快速恢复 prompt (给下一轮 Claude)

> 我在做 Mirro-fov 项目——GB 15084 内后视镜法规校核。JS 版 (`mirro-fov-js/`) 是主开发版本,Python 版 (`../Mirro-fov/`) 退为参考。
> 请先读 `mirro-fov-js/HANDOFF.md` 和 `../Mirro-fov/CLAUDE.md`。
> 主判据=五线法(5线全中),已定稿。反射法/虚像眼法降为参考。
> 坐标系=整车坐标系(原点=车身参考点),pivot=[2.88,0,1.44]m。
> 运行: `npm start` 启服务器 http://localhost:3000; `node engine/inner/test.js` + `node engine/exterior/test-exterior.js` + `node engine/exterior/test-sphere-fit.js` 跑测试 (49+50+51=150 断言)。
> 车型: data/vehicles/*.json (车型A + 车型B, 含坡度地面)。
> 改算法: JS 端开发测试 → 验证通过后同步到 Python(流程反过来)。
> 注意: 眼点左右已修(left=−/right=+),勿翻转。isOnReflectiveSurface 有 NaN 防御勿删。
> reflectRay 从 engine/inner/ground.js 导入; rayPlaneIntersect/Ground 从 engine/shared/plane.js 导入 (geometry.js 的已删)。
> Python 侧有 2 个潜在 bug(optimizer ground_z / five-line 假 PASS),JS 都修对了,勿用 Python FAIL 当基准。
> 3DE 读取依赖本机 Python+pywin32+CATIA,JS 代理调用 catia_extract。
> 外后视镜引擎已实现: engine/exterior/spherical.js + exterior-mirror.js + sphere-fit.js (球心拟合双路径)。7 项待确认已按边界线可见/中心眼/精确球面反射拍板(§11.2 表格)。
> 外镜真实数据 2026-08-05 已到货 (data/exterior/exterior-vehicle-draft.json): III 类单球面, SR 1230±30→校核 1260。⚠️ 拟合必须传 sr_fit=1260。轴线已实测(2026-08-06)。左镜✅PASS / 右镜❌FAIL(几何极限, §15, 下周找供应商)。
> **架构分层 L0–L6 (§18)**: [L0] style.css=设计模板(冻结) · [L1] engine/shared/=共享数学 · [L2] engine/{inner,exterior}/=分类引擎 · [L3] routes.js=API · [L4] public/=前端实例 · [L5] data/=数据 · [L6] HANDOFF+docs/=文档。新增镜子按 §18.9 标准流程。

---

## 14. 今日变更 (2026-08-05 晚会话)

- **npm test 一键跑三套**: package.json test 脚本从只跑内镜改为 `&&` 链式三套 (内镜 49 + 外镜 50 + 球面拟合 51 = **150 断言**), 任一失败即非0退出并短路跳过后续 (已用故障注入 `assert(false,…)` 验证: 退出码1 + 后续两套被跳过)。npm 走 cmd.exe, `&&` 跨 shell 可用, 无新依赖。
- **断言计数订正**: 文档旧值 46/42/139 已过期。实测口径 = 每套实际执行的 `✓` 行 (循环内 1 个 `assert()` 执行多次, 源码 grep 会漏算)。修正后 49/45/51=145, III 类适配后外镜 +5 → **49/50/51=150**。HANDOFF 各计数引用已全量同步。
- **III 类视野适配完成** (上一会话的工作, 本会话定稿): `buildTriangles` 参数化, 读 regulation 的 `dist_near/width_near/dist_far/width_far` (缺省即 III 类 4/1/20/4, 与 GB 15084-2022 III 类一致), `verifyExterior`/`searchExteriorAngles` 透传 regulation; 外镜测试 +5 断言 (§6.5 参数化 + §7.4 plumbing 回归)。"硬编码 II 类"误标全部订正 (HANDOFF + docs/exterior-mirror-inputs.md)。基准仍用 `door_outer_Y` (法规口径"车辆最外点含镜壳"待确认); II 类未做 (参数化支持未来扩展)。
- **下次接手**: 唯一硬缺 = 轴线 p2 (供应商补点) → 之后 API 路由 (`/api/exterior-verify` + `/api/exterior-search`) + 前端外镜页。

---

## 15. 今日变更 (2026-08-06 会话) — 轴线实测 + 双眼交集 + 模型核对 + 真实校核

### 轴线实测 (3DE 读取, 解掉"硬缺 p2")
- 用户在 3DE 读 4 个点: 左/右镜各 Y 向、Z 向距原点 100mm 的点 (4 点全部正好 100mm, 测量干净)。
- **镜体坐标系 ≠ 整车坐标系**: Z 轴 ≈ 整车 Z (偏 0.31°, 折叠轴确认); Y 轴(旋转轴)明显倾斜 — 左偏 22.7°、右偏 32.7° (非镜像对称, 左右安装 yaw 不同或测量偏差, 按实测用)。
- 旋转轴 = Y (上下翻转, ±3°); 折叠轴 = Z (水平折叠, FOV 不建模)。两轴共用原点 p1。
- 数据写入 `data/exterior/exterior-vehicle-draft.json` (axis_y_point/axis_z_point/rotation_axis_dir, 替换原 turret_axis_p2:null)。

### 双眼交集判据 (替代旧"中心眼"决策)
- 旧 7 项决策第 3 项"中心眼" → 改为**双眼交集**: `sampleVisibility` 接受 `{left, right}`, 两眼反射点都在镜面内+margin 才可见 (GB 15084 双眼, 用户确认交集)。
- 单眼输入退化 = 旧行为 (测试兼容)。外镜测试 +3 断言 (退化等价 + 交集严格性: coverMirror T 顶点右眼 margin 不足 → 交集 FAIL)。
- "投影"对齐: 镜片上的投影 = 眼→P→基准面反推的镜面区域 P; 4 个投影 = 2 眼 × 2 基准面; 交集 = 4 个投影都要在反射面内。

### 模型逐条核对 (用户确认, 见 §15 模型表)
- **定区 = YZ 基准面上的竖直三角形** (X=eye+4 近 / X=eye+20 远), 不是地面条带 (曾误读, 已纠正)。
- **三角形顶点**: A=车门侧地面, B=外向 w 米地面, T=镜面最高点沿 X 投影 (T 定法经用户确认 = 校核流程)。
- **反射解算 = 精确反解** (球面反射定律闭式解), 不用虚像眼近似 (球面有球差无单一虚像点; 用户确认精确反解更靠谱)。
- **双眼交集**, 采样每边 20 点 (球面上直线投影是曲线, 3 顶点不够)。
- 基准面: 内/外界定面 = Y=常数 (平行中间面); 眼点垂面 = X=eye.x; 4m/20m 是 X 距离定截面位置; 宽度沿 Y。

### 真实校核结果 (verify-real.js)
- **左镜 ✅ PASS** (near+far 都过, ±3° 窗口 [−0.5°, 0°], 窄但过)。
- **右镜 ❌ FAIL** (近场 AB, X=眼后4m 的 1m 地面线段, 0/22 可见 — 镜面盲区)。对称化右镜也 FAIL → 不是数据不对称问题, 是右镜离左侧司机远、近场地面落进盲区。
- 拟合质量: 左右 crossCheck 均 <0.005mm (sr_fit=1260 正确)。

### 可视化
- `public/exterior-viz.html` (Plotly 3D, 支持 ?data= 切换): 测试场景 + 真实左/右镜。
- `engine/exterior/vis-dump.js` (测试场景) + `verify-real.js` (真实, 按侧别 dump)。

### 右镜 FAIL 根因排查 (2026-08-07 初查, 2026-08-10 二次排查定论)

**最终结论: 代码和数据都正确。右镜 FAIL = 6 点多边形系统性偏小 + 投影选根 bug（已修复）。实际镜面仅覆盖 III 类视野约 88%，需 ×1.12 才能 PASS。**

**2026-08-10 二次排查与修复:**

两次修复：
1. **投影线选根 bug（`9ab2561`）**: 球面反射每个目标点有两个数学根，旧代码取第一个 on-surface 根，相邻采样点可能来自不同分支，导致 UV 坐标跳跃 80-146mm，BT/TA 边投影线弯折断裂。改为 `prevUv` 追踪，选离上一个 UV 最近的根，投影线恢复连续平滑。
2. **缩放诊断（`9ab2561`）**: 在 API + 前端加入 scale 参数和下拉框（×1.00~×1.20），通过均匀放大 outline UV 模拟更大镜面来定位 FAIL 阈值。默认 ×1.12。

**缩放测试结果**:

| 缩放 | near | far | 结论 |
|---|---|---|---|
| ×1.00 (原镜 6 点) | ❌ | ❌ | FAIL |
| ×1.04 | ❌ | ❌ | FAIL |
| ×1.08 | ❌ | ❌ | FAIL |
| ×1.12 | ✅ | ✅ | PASS |
| ×1.15 | ✅ | ✅ | PASS |

**关于 6 点多边形问题的分析**:

凸曲线用少数测量点连成多边形是**系统性偏小**的——多边形永远在真实曲线内部。6 个点切掉的面积不是某一条边的 2-3mm，而是每个角都在亏，累加起来实际约打 88 折。解决方向：

| 方案 | 效果 | 可行性 |
|---|---|---|
| 多测点（如 12-20 点） | 每边亏几 mm → 每边亏零点几 mm，累加误差显著缩小 | 简单，供应商再测一轮即可 |
| 球面弧线插值 | 在多边形相邻点之间沿球面插入短弧段（短边 → 大圆弧），直接逼近实际曲线 | 代码可实现，不依赖新数据 |
| CAD 曲线导出 | 用供应商 3DE 中的精确边界曲线取代离散点 | 最准，取决于供应商配合 |
| 凸多边形膨胀修正 | 在现有 6 点多边形上统一外扩几 mm 作为安全余量 | 工程折中，但无理论依据（不知道实际曲线形状） |

**推荐路径**: 先做球面弧线插值（代码侧快速验证，不需要新数据），如果仍不够再加点。

**2026-08-07 初查结论**:

- 四种眼点模式全部 FAIL — 不是判据口径问题。
- 对称化右镜同样 FAIL — 不是数据不对称问题。
- ±30° 大范围旋转搜索全 FAIL — 不是 ψ 调节范围问题。
- margin 降为 0mm 仍 FAIL — off-surface 的根本在镜面上没有。

**供应商反馈 (2026-08-10)**: 右侧只是几个点，区域不够大。供应商自己的右侧校核也是临界值。

### 剩余开放项
1. **右镜 outline 精度** — 6 点多边形系统性偏小（≈88% 实际面积），需 ×1.12 缩放才能 PASS。解决方向：① 球面弧线插值（代码侧，不需新数据）② 多测点（≥12）③ CAD 曲线导出。推荐先做弧线插值。
2. **"车辆最外点"口径** — 现用车门最外点, 法规可能含镜壳 (影响 A 点, 左右都受影响)。
3. 探索性脚本 `verify-ground-strip.js` / `verify-symmetric-right.js` (曾用于排查, 定区已确认为竖直三角形, ground-strip 作废; 保留作诊断工具)。

### 引擎/数据文件
- `engine/exterior/exterior-mirror.js`: buildTriangles 外向 sign(doorY); sampleVisibility 双眼交集; verifyExterior 中心眼X定位+eye判定; upVec 从世界 Z 派生。
- `engine/exterior/verify-real.js`: 真实数据校核 (拟合→构造→verifyExterior→±3°搜索→dump viz)。
- `engine/exterior/api-verify.js`: API 校核助手 — 车型扫描 + 双镜(L+R)合并校核 + 2D 反射面投影 viz + 共同 ψ 搜索。`mirrorViz2d` 用 prevUv 保持选根空间连续性 (`9ab2561`)。`verifyOne`/`verifyExteriorBoth` 支持 scale 参数 (UV 均匀缩放, 诊断用)。

### 外镜前端页 (2026-08-06, 克隆内镜风格)
- **API** (`routes.js`): `/api/exterior/vehicles` (扫 data/exterior/*.json) + `/api/exterior/config?path=` (参数) + `/api/exterior/verify` (双镜合并校核, 接 psi)。
- **前端** (`public/index.html` + `app.js`): 外镜页克隆内镜结构 — 顶栏(车型下拉+3DE/保存/删除 占位) + 判定面板(左右双徽章+边可见性+拟合) + 参数卡(L|R 拆分独立成卡, 两行, 等高, label+unit 格式) + 两张 2D 反射面投影图(左/右镜面, u-v mm, 左眼蓝/右眼橙投影线, PASS/FAIL 徽章)。
- **自动搜角**: 找两镜都过的共同 ψ (左窗∩右窗), 应用并重渲。
- **风格统一**: `.param-row` 共享类 (卡片样式 1:1); readonly 输入白底; Apple 冷白主题; 反射面 Plotly 同内镜 mirror-view (白底/字体/网格/徽章)。
- **按钮配色统一** (2026-08-07): 校核/自动搜角原用 Flatly `btn-success`(青绿)/`btn-info`(蓝), 与 Apple 蓝主题不搭; 改为 `btn-solid`(#0071e3 实心蓝)/`btn-outline-accent`(蓝描边), 内外镜两页统一, 与顶栏从3DE读取/保存同款。`.btn-solid`/`.btn-outline-accent`/`.btn-outline-danger` 解除 `.top-actions` 限定 (卡片内通用)。
- **landing 色差修复**: `.landing-card-exterior { opacity:.85 }` 致外镜卡片整体发淡 (进入按钮/徽章看着有色差), 已删; 外镜徽章 "已就绪·真实数据" → "已就绪" (同内镜)。
- **缓存破坏**: index.html 对 style.css/app.js 加 `?v=` 版本号, 避免浏览器缓存旧 CSS 致外镜卡片退回默认 Bootstrap 样式。
- **待实现**: 外镜 3DE (Python catia_extract 扩展) + 车型 CRUD (需完整轮廓编辑表单)。当前顶栏按钮给反馈提示。
- **已知**: 右镜 ❌ FAIL (近场盲区, ±3° 无解); 左镜 ✅ PASS (窗口 [-0.5°, 0°])。共同 ψ 无解 (右镜过不了)。

---

## 16. 今日变更 (2026-08-07 会话) — 右镜 FAIL 根因定论

### 排查结论
右镜 FAIL **不是代码 bug、不是数据错误、不是模型问题**，是 LHD 右镜的物理几何极限：
- 驾驶员在左侧 (Y=−0.395)，右镜在右侧 (Y=+1.018)，眼点→帽心 1.498m vs 左镜 0.809m (1.85×)
- 同样尺寸球面帽 (UV≈200×140mm)，左镜刚好覆盖 III 类近场 1m 宽，右镜只覆盖靠车门侧 ~0.4m
- 外半段 (Y>1.4m) 反射点物理滑出镜面轮廓，±30° 旋转全 FAIL，margin=0 也无效
- 对称化右镜 (左镜数据 Y 镜像) 同样 FAIL → 数据不对称不是原因

### 排除项 (全部验证)
- ❌ 判据口径: 四种眼点模式 (双眼交集/中心眼/左眼/右眼) 全部 FAIL
- ❌ 数据不对称: 左镜数据镜像到右同样 FAIL
- ❌ ψ 范围: ±30° 大范围搜索全 FAIL
- ❌ margin 阈值: margin=0 仍 off-surface (不是 margin 问题，是根本不在镜面上)

### 文档更新
- HANDOFF §15: 新增"右镜 FAIL 根因排查"小节，重写"剩余开放项"
- HANDOFF 头: 更新状态描述
- memory: 同步更新 exterior-mirror-spherical-model.md
- 诊断脚本已清理 (check-eyes.js 已删)

### 下一步
等待下周供应商反馈 — 右镜玻璃是否可加大/改安装位置 / 降为 II 类 / 接受 FAIL。

---

## 17. 平台迁移计划 (2026-08-10 修订, 参照 headlight-eval 参考实现)

### 17.1 参考实现

`modules/smart/headlight-eval/` 是已上线的 smart 组模块，作为本次迁移的模板参考。关键特征：

| 特征 | headlight-eval (参考) | mirro-fov (待改) |
|---|---|---|
| 目录层级 | `modules/smart/headlight-eval/` | 项目根目录 |
| `routes.js` 全局 json parser | 无，按路由加 | 有 `router.use(express.json())` |
| 平台能力 | `ai-proxy` + `auth` + `db` | 不需要（纯计算工具） |
| 数据目录 | 平台顶层 `data/headlight-eval/` | 模块自带 `data/` |
| 静态文件 + 首页路由 | `router.use(express.static)` + `router.get('/')` | 无（由 `_test_server.js` 处理） |
| `public/index.html` | 单文件，CSS/JS 内联 | 三文件拆分 |
| `README.md` | 完整（基本信息 + 管理员操作 + 接口文档 + 前端功能 + 目录结构） | 简短 |
| AI Widget | 有 `<script src="/ai-widget.js">` | 无 |
| `_test_server.js` | 无 | 有（规范允许保留） |

### 17.2 目标结构

```
mirro-fov-js/
├── modules/                          ← 新建
│   └── smart/                        ← 交付物: 整个文件夹
│       ├── public/
│       │   └── index.html            ← 新建: 组落地页
│       └── mirro-fov/                ← 模块 (原项目主体)
│           ├── routes.js             ← 改: 删全局 json parser + 加 static/index 路由 + 平台降级
│           ├── engine/               ← 不动 (git mv)
│           │   ├── shared/           L1
│           │   ├── inner/            L2
│           │   └── exterior/         L2
│           ├── public/               ← 不动 (git mv)
│           │   ├── index.html        ← 改: 加 AI Widget + 3DE 降级
│           │   ├── style.css         L0 冻结
│           │   └── app.js            ← 不动
│           ├── data/                 ← 不动 (git mv)
│           ├── docs/                 ← 不动 (git mv)
│           ├── HANDOFF.md            ← 不动 (git mv, 路径自适)
│           ├── README.md             ← 新建: 管理员接入说明
│           ├── package.json          ← 不动 (git mv)
│           └── _test_server.js       ← 不动 (git mv, 本地测试)
├── .gitignore
└── .git/
```

### 17.3 改动清单

#### 步骤 1: 机械搬运 (7 个 git mv)

```
git mv engine/           → modules/smart/mirro-fov/engine/
git mv public/           → modules/smart/mirro-fov/public/
git mv data/             → modules/smart/mirro-fov/data/
git mv docs/             → modules/smart/mirro-fov/docs/
git mv routes.js         → modules/smart/mirro-fov/routes.js
git mv _test_server.js   → modules/smart/mirro-fov/_test_server.js
git mv package.json      → modules/smart/mirro-fov/package.json
git mv HANDOFF.md        → modules/smart/mirro-fov/HANDOFF.md
```

删除根目录 `README.md`（内容合并到模块 README），删除 `node_modules/`（重新 `npm install`）。

#### 步骤 2: routes.js 适配 (改 3 处)

**① 删全局 json parser**（参照 headlight-eval 无全局挂载，按路由加）

```javascript
// 删掉这一行 (第 11 行):
router.use(express.json());

// 需要 body 的路由自己加:
router.post('/api/verify', express.json(), (req, res) => { ... });
```

受影响的 POST 路由共 9 个: `/api/verify`, `/api/optimize`, `/api/auto-search`, `/api/vehicles/save`, `/api/vehicles/delete`, `/api/catia`, `/api/exterior/verify`, `/api/exterior/config`, `/api/exterior/vehicles`。改为每个路由加 `express.json()` 或统一加一个 `router.post('*', express.json())`。

**② 加静态文件 + 首页路由**（参照 headlight-eval 末尾，当前缺失）

```javascript
// routes.js 末尾, module.exports 之前:
router.use(express.static(path.join(__dirname, 'public')));
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
```

**③ 3DE 降级** — `PY_PROJECT` 路径不变（`__dirname` 自动适），但在平台服务器 `/api/catia` 会失败。前端加检测标记即可（见步骤 3）。

#### 步骤 3: 前端适配 (改 2 处)

**① `index.html` 加 AI Widget**（`</body>` 前）

```html
<script src="/ai-widget.js"></script>
```

**② 3DE 按钮降级** — 平台无 Python/CATIA，前端检测 `/api/catia` 是否可用，不可用时按钮灰掉 + tooltip "平台环境不支持 3DE 读取，请本地使用"。

#### 步骤 4: 新建 3 个文件

| 文件 | 内容 | 模板参考 |
|---|---|---|
| `modules/smart/public/index.html` | 组落地页: 5 Tab 导航栏 (smart active) + `MODULES` 数组含 mirro-fov 卡片 + AI Widget | headlight-eval README 里的 MODULES 卡片写法 |
| `modules/smart/mirro-fov/README.md` | 管理员接入说明: 基本信息 + server.js 挂载指令 + npm 包 + 目录结构 | headlight-eval README.md |
| 删除根目录原 `README.md` | 内容合并到模块 README | |

#### 步骤 5: package.json 验证

`npm test` 命令路径在模块目录下不变 (`node engine/inner/test.js && ...`)，因为 cwd 是模块根目录。

### 17.4 不动的部分

| 项目 | 原因 |
|---|---|
| `engine/` 全部 | 纯 JS 零外部依赖，内部 require 相对路径在新位置不变 |
| `public/style.css` | L0 冻结模板 |
| `public/app.js` | 业务逻辑不变，路径依赖 `API_BASE` 自适应 |
| `data/` | `routes.js` 用 `path.join(__dirname, 'data')` 找，迁移后自动正确 |
| `_test_server.js` | 规范 §5-A 明确允许本地测试服务器 |
| 不接入 `ai-proxy` / `auth` / `db` | 纯计算工具，不需要平台 AI/用户/消息能力 |
| `package.json` 依赖 | express + js-yaml 平台已有，无新依赖 |

### 17.5 验证清单

```bash
cd modules/smart/mirro-fov
npm install           # 重新安装依赖
npm test              # 170 断言全绿
npm start             # → http://localhost:3000
```

浏览器验证:
- [ ] landing 页正常渲染，两张卡片可点击进入
- [ ] 内镜页：车型切换 + 校核 + 自动搜角 + 图表正常
- [ ] 外镜页：校核 + 自动搜角 + 缩放滑块 + 两张投影图正常
- [ ] AI Widget 图标出现（平台环境下；本地测试可能加载失败，正常）
- [ ] 3DE 按钮在本地可用，平台环境下灰掉

### 17.6 交付物

将 `modules/smart/` 整个文件夹发给管理员。管理员根据 README.md 在 server.js 添加:

```javascript
const mirroFovRoutes = require('./modules/smart/mirro-fov/routes');
app.use('/mirro-fov', moduleAuth('mirro-fov'), mirroFovRoutes);
```

### 17.7 风险

- **3DE CATIA 读取**: 平台无 Python/CATIA → `/api/catia` 路由保留但不可用，前端降级标记
- **`exterior-vehicle-draft.json`**: 当前未 git 跟踪（`.gitignore`），迁移时确认不丢失
- **`node_modules/`**: 不搬，迁移后 `npm install` 重装

### 18.0 背景

做外镜前端时, 执行 agent 未能准确复现内镜的设计语言 (按钮配色走样、卡片尺寸不一致、布局偏离 Apple 冷白主题)。
根因是设计系统没有从代码中提取出来作为独立模板: agent 看着内镜代码"仿写", 而非"引用同一套模板"。

故将项目按 **模板 → 共享引擎 → 业务分类 → 实例** 四层拆分, 每层有明确规则:
哪些文件是冻结模板 (只引用不修改)、哪些是共享代码、哪些可自由扩展。

### 18.1 分层总览

```
┌──────────────────────────────────────────────────────────────┐
│  L0  设计系统模板 (Design System Template)  ← 冻结, 不可 fork  │
│       style.css    全局 token + 所有 CSS 组件类 + 字体/间距/色值  │
│       HTML 组件骨架  top-bar / param-row / verdict / panel 等     │
├──────────────────────────────────────────────────────────────┤
│  L1  共享引擎 (Shared Engine)            ← 纯数学, 内外通用     │
│       engine/shared/  geometry.js / plane.js / polygon.js      │
├──────────────────────────────────────────────────────────────┤
│  L2  分类引擎 (Per-type Engine)          ← 每类镜子独立        │
│       engine/inner/     内镜: 平面镜 + 五线法                   │
│       engine/exterior/  外镜: 凸球面 + 球心拟合 + 三角视野       │
├──────────────────────────────────────────────────────────────┤
│  L3  API 路由 (Route Layer)              ← 按业务域拆分         │
│       routes.js   (现状: 合并; 目标: routes/inner.js + exterior.js)│
├──────────────────────────────────────────────────────────────┤
│  L4  前端实例 (Frontend Instance)        ← 每类镜子独立        │
│       public/index.html  内镜页 + 外镜页 (共享 L0 的 CSS 组件)  │
│       public/app.js      内镜逻辑 + 外镜逻辑                   │
├──────────────────────────────────────────────────────────────┤
│  L5  数据层 (Data Layer)                 ← 按车型/镜子分类       │
│       data/vehicles/    内镜车型 JSON                           │
│       data/exterior/    外镜车型 JSON                           │
├──────────────────────────────────────────────────────────────┤
│  L6  文档层 (Documentation)               ← 本文 + 关联文档     │
│       HANDOFF.md + docs/ + README.md                            │
└──────────────────────────────────────────────────────────────┘
```

### 18.2 L0 — 设计系统模板 (冻结层, 不可 fork)

**这是整个项目的视觉"宪法"。以下文件只被引用、永远不按镜子类型复制一份。**

#### 18.2.1 Design Tokens (`style.css` §1, :root)

```css
--bg: #f5f5f7;           /* 全局冷白背景 */
--surface: #ffffff;      /* 卡片/图表底色 */
--ink: #1d1d1f;          /* 正文深墨 */
--muted: #6e6e73;        /* 次级文字 */
--faint: #9a9aa0;        /* 弱文字 */
--hairline: #e4e4e8;     /* 分割线 */
--accent: #0071e3;       /* Apple 系统蓝 */
--pass: #34c759;         /* 系统绿 PASS */
--fail: #ff3b30;         /* 系统红 FAIL */
--sans: "Segoe UI", "Microsoft YaHei", ...;  /* 全站字体 */
--mono: var(--sans);     /* 数字等宽 (tabular-nums) */
```

**规则**: 新页面/新模块**永远引用这些 token**，禁止自己定义颜色、字体。一个蓝色 `#007bff` 出现在页面上就是 bug。

#### 18.2.2 CSS 组件类 (`style.css` §2–9, 全部)

以下 CSS 类是项目内所有页面共享的视觉语言。新页面**只使用这些类名**，不自己写等价样式：

| 组件 | 关键类 | 说明 |
|---|---|---|
| 全局 | `body`, `:root`, `label`, `small`, 滚动条 | 字体/颜色/间距基线 |
| 页面头 | `.page-head`, `h4`, `.page-sub` | 标题栏 |
| 坐标提示条 | `.coord-bar`, `.coord-axis`, `.unit` | 白底细边卡片 |
| 判据面板 | `.verdict-panel`, `.verdict-head`, `.verdict-badge`, `.badge-pass`/`.badge-fail`, `.verdict-title`, `.verdict-lines`, `.verdict-line`, `.verdict-status` | PASS/FAIL 双徽章 + 详情行 |
| 参数卡 | `.param-row`, `.card`, `.card-header`, `.card-body`, `.form-control-sm`, `label` + `small.unit` | 等高 card 布局 |
| 图表区 | `.panel-frame`, `.panel-bar`, `.panel-title`, `.panel-count` | 图表容器 |
| 顶栏 | `.top-bar`, `.top-title`, `.top-actions`, `.vehicle-group` | 返回 + 标题 + 车型下拉 |
| 按钮 | `.btn-solid`(主操作蓝), `.btn-outline-accent`(次级蓝描边), `.btn-outline-danger`(危险红描边) | 3 色统一 |
| Landing | `.landing-page`, `.landing-card`, `.landing-title`, `.landing-sub` | 入口页 |
| 后挡风 | `.rw-badge`, `.rw-pass`/`.rw-fail`, `.rw-note` | 参考判据徽标 |
| 区块标题 | `.section-title` | 左灰线标题 |
| 可访问性 | `:focus-visible`, `@media (prefers-reduced-motion)` | 键盘焦点 + 减少动效 |

#### 18.2.3 HTML 组件骨架 (冻结模板)

以下 HTML 片段是**冻结模板**。新页面按需选用，不自己设计等价结构：

**① 顶栏**
```html
<div class="top-bar">
  <button class="btn btn-outline-secondary btn-sm me-2">← 返回</button>
  <h4 class="top-title mb-0">页面标题</h4>
  <div class="top-actions">
    <div class="input-group input-group-sm vehicle-group">
      <span class="input-group-text">车型</span>
      <select class="form-select"></select>
    </div>
    <button class="btn btn-sm me-1 btn-solid">从3DE读取</button>
    <button class="btn btn-sm me-1 btn-outline-accent">保存</button>
    <button class="btn btn-sm btn-outline-danger">删除</button>
  </div>
</div>
```

**② 坐标提示条**
```html
<div class="coord-bar mb-2 small">
  <span style="font-weight:bold">坐标系: </span>整车坐标系 &nbsp;
  <span class="coord-axis">X+</span>=后方 &nbsp; ... &nbsp;
  <span class="text-muted">| 单位: mm</span>
</div>
```

**③ 判据面板 (单徽章)**
```html
<div class="alert alert-light py-3 px-3 mb-0 verdict-panel">
  <div class="verdict-head">
    <span class="verdict-badge badge-pass">PASS</span>
    <div class="verdict-body">
      <div class="verdict-title">
        <span class="verdict-rule">判据名</span>
        <span class="verdict-spec">法规参数</span>
        <span class="verdict-status">状态</span>
      </div>
      <div class="verdict-lines">...</div>
    </div>
  </div>
</div>
```

**④ 参数卡 (一个卡片的完整 HTML)**
```html
<div class="col" style="min-width:130px">
  <div class="card shadow-sm h-100">
    <div class="card-header py-1 px-2">
      <div class="card-title mb-0">卡片标题</div>
      <small class="text-muted">副标题</small>
    </div>
    <div class="card-body py-2 px-2">
      <div class="mb-2">
        <label class="mb-0" style="font-size:13px">参数名 </label>
        <small class="unit">单位</small>
        <input type="number" step="any" class="form-control form-control-sm">
      </div>
      <!-- 操作按钮区 (可选) -->
      <div class="text-muted mt-2 pt-1 border-top" style="font-size:11px">提示文字</div>
      <button class="btn btn-solid btn-sm mt-2 w-100">校核</button>
      <button class="btn btn-outline-accent btn-sm mt-1 w-100">自动搜角</button>
      <div class="text-muted mt-1" style="font-size:11px"></div>
    </div>
  </div>
</div>
```

**⑤ 图表区**
```html
<div class="panel-frame">
  <div class="panel-bar">
    <span class="panel-title">图表标题</span>
    <span class="panel-count">状态计数</span>
  </div>
  <div style="width:100%;height:600px"></div>
</div>
```

**⑥ Landing 卡片**
```html
<div class="landing-card">
  <h4>模块名</h4>
  <h6 class="text-muted">副标题</h6>
  <p class="landing-desc">描述文字</p>
  <span class="badge" style="background:#34c759">已就绪</span>
  <button class="btn btn-primary btn-lg landing-btn">进入</button>
</div>
```

#### 18.2.4 L0 规则 (违反即为 bug)

| # | 规则 |
|---|---|
| 1 | **禁止自定义颜色**: 页面中任何 `color:` / `background:` 必须来自 L0 token; 唯一的例外是 `.badge` 背景和 Plotly trace 颜色 (用 `C` 对象) |
| 2 | **禁止重写 CSS 组件**: 新页面只用现有 CSS 类, 不新写等价样式覆盖 `.card`/`.verdict-panel`/`.top-bar` |
| 3 | **字体不分裂**: `font-family` 统一用 `var(--sans)` 或 `var(--mono)`, 不引入第三方字体 |
| 4 | **HTML 从模板出发**: 新页面的顶栏/参数卡/判据面板/图表区严格按 §18.2.3 骨架搭建, 只换内容不换结构 |
| 5 | **Plotly 布局锁定**: `mirror-view` 的 font/paper_bgcolor/plot_bgcolor/margin 已定稿, 新 Plotly 图表以此为基准 |

### 18.3 L1 — 共享引擎 (不改, 仅引用)

`engine/shared/` 是内外镜公用的纯数学层, 零外部依赖:

| 文件 | 导出 | 用途 |
|---|---|---|
| `geometry.js` | vec3*, rodriguesRotate, rotatePointAroundAxis | 向量/矩阵/旋转 |
| `plane.js` | Ground, rayPlaneIntersect | 坡度地面模型 |
| `polygon.js` | pointInPolygon2D, edgeDistanceTo | 2D 多边形谓词 |

**规则**: 这些文件对内外镜完全通用, **新镜子类型不加新函数到此层**（共享需求极度罕见, 先放在业务层, 确认两处复用再提升）。

### 18.4 L2 — 分类引擎 (每类镜子独立)

| 目录 | 用途 | 核心输出 |
|---|---|---|
| `engine/inner/` | 平面镜 + 五线法 | `fiveLineVerification` / `searchPassingAngles` / `optimizePitch` |
| `engine/exterior/` | 凸球面镜 + 球心拟合 + 三角视野 | `fitSphereFromOutline` / `verifyExterior` / `searchExteriorAngles` |

**规则**: 新镜子类型复制此结构 — 新建 `engine/新类型/`, 内部自由组织文件, 只依赖 L1 (shared), 不依赖 L0/L3/L4。

### 18.5 L3 — API 路由 (目标态: 按业务域拆分)

**现状** (`routes.js` 合并): 内镜 8 个 API + 外镜 3 个 API 在同一文件 (634 行)。

**目标态** (迁移到平台时拆分):

| 文件 | 路由 | 用途 |
|---|---|---|
| `routes/inner.js` | `/api/vehicles`, `/api/config`, `/api/verify`, `/api/optimize`, `/api/auto-search`, `/api/vehicles/save`, `/api/vehicles/delete`, `/api/catia` | 内镜全 API |
| `routes/exterior.js` | `/api/exterior/vehicles`, `/api/exterior/config`, `/api/exterior/verify` | 外镜全 API |

**规则**:
- 每个路由文件 `module.exports = router`，**不自己调** `router.use(express.json())` (平台全局挂载)
- 共享工具函数 (`isDefaultVehicle`/`round3`/`friendlyError`/`mmToKm`) → `routes/shared.js`
- 新镜子 → 新建 `routes/新类型.js`

### 18.6 L4 — 前端实例 (每类镜子独立)

| 文件 | 现状 | 目标态问题 |
|---|---|---|
| `public/style.css` | 共享设计系统 | 已经是 L0, **不属于 L4** (不应被镜子实例修改) |
| `public/index.html` | 内镜 + 外镜 混在同一文件 (403 行) | 迁平台时拆: `public/landing.html` + `public/inner/index.html` + `public/exterior/index.html` |
| `public/app.js` | 内镜 + 外镜 混在同一文件 | 迁平台时拆: `public/inner/app.js` + `public/exterior/app.js`, 共享逻辑提 `public/shared.js` |

**规则**:
- 每个镜子实例的 HTML **必须从 L0 模板骨架出发**（§18.2.3），不自己设计新布局
- Plotly 颜色用 `C` 对象 (app.js 第 9 行): `mirrorFace`/`hit`/`miss`/`regulation` 等, 新图表复用同一调色板
- 前端 JS 共享工具 (Plotly helpers、凸包、参数收集) → `public/shared.js`

### 18.7 L5 — 数据层 (按镜子类型分目录)

| 目录 | 内容 |
|---|---|
| `data/vehicles/` | 内镜车型 JSON (车型A.json, 车型B.json) |
| `data/exterior/` | 外镜车型 JSON (exterior-vehicle-draft.json) |

**规则**: JSON 字段命名 snake_case + 米制; 与内镜现有 schema 风格一致 (含 `_meta` 元数据块)。

### 18.8 L6 — 文档层

| 文件 | 角色 |
|---|---|
| `HANDOFF.md` | 主文档 (本文件) — 架构/算法/判据/待办/历史 |
| `docs/` | 补充文档 (外镜数学模型等) |
| `README.md` | 管理员接入说明 (平台迁移后建) |

### 18.9 新增镜子类型的标准流程

假设未来新增「电子后视镜 (CMS)」:

| 步骤 | 操作 | 参考模板 |
|---|---|---|
| 1. L2 引擎 | 新建 `engine/cms/` + 纯函数 + `test-cms.js` | 仿 `engine/exterior/` 结构 |
| 2. L4 前端 | 新建页面: 拷贝 §18.2.3 的顶栏/坐标条/判据面板/参数卡/图表区骨架, 填充 CMS 专属字段 | **严格从模板出发, 不改 CSS 类名** |
| 3. L4 JS | 新建 `public/cms/app.js`: 复用 `C` 调色板, 复用 `public/shared.js` Plotly helpers | `C` 对象直接 import 或复制 |
| 4. L3 API | 新建 `routes/cms.js`: `module.exports = router`, 不调 json parser | 仿 `routes/exterior.js` |
| 5. L5 数据 | 新建 `data/cms/` + schema | 仿 `data/exterior/exterior-vehicle-draft.json` |
| 6. L6 文档 | 更新 HANDOFF.md | 新增 §xx CMS 引擎说明 |

### 18.10 分层与平台迁移的关系

平台迁移 (§17) 的目录结构直接映射到本分层:

```
modules/smart/mirro-fov/
├── [L1] engine/shared/        # 共享引擎
├── [L2] engine/inner/         # 内镜引擎
├── [L2] engine/exterior/      # 外镜引擎
├── [L3] routes.js             # API (目标态拆分 routes/{inner,exterior}.js)
├── [L4] public/               # 前端实例
│   ├── [L0] style.css         # 设计系统模板 (冻结)
│   ├── [L4] index.html        # 首页 (含内镜+外镜 HTML)
│   └── [L4] app.js            # 前端逻辑
├── [L5] data/                 # 数据层
├── [L6] HANDOFF.md            # 文档
└── [L6] README.md             # 管理员接入说明
```

L0 实际物理存放于 `public/style.css`, 但逻辑上它是被所有 L4 前端实例共享的冻结模板。
迁移后若前端页面拆分到多文件, `style.css` 不随页面复制 — 每个 HTML 统一 `<link href="/mirro-fov/style.css">` 引用同一份。

---

## 20. Python 版同步计划 (2026-08-10 规划)

### 20.1 背景

JS 版已升为主开发版本，大量外镜开发完成后 Python 版未同步。Python 版的战略定位是 **3DE COM 接口的唯一入口**（JS 通过 spawn 代理调用 Python），不能退化或废弃。

### 20.2 现状差距

| 模块 | JS (当前) | Python (待同步) |
|---|---|---|
| **共享数学** | `engine/shared/` — geometry.js, plane.js, polygon.js | ✅ `engine.py` 内已有等价实现 |
| **内镜引擎** | `engine/inner/` — mirror, five-line, ground, rear-window, optimizer, auto-verify, virtual-image | ✅ `engine.py` + `models.py` 完整 |
| **外镜引擎** | `engine/exterior/` — spherical.js, exterior-mirror.js, sphere-fit.js, api-verify.js | ❌ **完全缺失** |
| **外镜测试** | test-exterior.js (55), test-sphere-fit.js (51) | ❌ 无 |
| **外镜 API** | routes.js `/api/exterior/*` | ❌ 无（Python 无独立 API 层） |
| **3DE 读取** | JS 代理调用 Python | ✅ catia_conn.py ✅ catia_extract.py |
| **3DE 外镜轮廓** | 无 | ❌ catia_extract 目前只做内镜（选点模式） |

### 20.3 同步任务

#### P1 — 外镜引擎移植 (核心算法, 无外部依赖)

将三个 JS 外镜模块移植为 Python:

| JS 文件 | Python 目标 | 核心算法 |
|---|---|---|
| `engine/exterior/spherical.js` | `mirror_fov/spherical.py` | `raySphereIntersect` (二次方程闭式解), `sphereReflectDir` |
| `engine/exterior/exterior-mirror.js` | ✅ `mirror_fov/exterior_mirror.py` (2026-08-10) | `ExteriorMirror` 类, `findMirrorPointsForTarget` (全球面扫描+二分), `buildTriangles`, `sampleVisibility` (双眼交集), `verifyExterior`, `searchExteriorAngles` |
| `engine/exterior/sphere-fit.js` | ✅ `mirror_fov/sphere_fit.py` (2026-08-10) | `fitSphereFromOutline` (共面/非共面双路径), `projectToSphere`, `validateOutlineOnSphere` (一致性闸门), `crossCheck` (供应商球心校核) |
| `engine/shared/geometry.js` (罗德里格斯) | ✅ `mirror_fov/spherical.py` | `rodriguesRotate`, `rotatePointAroundAxis`, `raySphereIntersect`, `sphereReflectDir` |

**P1 已完成** (2026-08-10): 三个文件共约 600 行 Python, 测试 66 断言全部通过 (`python tests/test_exterior_mirror.py`)。

移植要点:
- JS `findMirrorPointsForTarget` 是全球面扫描 f(θ) 变号区间 + 二分求根, Python 直接翻译
- `planar-cut` 盲区逻辑完整保留 (SR 错→静默平移, crossCheck 唯一防线)
- 依赖: 只依赖 `numpy` (已有的), 不引入新包

#### P2 — 测试移植

| JS 测试 | Python 目标 |
|---|---|
| `test-sphere-fit.js` (51 断言) | `tests/test_sphere_fit.py` |
| `test-exterior.js` (55 断言) | `tests/test_exterior_mirror.py` |

#### P3 — catia_extract 扩展外镜轮廓

现状: 只支持内镜逐个选点。

目标: 新增"外镜轮廓批量模式"——用户沿镜面边界逐个选点（操作方式不变），脚本识别为外镜模式后将所有点放入 `outline_raw` 数组，输出到 `data/exterior/*.json`。

前置条件: `probe_curve_hybrid.py` 的探测结果。如果曲线 HybridShape 有 `Evaluate()` 类方法，可以走"选一次曲线→自动采样 N 点"的更优路径。

### 20.4 不需要同步的部分

| 项目 | 原因 |
|---|---|
| `public/` 前端 | Python 不承担前端渲染，JS 已做好 |
| `routes.js` API 层 | Python 无独立 Web 服务，JS Express 已覆盖 |
| `api-verify.js` viz 逻辑 | 2D 投影是 JS API 的前端数据准备，Python 不涉及 |

### 20.5 执行策略

1. **先做 P1 (外镜引擎)** — 这是 3DE 接口能拿到外镜数据后跑校核的必要条件。移植量约 500-700 行 Python。
2. **再做 P3 (catia_extract)** — 依赖 `probe_curve_hybrid.py` 探测结果
3. **最后 P2 (测试)** — 引擎移植时同步写，JS 已有完整 case 对照

注意: **P1 和 P3 是并行线** — 引擎移植只需要算法, 不需要等 3DE 接口; 3DE 接口只负责把数据拿到手。两条线一起推进, 汇合点是"拿到外镜轮廓数据 → 跑 Python 外镜校核 → 出 PASS/FAIL"。

---

## 19. 今日变更 (2026-08-10 会话) — Python 外镜引擎移植 + 平台迁移计划修订 + 投影修复

### Python 外镜引擎移植 (§20 P1 完成)
- `mirror_fov/spherical.py`: 球面求交/反射 + 罗德里格斯旋转
- `mirror_fov/sphere_fit.py`: 球心拟合双路径 + 一致性闸门 + crossCheck
- `mirror_fov/exterior_mirror.py`: ExteriorMirror 类 + 全球面扫描反射 + 双眼交集 + verifyExterior
- `tests/test_exterior_mirror.py`: 66 断言 ALL PASSED
- `scripts/probe_curve_hybrid.py`: 3DE 曲线 HybridShape 探测脚本 (备选方案)
- 对照 JS 版逐一翻译, 仅依赖 numpy

### 平台迁移计划修订 (§17 重写)
- 参照已上线模块 `headlight-eval/` 重写，统一修改方式
- 5 步: 机械搬运 → routes.js 适配 → 前端适配 → 新建 3 文件 → 验证
- routes.js: 删全局 json parser (参照 headlight-eval 无全局挂载) + 加 static/index 路由 + 3DE 降级
- 前端: 加 AI Widget + 3DE 按钮平台降级
- 交付物: `modules/smart/` 整个文件夹

### 投影选根 bug 修复 (`9ab2561`)
- 球面反射每点两数学根，用 prevUv 选最近根，消除 BT/TA 边 UV 跳跃

---

## 21. 3DE 采样能力探测定论 + STEP 路径落地 (2026-08-11)

### 21.1 背景

右镜 FAIL 根因 (§15/§16) = 6 点多边形系统性偏小 (≈88% 实际面积, 需 ×1.12 缩放才 PASS)。
解法方向之一: 提升采样分辨率 (HANDOFF §15 "球面弧线插值/多测点/CAD 曲线导出")。
用户判断: **采样是建模的一部分**, 应努力"更快更好地完成采样", 而非用插值猜不准的数据。
本节记录 3DE 采样能力的彻底探测 + STEP 导出路径的落地。

### 21.2 3DE COM 采样能力 — 三轮探测全部否决 (最终结论)

**结论: 3DEXPERIENCE COM API 不实现曲线离散化/多点采样。** MeasurableService 是"测量"服务 (算长度/面积/单点坐标), 不是"几何采样"服务。`GetPoints` 方法在 COM 接口存在 (GetIDsOfNames 能查到) 但 CATIA 实现拒绝执行, 无论 BRep edge 还是 HybridShape 参数化曲线, 无论装配还是 Part 编辑, 统一失败。

三轮探测覆盖 (2026-07-28 外部 Mirro-fov + 2026-08-11 两轮内嵌):

| 路径 | 探测 | 结果 |
|------|------|------|
| Measurable(curve) `GetPoints` | 装配 + Part | ❌ com_error "The method GetPoints failed" |
| `GetPointsOnCurve`/`GetParametricPosition` | 两轮 | ❌ absent (不在 typeinfo) |
| HybridShape `Evaluate`/`GetControlPoints` | Part | ❌ absent |
| `SelectElement3` 多点连续选 | 交互测 | ❌ 签名不兼容, 且语义非多点 |
| `Search` 批量选 | 非交互 | ❌ failed |
| VisuServices tessellation | 2026-07-28 | ❌ 命中但无 tessellation 方法 (外部 HANDOFF.md:500) |
| editor.ActiveViewer | 2026-07-28 | ❌ 不可达 |
| `editor.Export`/`ExportData` 编程导出 | 2026-08-11 | ❌ editor 无 Export 方法, 只能 GUI 手动 |
| ITypeInfo 方法表枚举 | 2026-08-11 | ❌ E_FAIL (3DE 对象不实现 ITypeInfo) |
| Part 编辑层级 GetPoints | 2026-08-11 | ❌ 与装配同 (5 条 HybridShape 曲线全 failed) |

**唯一可用 COM API**: `GetPoint`(tid=8, 单点) / `GetLength`(tid=4) / `GetArea`(tid=10)。
**Part 编辑层级确实有突破** (§21.4), 但突破在"访问"层不在"采样"层。

§20.3 P3 设想的 "选曲线自动采样" 正式否决 — 之前只是计划, 从未实现也从未探测, 现在探了, 否了。

### 21.3 Part 编辑层级访问突破 (但不解采样问题)

独立镜片零件文件 (车型C) + 3DShape 编辑模式下, 首次拿到 Part 对象:
- `ed.ActiveObject` (属性访问, 非方法) → CDispatch, `.Name = '3sh09395088'`
- `ao.HybridBodies` (属性, 无括号) → Count=1, "Geometrical Set.1"
- `hb.HybridShapes` → 6 个 shape: Point.1 + 5 条曲线 (曲线.4/Curve.2/Curve.3/曲线.5/曲线.6)
- `ao.CreateReferenceFromObject(curve)` → Reference (Measurable 可用)
- `GetLength` 全部工作: 528/241/53/33/31mm

**但 `GetPoints` 在 Part 层级 HybridShape 曲线上仍 failed** (§21.2 表)。访问层突破只能用于"枚举几何集 + 看曲线名 + 量长度", 不能采样。

### 21.4 STEP 导出 + Python 解析路径 — 已落地 ✅

3DE COM 读不到的曲线参数化定义, **STEP 导出完整保留** (ISO 10303-21 BRep 格式)。
纯 Python + numpy 解析, 零重依赖 (不需 pythonocc/conda/FreeCAD)。

**落地文件** (python/):
- `step_curve_sampler.py` — STEP 解析器 + B-spline de Boor 采样 + CIRCLE 采样 + `--output-json` outline 拼接
- `test_step_sampler.py` — 18 断言全绿 (车型C 真实数据)
- `catia_extract.py --mode step-curve` — 转调 step_curve_sampler, 不连 COM

**验证数据** (车型C-INNER-MIRROR STEP, 49MB):
- 解析: 694420 实体, 242886 点, 10046 B-spline 曲线
- #270368 (478mm, 207 控制点, 5 次) 采样 30 点:
  - X=2909.216 (= center_zero.x 2.91m, 镜面平面) ✅
  - Z 跨度 50.789mm (= 车型A height 0.051m) ✅
- #174205 (261mm, 29 控制点, 3 次) 采样 16 点:
  - Y 跨度 246.5mm (= width 224.8mm + 圆角余量) ✅
- CIRCLE 采样: 圆上点到圆心距离 = 半径, 误差 1e-13mm (机器精度) ✅
- 密度可调: 同一曲线 10/50/100 点无掉点 ✅

**关键优势**:
| 项 | COM 路径 (死) | STEP 路径 (活) |
|----|--------------|----------------|
| 曲线获取 | Measurable 拿不到点 | ✅ 10046 条曲线全在 |
| 采样 | GetPoints failed | ✅ de Boor, 任意 N 点 |
| 分辨率 | 6 点手选 | ✅ 207 控制点 → 30/50/100 点 |
| 坐标 | — | ✅ 整车坐标系 mm, 0.001mm 精度 |
| 依赖 | pywin32 + 3DE 运行 | ✅ 纯 Python+numpy, 不需 3DE |

**CLI 用法**:
```bash
# 列曲线 (按长度排序, 找边界曲线 ID)
python step_curve_sampler.py car.stp --list
# 采样单条曲线
python step_curve_sampler.py car.stp --curve-id 270368 --n 30
# 拼多条曲线成 outline JSON (米制, exterior schema 格式)
python step_curve_sampler.py car.stp --output-json outline.json --curve-ids 270368,174205 --n 20
# 经 catia_extract 入口 (routes.js 可复用 spawn 路径)
python -m mirror_fov.catia_extract -m step-curve --step-file car.stp --curve-ids 270368,174205 --n 20 --output outline.json
```

### 21.5 修复的 bug (a92600e 回归)

- **`python/mirror_fov/__init__.py` 导入崩溃**: a92600e 内嵌 Python 脚本时, `__init__.py` 仍是完整包版本, `from .models import …` 引用 11 个未内嵌模块 (models/engine/optimizer/...) → `import mirror_fov` 即 ModuleNotFoundError → `python -m mirror_fov.catia_extract` 启动即崩 → 两条 3DE 路由 (`/api/catia`, `/api/catia/exterior`) 本地全断。改为轻量子包 (仅 catia_conn + catia_extract)。`npm test` 不碰 Python spawn, 故回归未被覆盖。

### 21.6 探测脚本清单 (python/)

| 脚本 | 用途 | 状态 |
|------|------|------|
| `probe_curve_sample.py` | 装配层级曲线采样探测 | 保留 (诊断工具) |
| `probe_curve_partlevel.py` | Part 层级曲线采样探测 | 保留 (诊断工具) |
| `probe_multiselect.py` | SelectElement3 多点选择探测 | 保留 (诊断工具) |
| `step_curve_sampler.py` | STEP 解析 + B-spline/CIRCLE 采样 (单条曲线) | ✅ 18 断言 |
| `step_topology.py` | **STEP 拓扑识别反射区面 + 自动采样 + 镜像 (生产)** | ✅ 车型A 验证 |
| `test_step_sampler.py` | step_curve_sampler 测试 | ✅ 18 断言 |
| `trace_face.py` | 反向追踪曲线所属面 (诊断) | 保留 |

### 21.7 后续待办

- **外镜 STEP 验证**: 当前验证用内镜 STEP (平面镜, 矩形边界)。外镜 (凸球面) 需导出 STEP → 采样 outline → sphere-fit → verifyExterior, 对比 6 点手选结果 (看右镜能否从 ×1.12 降到 ×1.00 PASS)。
- **routes.js 接入**: `/api/catia/exterior` 当前 spawn `--mode exterior` (COM)。加 `--mode step-curve` 路由或前端选项, 让用户上传 STEP 文件 → 后端采样 → outline JSON。
- **曲线识别自动化**: 当前 `step_topology.py` 已能按面名+尺寸自动识别反射区面 (§21.8), 外镜可复用但需确认面名。
- **多曲线拼接**: `step_topology.py` 已用拓扑遍历 (EDGE_LOOP 顺序 + ORIENTED_EDGE 方向) 解决拼接, 不需手动列 curve-ids。

### 21.8 STEP 拓扑识别 + 内镜方案②落地 (2026-08-11 续)

**背景**: §21.4 的 step_curve_sampler 需手动指定 `--curve-ids`, 且内镜镜片有 16050 条曲线无法靠长度猜。本节用 STEP 拓扑关系确定性识别反射区面, 并落地方案② (显示+校核统一用真实轮廓)。

**拓扑识别** (`step_topology.py`):
- STEP AP214 拓扑链路: `ADVANCED_FACE(name, (bounds), surface)` → `FACE_OUTER_BOUND/BOUND` → `EDGE_LOOP` → `ORIENTED_EDGE(orient=.T./.F.)` → `EDGE_CURVE` → 几何曲线 (B_SPLINE/CIRCLE/LINE)
- 反射区面识别: 名字含 "内镜片/镜面/lens" + 平面 (X跨<5) + Z跨≈50.8 (高度) + Y跨≈112 (半边) 或 225 (全宽)
- **车型C-INNER-MIRROR 实测**: 面名 = `MS11内镜片` (#270583, 4 边), Unicode 解码 STEP `\X2\` 转义
- **半边建模**: STEP 只建左半 (Y -112~0), 右半靠 Y=0 对称。镜像 Y→-Y 成全宽
- **U 形 B-spline 边**: 镜片轮廓边是 U 形曲线 (顶→侧→底, 单条即半边轮廓), 不是单条直边。选最长非退化边 (>5mm) 做半边轮廓, 不拼 4 条边 (退化边 <5mm 是对称轴上的缝)
- **ORIENTED_EDGE 方向**: orient=.F. 时反转采样点序, 保持 LOOP 闭合方向

**关键发现**:
- STEP 面名 `\X2\77295149\X0\lens` 解码 = "眩光lens" (352 个分块面, 非反射区)
- `MS11内镜片` (#270583) 才是反射区面 — 名字识别要含 "内镜片", 不能只匹配 "lens"
- 4 条边里 2 条是退化缝 (Y=0 对称轴, 0.1-0.2mm), 2 条是主边界 (369mm + 478mm U 形)
- 镜像后 Y跨 224.70mm ≈ width 224.8mm, Z跨 50.79mm ≈ height 50.8mm (差 0.4mm)

**方案②落地** (显示+校核统一真实轮廓):
- `Mirror.js`: 加 `outlineLocal` 参数 (可选 [[lx,ly] mm]); `isOnReflectiveSurface` 有 outline 用 point-in-polygon (射线法, `Mirror.pointInPolygon`), 无则退回圆角矩形; `reflectiveOutlineMM` 同理
- `routes.js`: `loadVehicleJson` 读 `mirror.outline_path` 加载 outlineLocal; `/api/config` 返回; `fullVerify` 接 `outlineLocal` 传 mirrorBase; verify 路由透传; fullVerify 返回 `mirror.outline` (xs/ys)
- `车型A.json`: 加 `mirror.outline_path: "车型A.outline.json"`
- `data/vehicles/车型A.outline.json`: 162 点真实轮廓 (STEP 采样, 镜像后)
- `app.js`: `currentOutlineLocal` 存车型 outline; `toVerifyParams` 带上; `renderMirrorView` 用 `m.outline` 替代圆角矩形 (缺省退回)

**验证结果**:
- 真实轮廓 pip 5/5 命中 = 圆角矩形 5/5 (命中点坐标不变, 最外 lx=-92.63 离边界 ±112 余量 20mm)
- **车型A 五线法 PASS 不变** ✅ — 判据已定稿 (§5) 换轮廓后结论不变, 判定稳健
- JS 170 断言全绿, 无回归
- 后端链路通: `/api/config` 返回 outlineLocal 162 点, `/api/verify` 返回 mirror.outline 85 点 (修约去重)

**CLI**:
```bash
cd python
# 拓扑识别反射区面 + 采样 + 镜像, 输出 outline JSON
python step_topology.py car.stp 80
# 输出: car.mirror-outline.json (outline_local_mm + outline_global_mm)
```

**待解决 (前端显示)**:
- 后端返回 mirror.outline 已确认 (curl 验证 85 点), 但浏览器镜面图仍显示圆角矩形 (R10)
- 可能原因: 浏览器缓存旧 app.js (版本号已改 20260811a, 需 Ctrl+F5); 或前端 renderMirrorView 未取到 m.outline (待 F12 Network 确认 verify 响应)
- ai-widget.js 404 是预期 (本地无此文件, 平台才有), 不影响功能

---

## 22. 今日变更 (2026-08-11 晚会话) — 后挡风 STEP 提取 + 飞线/方向修复

### 后挡风 STEP 轮廓提取 (完成)

从 STEP 文件提取后挡风玻璃轮廓, 覆盖之前的 4 点简化版。

**提取流程**:
1. `step_rear_window.py` 解析 STEP, 找"玻璃"面 (面名不含后挡风关键词, 用 `--list` + `--face-id` 手动选)
2. 后挡风分左右两个面 (#21268 右半 Y:0~734, #25093 左半 Y:-571~0)
3. 每个面 13 条 B 样条边, 按 EDGE_LOOP 顺序采样
4. 左右合并: `right_outer + left_outer` (中心线边各自跳过)

### 遇到的 8 个问题及解决 (详见 DEVELOPMENT_SPEC §11.6)

| 问题 | 根因 | 解决 |
|---|---|---|
| 面名不匹配 | 面名是"玻璃"不是"后挡风" | `--list` 手动选 |
| **飞线** | **B 样条比 EDGE_CURVE 顶点范围长** | **按 VERTEX_POINT 裁剪** |
| 散点 | 退化边 (<5mm) 采 30 点 | 跳过 |
| 中心线误判 | Y跨<5 误杀 Y=540 处短边 | 加 \|Y均值\|<10 |
| 左右不对称 | STEP 数据本身不对称 | 按实际写入, 待确认 |
| **上下颠倒** | **近水平面法线投影失效** | **Y-Z 直投, 不依赖法线** |
| JSON NaN | Python 写 NaN, JS 不认 | 用 null |
| 点序不连续 | EDGE_LOOP 拓扑序 ≠ 空间序 | 裁剪后即正确 |

### 关键代码改动

| 文件 | 改动 |
|---|---|
| `python/step_rear_window.py` | 新建: 后挡风 STEP 提取脚本 |
| `engine/inner/rear-window.js` | `buildProjection`: Y-Z 直投 (不再依赖法线算 upVec) |
| `engine/inner/auto-verify.js` | 传 `outlineLocal` 到 Mirror 构造 (修复真实轮廓不生效) |
| `routes.js` | `_loadRwOutlineFull`: 读 `rear_window.outline_path` → `rwOutlineFull` |
| `public/app.js` | `currentRwOutline`: 加载时存, 校核时发送完整轮廓 |
| `data/vehicles/车型A.rear-window.json` | 578 点 3D 轮廓 (STEP 提取, B 样条裁剪) |
| `data/vehicles/车型A.json` | 加 `rear_window.outline_path` + `mirror.outline_path` |

### 结果

- 车型A 内镜五线法 PASS 不变 (5/5)
- 170 断言全绿
- 后挡风视图: 578 点真实轮廓, 无飞线, 上下方向正确
- 镜面视图: 160 点真实轮廓 (STEP 拓扑提取, 之前已做)

### 后续待验证
1. 左右不对称 (右735mm vs 左571mm) — 需实物确认
2. 外镜 STEP 提取 — 凸球面, 面名/几何判定不同
3. `step_rear_window.py` 合并裁剪逻辑到 `sample_edge_curve`
4. STEP 上传 API + 前端上传 UI

---

## 23. v2.1~v2.4 变更摘要 (2026-08-17 ~ 2026-08-18)

> 本节为 v2.1.0~v2.4.0 的浓缩摘要，完整条目见 `CHANGELOG.md`。

### 判据与界面
- **判据卡内外镜统一** (v2.1.0): 双栏结构 + 三边 AB/BT/TA 采样明细 + 球面拟合区块 + 距边标注
- **后挡风判据改外框** (v2.3.0): 「命中透光区」→「命中后挡风外框即合格」; 供应商拆多个 patch 的同名面合并提取（凸包 + 均匀重采样）
- **镜片轮廓度** (v2.4.0): 加工误差对称 ±mm，距边 < 轮廓度判「可能超出加工边界」，视图画加工边界带
- **单位统一 mm** (v2.4.0): 内外镜参数卡与摘要统一 mm（方向向量无量纲除外）
- **地面术语统一** (v2.4.0): 三处统一「参考地平线前端/后端中点」

### 提取与校核
- **多文件上传合并** (v2.4.0): 同一车型多个 STEP 自动合并提取（内外镜都支持），`parse_and_merge` 移公共层 `step_curve_sampler.py`
- **SR 交叉验证** (v2.4.0): 提取时几何实测半径 vs 标称值（一般 1260±60），偏差超公差汇报、人工判断（不阻断）
- **镜体坐标系** (v2.4.0): 外镜坐标系命名「左/右镜体坐标系」（原点=旋转中心 p1，Z=折叠轴，X=镜面右向，Y=旋转轴由 Z×X 派生），替代旧「旋转轴左/右」
- **外镜轮廓去退化环** (v2.4.0): 提取补 `strip_doubled_paths`，清 CAD 退化环毛刺/飞线
- **搜角 grid 补全** (v2.4.0): 种子区命中不再提前返回，补全热图 grid + 完整 PASS 区域（种子优先保留）

### 标注要求定稿 (v2.4.0)
- 外镜: 镜片 CAS 面 / 镜体坐标系 / 眼点 / 参考地平线 / 车门 / SR 参数（1260±60）
- 内镜: 球铰（旋转中心）/ 镜心（yaw=pitch=0 几何中心）/ 眼点 / 参考地平线 / 镜片反射 CAS 面 / 后挡风外框 CAS 面

### 视图修复 (v2.4.0)
- Plotly `layout.height` 显式化（不再依赖容器 CSS 高度）——修复车型A 后挡风图例不显示（根因：渲染高度不确定导致图例 paper 坐标漂移）
- 外镜投影固定 520px；图例 y 固定像素偏移换算，不随 plot 高度放大越界

### 服务修复
- `spawnStepExtract` failure 回调 `res.status(string)` 崩服务（上传空文件触发）→ 统一 `res.status(400)`
