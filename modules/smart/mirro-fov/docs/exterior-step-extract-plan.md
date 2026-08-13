# 外镜 STEP 全自动提取 — 开发计划

> 角色:本计划由 plan/accept 角色(fable)制定,由 sonnet 执行。每阶段产出对照数据,由 plan 角色据此验收。
> 制定日期:2026-08-13。参考 STEP:`data/tmp/waijingjiaohe.stp`(15MB,外镜校核完整模型)。

## 背景与可行性结论(已实测,勿重复探测)

对 `waijingjiaohe.stp` 的探测事实:

- STEP:187892 实体,163345 点。球面 2 个(#42 右 R=1260 center=[-79.5,1680.4,951.9],#43 左 R=1260 center=[-189.7,-1502.2,899.4])。
- 现有 `python/step_exterior_extract.py` 已能提取:左右镜轮廓(571 点,球面偏差 0.026/0.294mm)、球心、眼点(硬编码坐标命中)、地面(硬编码坐标命中)。
- **轴线(关键卡点)**:手动 3 点 `turret_axis_p1/axis_y_point/axis_z_point` 在 STEP 中**不存在**(最近点距离 42–56mm);球心 200mm 内无其他点;0 个小半径圆柱(<80mm);球面 #43 放置轴方向=(0,0,1)≠旋转轴 [-0.386,0.923,0.005]。**结论:轴线无法从 STEP 自动提取,必须人工补录。**
- 车门最外 Y:draft 值 ±1005.2mm,STEP 中 |Y| 99 百分位≈1001.8mm,可几何逼近。
- 眼点/地面:当前 `find_point_by_coord` 硬编码本车坐标([1471,-427.5,1020] 等),换车型失效。

| 参数 | 全自动? | 说明 |
|---|---|---|
| 镜面轮廓 + 球心 + R | ✅ 已可 | SPHERICAL_SURFACE 几何查找,与名称无关,通用 |
| 眼点 / 地面 | ⚠️ 本车型可 | 硬编码命中,需轻量泛化 |
| 车门最外 Y | ⚠️ 可逼近 | 高百分位法,误差待校验 |
| 轴线 | ❌ 不可 | STEP 无此几何,走人工补录(阶段 3) |

## 约束(执行 agent 必守)

1. **禁止改引擎**:`engine/exterior/*`(155 断言全绿)、`engine/inner/*`、`engine/shared/*` 不动。
2. **提取脚本只改** `python/step_exterior_extract.py`;复用已有公共层 `step_topology.py`/`step_curve_sampler.py`,不另起。
3. **后端只改** `routes.js`(新增 `/api/exterior/extract`、`/api/exterior/save` 等);前端只改 `public/app.js` + `public/index.html`。
4. **不要尝试从 STEP 推导轴线**——已证无此几何,浪费时间。
5. 每阶段产出与 `data/exterior/exterior-vehicle-draft.json` 的数值对照,供验收。
6. 提交前跑 `npm test`(三套断言)必须全绿;`node -c routes.js && node -c public/app.js` 语法检查。

## 关键文件

- 参考车型(手动建):`data/exterior/exterior-vehicle-draft.json`(4412 行,含左右镜 outline_raw 421 点、轴线、supplier_sphere_center、车门 Y、眼点、地面、regulation)
- 提取脚本:`python/step_exterior_extract.py`(已实现轮廓/球心/眼点/地面,缺车门 Y/轴线)
- 球面提取:`python/step_sphere_mirror.py`(可参考其 find_spheres)
- 引擎入口:`engine/exterior/api-verify.js` → `verifyExteriorBoth(path, {psi})`
- 路由:`routes.js`(`/api/exterior/config`、`/api/exterior/verify`、`/api/catia/exterior`)
- 前端:`public/app.js`(`initExterior`、`doExtVerify`、`loadExtConfig`、`doExtCatia`)

## 阶段 0 — 对照验证(只读)

**目的**:证明 STEP 自动提取与手动 draft 几何一致。

执行:
```bash
cd modules/smart/mirro-fov
python python/step_exterior_extract.py data/tmp/waijingjiaohe.stp \
  --json data/exterior/exterior-vehicle-draft.json \
  --output data/tmp/stage0-compare.json
```

对照项(写进 `data/tmp/stage0-report.md`):
- 球心:stage0 输出 vs draft `supplier_sphere_center`,逐轴差 mm。
- 轮廓:571 点 vs draft 421 点。把两者重采样到等点数(或最近点距离),报告 max/mean 最近点距离(应 max<1mm)。
- 眼点/地面:应 0 偏差(硬编码命中)。

**验收**:轮廓 max 偏差 <1mm,球心 <0.1mm,眼点/地面 0 偏差。

## 阶段 1 — 提取器补齐(车门 Y + 泛化 + 输出对齐)

**目的**:无 `--json` 也能输出直接可喂 `verifyExteriorBoth` 的完整 JSON(轴线字段留 null)。

改 `python/step_exterior_extract.py`:

1. **车门 Y 几何逼近**:`find_door_outer_Y(points, side)` — 限定 Z∈[600,1100]mm(车门高度),取该区间内 |Y| 的 99.5 百分位,返回左右两个标量。对照 draft ±1005.2,误差应 <5mm。把值写进 `door_panel.door_outer_Y_left/right`。
2. **眼点泛化**:`find_eyes(points)` — 找一对同 X(±20mm)、同 Z(±20mm)、|ΔY|∈[55,75]mm 的点对作为左右眼;失败则回退现有硬编码。用 draft 校验命中。
3. **地面泛化**:`find_ground(points)` — 在 |Y|<30mm 的点中取 Z 最低的前后两点(min X / max X);失败回退硬编码。
4. **输出对齐**:输出 JSON 顶层结构 = draft 的 `vehicle/driver/ground/door_panel/exterior_mirror_left/right/regulation`。每镜含 `sr_nominal/sr_tolerance/sr_fit/radius/outline_raw/supplier_sphere_center/turret_axis_p1(null)/axis_y_point(null)/axis_z_point(null)/rotation_axis_dir(null)`。`regulation` 用 draft 的 III 类值。
5. **SR**:`sr_fit` 用球面半径(已正确);`sr_nominal=1.23, sr_tolerance=0.03` 沿用 draft 元数据(无 `--json` 时取默认)。

执行(无 --json):
```bash
python python/step_exterior_extract.py data/tmp/waijingjiaohe.stp --output data/exterior/waijing-auto.json
# 然后校核
node -e "const {verifyExteriorBoth}=require('./engine/exterior/api-verify'); console.log(JSON.stringify(verifyExteriorBoth('data/exterior/waijing-auto.json',{psi:0}),null,1))" > data/tmp/stage1-verify.json
```

**验收**:`waijing-auto.json` → verify → 左 mirrorPass=true / 右 mirrorPass=false,与 draft 结论一致;车门 Y 误差 <5mm;眼点/地面命中 draft 值。

## 阶段 2 — 接入 Web(一键上传 STEP → 校核)

**目的**:前端外镜页上传一个 STEP 即出车型并校核,无需 3DE。

后端 `routes.js`:
- 新增 `POST /api/exterior/extract`:接 `express.raw` 二进制 STEP(复用 `/api/step/upload` 模式:filename sanitize、spawn `python step_exterior_extract.py`、进度轮询、落盘 `data/exterior/<safe>.json`)。返回 `{ok, path, vehicles: scanExteriorVehicles()}`。**路径越界闸门**:输出必须落在 `EXTERIOR_DIR` 内(对齐已修的外镜闸门)。
- 新增 `GET /api/exterior/extract/progress?name=`:进度轮询,同 `/api/step/progress`。

前端 `public/app.js` + `index.html`:
- 外镜页顶栏加"上传整车 STEP"按钮(`ext-upload-btn`),与"从 3DE 读取"并列。
- `doExtUpload()`:选文件 → POST `/api/exterior/extract`(raw body, X-Filename 头)→ 成功后 `await loadExtVehicles(); await loadExtConfig(result.path); await doExtVerify();`。
- 上传中显示进度(轮询 `/api/exterior/extract/progress`)。

执行:
```bash
node _test_server.js &  # 手动上传 waijingjiaohe.stp 验证
```

**验收**:浏览器上传 `waijingjiaohe.stp` → 自动出车型 → 双镜校核渲染,左 PASS/右 FAIL 与 draft 一致;无 3DE 环境可用;进度显示正常。

## 阶段 3 — 轴线最小人工补录 + 外镜 CRUD

**目的**:解决轴线不在 STEP 的硬约束;顺带补齐外镜保存/删除(之前 P1 待办)。

前端:
- 外镜页加"轴线补录"卡:每镜一个旋转轴方向 `[x,y,z]`(3 个 number 输入),或 3 点(p1/y/z)让后端算 `normalize(y-p1)`。默认从当前车型 config 预填。
- 轴线为 null 时:`doExtVerify` 前端提示"未补轴线,±3° 搜索以零位进行";补录后存盘再校核。
- 补齐 `ext-save-btn/ext-save-as-btn/ext-delete-btn`(当前是 alert 占位):保存/另存为/删除外镜车型。

后端 `routes.js` + `api-verify.js`:
- 新增 `POST /api/exterior/save`:接收完整外镜 JSON(含轴线),落盘 `data/exterior/<name>.json`,路径越界闸门。
- 新增 `POST /api/exterior/delete`:删除,默认车型保护 + 越界闸门(对齐内镜 `/api/vehicles/delete`)。
- `/api/exterior/config` 返回值已含轴线字段(确认 `sum()` 含 turret_axis_p1/rotation_axis_dir),前端能读回预填。

**验收**:轴线补录后存盘 → 重新校核,左 PASS 窗口 [-0.5°,0°] 复现;外镜保存/另存为/删除闭环;删除默认 draft 被拦截。

## 阶段 4(可选)— 鲁棒性硬化

- 眼点/地面/车门泛化失败时,返回 `null` + 前端提示手填(不静默出错)。
- STEP 无球面 / 多球面(>2)时友好报错。
- 上传非外镜 STEP(如内镜整车)时提示"未找到球面镜"。

**验收**:无球面 STEP → 友好报错;眼点未命中 → 提示而非崩溃。

## 执行顺序

**0 → 1 → 2** 先跑通主链路(轴线暂从 draft 沿用 / 留 null),**3** 随后,**4** 视情况。
每阶段完成后把对照数据(`stage0-report.md` / `stage1-verify.json` 等)留着,供验收。

---

# 阶段 5 — 工作流重构 + 外镜新建向导

> 用户决策(2026-08-13): 完整多步向导 / 预览=2D轮廓+球面偏差+球心 / 轴线手填与3DE并列 / 默认轴允许保存仅警告。
> 目的: 修复工作流混乱——外镜"上传STEP"是新建动作却挂在"校核已有"页顶栏。

## 现状问题

- 外镜"新建车型"(select-exterior-btn + wizardMode='new')只弹 alert"待实现"然后掉进校核页。
- "上传整车STEP"按钮(ext-upload-btn)挂在校核页顶栏,与"校核已有"语义冲突。
- 外镜无轮廓预览(内镜向导有 wiz-mirror-plot 供用户确认提取轮廓)。
- "从3DE读取"(ext-catia-btn)与"上传整车STEP"并列在校核页,STEP 自动后 3DE 对外镜冗余。

## 目标工作流

- **校核已有车型**: landing「进入校核」→ 外镜 → exterior-page(顶栏仅 保存/另存为/删除;隐藏 ext-upload-btn + ext-catia-btn,代码保留)。
- **新建车型**: landing「新建车型」→ 外镜 → **wizard-exterior-page**(新,4 步):
  1. 基本信息(车型名)
  2. 上传整车 STEP → 提取 → **预览左右镜面轮廓 2D + 球面偏差 + 球心**(用户确认提取对不对)
  3. 轴线录入(每镜 [x,y,z] 手填输入 + 「从3DE读取」按钮 **并列**;默认 [0,1,0] 橙色警告,允许默认轴保存)
  4. 保存并校核 → 跳 exterior-page 加载新车型

## 实现细节

### 5.1 后端 routes.js
- **/api/exterior/extract 输出改到 data/tmp**(不再写 exterior 目录): `outPath = path.join(STEP_TMP_DIR, stem+'.json')`,越界闸门改校验 STEP_TMP_DIR。理由:向导中途放弃不留 orphan 车型;旧 doExtUpload 隐藏流程仍能在 tmp 上 verify。返回 `{ok, path, vehicles: scanExteriorVehicles()}`(vehicles 不含 tmp 文件,正常)。
- 其余后端不变(/api/exterior/save、/delete、/verify、/config 已就绪)。

### 5.2 前端 index.html
- 新增 `wizard-exterior-page`(结构对齐 wizard-inner-page):
  - 顶栏: ← 返回 + 标题"新建外后视镜车型"
  - Step 0: 车型名 input
  - Step 1: 文件选择 + 「上传并提取」按钮 + 结果文本 + 预览区(`wiz-ext-plot-left`/`wiz-ext-plot-right` 两个 Plotly div + 球面偏差/球心标注 span)
  - Step 2: 左右轴线方向 [x,y,z] 输入(默认 [0,1,0]) + hint + 「从3DE读取」按钮(左右共用或各一)
  - Step 3: 确认信息摘要 + 「保存并校核」按钮
  - 上一步/下一步按钮同 wizard-inner
- exterior-page 顶栏: ext-upload-btn + ext-catia-btn 加 `style="display:none"`(隐藏不删)。

### 5.3 前端 app.js
- `select-exterior-btn` click: wizardMode==='new' → showPage('wizard-exterior'); else → showPage('exterior')。去掉 alert。
- 新增 `initWizardExterior()`(首次进入调用,绑定按钮/步骤):
  - 步骤导航: wizardExtNext/Prev(同 wizardInner 模式)
  - Step 1 上传: `doWizExtUpload()` — 选文件 → POST /api/exterior/extract(raw body, X-Filename) → 成功后:
    - 存 `wizExtPath = result.path`(tmp 路径)
    - GET /api/exterior/config?path=wizExtPath 拿 raw + mirrors
    - GET /api/exterior/verify?path=wizExtPath 拿 viz(outlineUV + fit 球面偏差/球心) — **预览复用 verify 结果**
    - `renderWizExtPreview()`: 左右两个 Plotly 2D,画 outlineUV 闭合折线 + 标题注 球面偏差(maxDevMm)/球心/点数。风格对齐 wiz-mirror-plot。
    - 进度轮询 /api/exterior/extract/progress(同 doExtUpload)
  - Step 2 轴线:
    - 输入预填 [0,1,0],hint 橙色"使用默认轴,建议补录真轴";手填改值后变灰"已补录真轴"
    - 「从3DE读取」按钮: POST /api/catia/exterior → 成功后读 result.output 的 config,取 exterior_mirror_left/right.rotation_axis_dir 填入输入框(仅取轴线,不替换其他)。注意 3DE 是交互式(终端选点),按钮期间禁用+提示。
  - Step 3 保存: `doWizExtSave()`:
    - 取 step 1 的 raw config(深拷贝),patch 轴线(左右 rotation_axis_dir = 输入值),设 vehicle.name = step 0 车型名
    - POST /api/exterior/save {name, config} → 落盘 data/exterior/<name>.json
    - 成功: 若 exterior-page 未初始化则 initExterior;loadExtVehicles;loadExtConfig(result.path);doExtVerify;showPage('exterior')
- 复用现有 `renderExtMirrorView` 的轮廓绘制逻辑抽取预览版(只画 outline + 标注,不画投影/安全线),或新写轻量 `renderWizExtPreview`。

### 5.4 pages 对象 + showPage
- pages 加 `'wizard-exterior': $('wizard-exterior-page')`。
- showPage 加 wizard-exterior 首次初始化分支(同 wizard-inner)。

## 约束(同前)
1. 禁止改 engine/**。
2. 后端只改 routes.js(extract 输出路径一行 + 闸门);前端只改 app.js + index.html。
3. 隐藏不删:ext-upload-btn/ext-catia-btn 加 display:none,doExtUpload/doExtCatia 函数保留。
4. 完成后 node -c + npm test 全绿。

## 验收门槛
- landing「新建车型」→ 外镜 → 进 wizard-exterior(不再 alert/掉进校核页)。
- 上传 waijingjiaohe.stp → 预览显示左右轮廓 2D + 球面偏差 + 球心,用户可目视确认形状。
- 轴线步:手填真轴 → hint 变灰;点 3DE 按钮(无 CATIA 环境会失败提示,不崩);默认轴保存仅警告不阻止。
- 保存并校核 → 跳校核页,新车型已加载,左 PASS/右 FAIL。
- 校核页顶栏不再有"上传整车STEP"/"从3DE读取"按钮(隐藏)。
- 中途放弃向导:data/exterior 无 orphan(tmp 在 data/tmp,gitignored)。
- npm test 全绿。

## 产出对照文件
- `data/tmp/stage5-report.md`:向导各步操作结果 + 预览截图描述 + 保存后校核结论 + 校核页按钮隐藏确认 + npm test。
