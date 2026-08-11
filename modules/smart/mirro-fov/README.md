# 内外后视镜视野校核系统

## 基本信息

- 模块ID：mirro-fov（用于URL路径 /mirro-fov/）
- 所属分组：smart（智能硬件组）
- 一句话描述：GB 15084-2022 内外后视镜法规视野校核工具，支持 I 类内镜（平面镜五线法）和 III 类外镜（凸球面双眼交集）

## 功能说明

### 内后视镜（I 类平面镜）

- 五线法主判据（5/5 → PASS）
- 镜中法规线倒影可视化
- 后挡风穿透参考判据
- 两阶段自动搜角（yaw/pitch）
- 车型CRUD + 3DE 参数读取

### 外后视镜（III 类凸球面镜）

- 球面轮廓拟合（共面/非共面双路径自动检测）
- 供应商球心交叉校核 + 一致性闸门
- 精确球面反射解算（全球面扫描+二分）
- 双眼交集判据（GB 15084）
- 地面三角视野区校核（near + far）
- ±3° 旋转轴调节搜索
- 2D 反射面投影可视化

---

## 管理员操作

### server.js 挂载

```javascript
const mirroFovRoutes = require('./modules/smart/mirro-fov/routes');
app.use('/mirro-fov', moduleAuth('mirro-fov'), mirroFovRoutes);
```

### 需要安装的 npm 包

- express（平台已有）
- js-yaml（3DE 读取用，平台已有则无需安装）

### AI 助手接入

请在 ai-assistant/routes.js 的 SYSTEM_PROMPT 中添加：

【平台模块路径】加一行：
- /mirro-fov/ — 内外后视镜视野校核（GB 15084 I/III 类，五线法 + 球面双眼交集）

### 数据目录

模块自带 data/ 目录，无需额外创建。

---

## 接口文档

### 内镜 API

| 接口 | 方法 | 说明 |
|------|------|------|
| /api/vehicles | GET | 车型列表 |
| /api/config?path= | GET | 车型配置 |
| /api/verify | POST | 单角度校核 |
| /api/optimize | POST | pitch 二分优化 |
| /api/auto-search | POST | 两阶段自动搜角 |
| /api/vehicles/save | POST | 保存车型 |
| /api/vehicles/delete | POST | 删除车型 |
| /api/catia | POST | 3DE 读取（需本机 Python + CATIA） |
| /api/catia/available | GET | 3DE 可用性检测 |

### 外镜 API

| 接口 | 方法 | 说明 |
|------|------|------|
| /api/exterior/vehicles | GET | 车型列表 |
| /api/exterior/config?path= | GET | 车型配置 |
| /api/exterior/verify | POST | 双镜合并校核（含 2D 投影 viz） |

---

## 目录结构

```
mirro-fov/
  routes.js               ← 后端路由
  README.md               ← 本文件
  HANDOFF.md              ← 开发文档（算法/判据/历史）
  package.json
  _test_server.js          ← 本地测试服务器
  engine/                  ← 纯 JS 计算引擎（零外部依赖）
    shared/                 几何/平面/多边形（公用）
    inner/                  内镜（平面镜 + 五线法）
    exterior/               外镜（凸球面 + 球心拟合 + 三角视野）
  public/                  ← 前端
    index.html              landing + 内镜页 + 外镜页
    style.css               L0 设计系统模板
    app.js                  交互逻辑
  data/                    ← 车型数据
    vehicles/               内镜车型 JSON
    exterior/               外镜车型 JSON
  docs/                    ← 规范文档
    DEVELOPMENT_SPEC.md     开发维护规范
```

---

## 本地测试

```bash
cd modules/smart/mirro-fov
npm install
npm test             # 155 断言全绿
npm start            # → http://localhost:3000
```

---

## 组落地页 MODULES 数组

```javascript
{ id:'mirro-fov', href:'/mirro-fov/', icon:'🪞', tag:'法规校核', title:'内外后视镜视野校核', desc:'GB 15084 I/III 类 · 五线法+球面双眼交集 · 3DE 接入', arrow:'进入' }
```
