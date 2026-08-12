# 🪞 mirro-fov — 内外后视镜视野法规校核系统

> 依据 **GB 15084-2022** 法规，用三维几何模型自动校核内后视镜（I 类平面镜）和外后视镜（III 类凸球面镜）的视野合规性。

## ✨ 功能

### 内后视镜（I 类 · 平面镜）

- **五线法主判据** — 5 条射线全命中反射面 → PASS
- **镜中法规线倒影** — 60m 处 ±10m 地平线在镜面上的投影曲线
- **后挡风穿透** — 参考判据（仅报告不判定）
- **自动搜角** — 两阶段网格搜索 yaw/pitch
- **车型 CRUD** — 保存 / 另存 / 删除
- **3DE 数据读取** — CATIA COM 选点 → 自动填表
- **STEP 轮廓解析** — 从 STEP 文件提取真实反射面边界（162 点）

### 外后视镜（III 类 · 凸球面镜）

- **球面轮廓拟合** — 共面/非共面双路径自动检测 + 供应商球心交叉校核
- **精确球面反射** — 二次方程闭式解 + 全球面扫描求根
- **双眼交集判据** — GB 15084 双眼反射点都在镜面内 + 安全距离 ≥3mm
- **地面三角视野区** — 近场 1m@眼后4m / 远场 4m@眼后20m
- **±3° 旋转调节搜索** — 绕转向器轴线网格扫描
- **2D 反射面投影** — 左/右镜面 UV 投影图 + 缩放诊断
- **3DE 数据读取** — 轮廓批量选点 + 轴线 + SR

## 🏗️ 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 计算引擎 | 纯 JavaScript | 零外部依赖，155 断言全绿 |
| Web 服务 | Express.js | REST API + 静态文件托管 |
| 前端 | Bootstrap 5 + Plotly.js | Apple 冷白设计系统 |
| 3DE 接入 | Python + pywin32 | COM 选点 + STEP 文件解析 |
| 数据 | JSON | 整车坐标系，米制 |

## 📁 目录结构

```
mirro-fov-js/
├── modules/smart/                    ← 智能硬件组 (平台交付物)
│   ├── public/index.html             ← 组落地页
│   └── mirro-fov/                    ← 本模块
│       ├── engine/                   ← 纯 JS 计算引擎
│       │   ├── shared/               共享数学 (几何/平面/多边形)
│       │   ├── inner/                内镜 (平面镜 + 五线法)
│       │   └── exterior/             外镜 (凸球面 + 球心拟合 + 三角视野)
│       ├── public/                   ← 前端
│       │   ├── index.html            landing + 内镜页 + 外镜页
│       │   ├── style.css             设计系统模板 (L0 冻结)
│       │   └── app.js                交互逻辑
│       ├── python/                   ← 3DE 读取 (自包含)
│       │   ├── mirror_fov/           COM 连接 + 参数提取
│       │   ├── step_curve_sampler.py STEP 文件 B 样条采样器
│       │   ├── step_topology.py      STEP 拓扑识别反射面
│       │   └── requirements.txt      pywin32 + numpy + pyyaml
│       ├── data/                     ← 车型数据 (真实数据不入库)
│       │   ├── vehicles/             内镜车型 JSON
│       │   └── exterior/             外镜车型 JSON
│       ├── docs/                     ← 开发规范
│       │   └── DEVELOPMENT_SPEC.md   目录/分层/流程/测试/发布规范
│       ├── routes.js                 ← Express 路由 (API + 静态文件)
│       ├── README.md                 ← 管理员接入说明
│       ├── _test_server.js           ← 本地测试服务器
│       └── package.json
├── .gitignore
└── README.md                         ← 本文件
```

## 🚀 快速开始

### 环境要求

- **Node.js** v16+
- （可选）**Python** 3.11+ + `pip install -r python/requirements.txt` — 3DE 读取功能
- （可选）**3DEXPERIENCE** 已启动登录 — CATIA COM 选点

### 安装

```bash
cd modules/smart/mirro-fov
npm install
```

### 运行

```bash
npm start
# → http://localhost:3000
```

浏览器打开后看到两张卡片：内后视镜 / 外后视镜，点击进入校核页面。

### 测试

```bash
npm test
# 155 断言 (内镜 49 + 外镜 55 + 球面拟合 51)
```

## 📊 校核判据

### 内镜 — 五线法（主判据）

5 条射线从虚像眼出发，经镜面反射后全部命中反射面 → PASS：

| 线 | 起点 | 终点 | 说明 |
|---|---|---|---|
| 1 | 中心虚像眼 | BL（−10m） | 左侧远场 |
| 2 | 中心虚像眼 | BR（+10m） | 右侧远场 |
| 3 | 中心虚像眼 | +X 正后方 | 辅助高度线 |
| 4 | 左虚像眼 | BR（+10m） | 交叉线 |
| 5 | 右虚像眼 | BL（−10m） | 交叉线 |

### 外镜 — 双眼交集 + 地面三角形

- **近场**：1m 宽地面，眼后 4m 起
- **远场**：4m 宽地面，眼后 20m 至地平线
- 三角形三边（AB/BT/TA）采样 20 点，双眼反射点都在镜面内 + margin ≥3mm → 可见
- 近场 + 远场全部可见 → PASS

## 🔧 3DE 数据接入

三种模式，按需使用：

| 模式 | 命令 | 用途 |
|---|---|---|
| 内镜选点 | `python -m mirror_fov.catia_extract` | COM 逐个选点（pivot/眼点/地面/后挡风） |
| 外镜批量 | `python -m mirror_fov.catia_extract --mode exterior` | COM 选轮廓点 + 轴线 + SR 手输 |
| STEP 解析 | `python -m mirror_fov.catia_extract --mode step-curve --step-file <file> --curve-ids <ids>` | 纯 Python 解析 STEP 文件 B 样条 |

> **STEP 方案**：3DE COM 不支持曲线采样（三轮探测确认），改为导出 STEP 文件后用纯 Python + numpy 解析。`step_topology.py` 可自动识别反射面边界，无需手动指定曲线 ID。

## 📐 坐标系

整车坐标系：**X+ = 后方，Y+ = 乘客右，Z+ = 上方**。单位米。所有内部计算在整车坐标系完成，无坐标转换。

## 📝 开发规范

详见 [DEVELOPMENT_SPEC.md](modules/smart/mirro-fov/docs/DEVELOPMENT_SPEC.md) — 目录结构、架构分层（L0–L6）、路由规范、数据格式、开发流程、测试清单、平台发布步骤。
