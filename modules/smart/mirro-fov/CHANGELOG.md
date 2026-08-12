# 更新日志

## 2026-08-12 — 提取公共层 + 前端重构

### 新增
- **STEP 提取公共层**（内镜/外镜/后挡风三路径统一）：
  - 顶点锚定采样 `sample_edge_vertex_chained`（修复 B-spline 采样不落共享顶点的飞线，含 ORIENTED_EDGE 遍历方向）
  - 自检闸门 `step_verify.assert_outline_ok`（连续闭合/无飞线/跨度合理，不过则失败不输出坏数据）
  - 重复描边清理 `strip_doubled_paths`（CAD 退化环出去又折回）
  - 半模镜像 `mirror_half_outline`（后挡风/镜面半边建模 → 完整轮廓）
  - 后挡风面名几何降级（关键词匹配失败时按锚定跨度找面）
  - 回归测试 `python/test_step_extraction.py`（6 项全绿）
- 前端工作流配色语义：蓝=动作（按钮全站统一）、绿=状态（仅 chip）
- 前端三层页面居中布局（landing / 镜子类型 / 向导），黄金比例卡 360×222

### 修复
- STEP 上传链路：base64 同步编码冻结 → 原始二进制直传（`express.raw`）；浏览器覆盖 Content-Type 导致"缺少文件内容"；选完文件自动解析
- 车型数据不同步到前端（`pages.inner` 未定义导致 initInner 不执行）
- 默认车型与下拉不一致（服务端默认值 ≠ 列表首项）
- 后挡风输出键名/单位链（`outline_mm` mm 约定，消除二次转换错误）
- 服务端失败时携带 Python stderr 详情
- `.gitignore` data/tmp 模式锚定根目录从未生效 → `**/data/tmp/`
- 内镜轮廓镜像飞线 + 丢点（51mm/50.8mm 断点）

### 文档
- README 补环境要求（Node/Python/numpy/敏感数据不入库说明）

## 2026-08 — 工作流改造 + 外镜补齐

### 新增
- 动作优先 landing（校核已有 / 新建车型）+ 镜子类型选择页
- 内镜新建向导（5 步：基本信息 → STEP 轮廓 → 后挡风轮廓 → 点坐标 → 参数保存）
- `/api/step/upload` STEP 上传提取接口；有 STEP 轮廓时参数卡只读
- 外镜一条龙提取 + 验证脚本（球心/眼点/地面与人工数据 0.000mm 吻合）
- 外镜安全距离可视化（3mm 安全线 + 判定面板简化 + 最小 margin）
- 外镜 ψ 角度调节卡（绕转向器轴线 ±3°），移除缩放功能
- 外镜球面镜 STEP 提取（SPHERICAL_SURFACE R≈1260，顶点链式缝合保证精度）

### 修复
- STEP 解析支持多行实体（供应商文件 5516 个跨行 B-spline 被漏掉，实体 18.2万→18.8万）
