# 内后视镜 STEP 数据规范 (供应商准则)

> 目的:供应商按本规范在**一个 STEP 文件**里备好数据,系统上传后**全自动提取**内后视镜(GB 15084 I 类,平面镜)校核所需的全部参数,无需人工选点或 3DE 交互。
> 制定日期:2026-08-13。基于 modena 整车 STEP(`MODENA-GB15084a.1In Work.stp`,148MB)探针验证。
> 平行于外镜规范 `docs/exterior-step-supplier-spec.md`。

## 一、总览

一个 STEP,全自动提取内后视镜校核所需参数:

| # | 参数 | STEP 里的存在形式 | 识别方式 | modena 现状 |
|---|---|---|---|---|
| 1 | 镜面轮廓(width/height/corner) | `内后视镜镜座` 总成内平面面 | 命名总成+最大平面 | ✅ `内后视镜镜座`已命名 |
| 2 | 球铰 pivot | `CARTESIAN_POINT` | 命名点 | ⏳ 需补 `MIRROR_PIVOT` |
| 3 | 镜面零位中心 center_zero | `CARTESIAN_POINT` | 命名点 | ⏳ 需补 `MIRROR_CENTER_ZERO` |
| 4 | yaw / pitch(安装角) | 镜面法向 + pivot/center_zero 几何 | 几何推导 | 🟡 需验证 |
| 5 | 眼点 + IPD | `CARTESIAN_POINT` | 命名点 | ✅ `眼椭圆`/`左右眼椭圆中心点`已命名 |
| 6 | 地面(前后) | `CARTESIAN_POINT` | 命名点 | ⏳ 需补 `GROUND_FRONT`/`GROUND_REAR`(`curb0 ground line`曲线已在,可兜底) |
| 7 | 后挡风轮廓 + 透光区 | `ADVANCED_FACE` | 命名面 | ⏳ 需补 `REAR_WINDOW`/`REAR_WINDOW_TZ` |

> 法规参数(远距 60m / 远距宽 20m)用 GB 15084 I 类固定默认,不需进 STEP。

## 二、已验证的提取能力(modena 探针)

| 项 | 方法 | 验证结果 |
|---|---|---|
| 眼点 | 命名点 `眼椭圆` + `左/右侧眼椭圆中心点` | `眼椭圆`=[3243.1,-385,1372] 与 modena eye_center 0mm;左右中心点 Y=-417.5/-352.5 → IPD=65mm,与 modena 0.065m 一致 |
| 镜片总成 | 命名面 `内后视镜镜座` | 151 个面(34 平面/67 圆柱/22 环面),总成 bbox X[-29,2895] Z[1386,1501],含 center_zero[2909,0,1442] |
| 地面曲线 | 命名曲线 `curb0 ground line` | 存在(COMPOSITE_CURVE),可取端点作前后点(精度待验证) |

> 关键:供应商 CATIA 模型**已有命名习惯**(镜座/眼椭圆/头部包络/ground line 都命了名),内镜片并非淹没在匿名面里。补齐 pivot/center_zero/后挡风命名即可全自动。

## 三、详细要求

### 1. 镜面轮廓(参数 1)— 命名总成 + 平面识别

- 总成面已命名 `内后视镜镜座`(modena 已有 ✅)。
- **建议额外命名镜片面** `INNER_MIRROR_GLASS`:镜座总成内有 34 个平面,系统需从中认出镜片(取最大平面)。若供应商直接命名镜片面,识别更稳。
- 系统提取:圈出 `内后视镜镜座`(或 `INNER_MIRROR_GLASS`)总成 → 找最大平面面 → 追踪边界得镜面轮廓(2D u-v)→ 由轮廓跨度导出 width/height/corner_radius(对齐现有 step_topology 提取逻辑)。
- **供应商需保证**:镜片面是平面,且在镜座总成内是最大平面。

### 2. 球铰 pivot(参数 2)— 命名点,必须补

- `MIRROR_PIVOT`:镜片球铰中心点(整车坐标)。
- modena 现状:无命名点,无球面(镜座 67 圆柱全是 R0.2-2.5 销钉),无 AXIS1_PLACEMENT(8 个都在车尾)。**必须由供应商新增命名点。**
- 参考 modena 实测:pivot = [2883.07, 0, 1441.017]。

### 3. 镜面零位中心 center_zero(参数 3)— 命名点,必须补

- `MIRROR_CENTER_ZERO`:镜面在 yaw=pitch=0 时的中心点(整车坐标)。
- modena 现状:无命名点,镜心附近 624 个平面无法直接取质心。**必须由供应商新增命名点。**
- 参考 modena 实测:center_zero = [2909.215, 0.000007, 1441.88]。
- 备选:若 STEP 中镜片处于零位,可由镜片面质心近似(需验证);但命名点最稳。

### 4. yaw / pitch(参数 4)— 几何推导,需验证

- 由镜片面法向(从 `INNER_MIRROR_GLASS` 平面方向)与 pivot→center_zero 参考方向推导安装角。
- modena 实测:yaw=-23.5°, pitch=5.0°。
- ⚠️ 此项推导规则需对照 modena 验证后定稿;若推导不稳,退化为供应商在 STEP 里用命名 DIRECTION/AXIS2_PLACEMENT_3D 显式给出零位参考方向。

### 5. 眼点 + IPD(参数 5)— 命名点,已有

- `眼椭圆`(眼中心)、`左侧眼椭圆中心点`、`右侧眼椭圆中心点`(modena 已命名 ✅)。
- 系统提取:eye_center = `眼椭圆` 坐标;IPD = 左右眼中心点 Y 差。
- 验证:精确命中 modena。

### 6. 地面(参数 6)— 命名点优先,曲线兜底

- 优先:`GROUND_FRONT` / `GROUND_REAR` 命名点(整车坐标)。
- 兜底:modena 已有 `curb0 ground line` 命名曲线,取其端点作前后点(精度待验证)。
- 参考 modena 实测:front_mid=[500,0,193.209], rear_mid=[5900,0,193.209]。

### 7. 后挡风轮廓 + 透光区(参数 7)— 命名面,必须补

- `REAR_WINDOW`:后挡风 CAS 外框面(命名)。系统追踪边界得 7 点轮廓。
- `REAR_WINDOW_TZ`:后挡风透光区面/曲线(命名)。系统得 4 点透光区。
- modena 现状:无"后挡风/窗/glass"命名,车尾高位 542 个平面无法区分。**必须由供应商新增命名。**

## 四、坐标系与单位

- **坐标系**:整车坐标系,X+=后方,Y+=乘客右,Z+=上,LHD(与外镜同总布置定义)。
- **单位**:STEP 用 mm,系统内部转 m。
- 与外镜规范一致。

## 五、供应商自检清单

导出 STEP 前确认:

- [ ] 含命名总成 `内后视镜镜座`(modena 已有)
- [ ] (建议)镜片面命名 `INNER_MIRROR_GLASS`
- [ ] 含命名点 `MIRROR_PIVOT`(球铰中心)
- [ ] 含命名点 `MIRROR_CENTER_ZERO`(镜面零位中心)
- [ ] 含命名点 `眼椭圆` / `左侧眼椭圆中心点` / `右侧眼椭圆中心点`(modena 已有)
- [ ] 含命名点 `GROUND_FRONT` / `GROUND_REAR`(或 `curb0 ground line` 曲线)
- [ ] 含命名面 `REAR_WINDOW` + `REAR_WINDOW_TZ`(后挡风外框 + 透光区)
- [ ] 坐标系:整车 X+后 Y+右 Z+上,LHD,单位 mm

满足以上,系统上传该 STEP 即可全自动提取全部参数,无需任何人工输入。

## 六、开放项状态

1. **命名点补充** — ⏳ 待供应商确认:能否新增 `MIRROR_PIVOT`/`MIRROR_CENTER_ZERO`/`GROUND_FRONT`/`GROUND_REAR`/`REAR_WINDOW`/`REAR_WINDOW_TZ` 命名。modena 已有命名习惯,预计可行。
2. **yaw/pitch 推导** — 🟡 需对照 modena 验证:镜面法向 + pivot/center_zero → yaw/pitch 的推导规则;若不稳,改用显式命名方向。
3. **center_zero 近似** — 🟡 若镜片在 STEP 中处于零位,质心近似可行;否则必须用命名点。待验证镜片在 STEP 中的姿态。
4. **后挡风透光区口径** — ⏳ 待确认:`REAR_WINDOW_TZ` 是透光区(可开启/可见区)还是 CAS 整框,与 modena transparent_zone 定义对齐。

## 七、与外镜规范的差异

| | 外镜(III 类) | 内镜(I 类) |
|---|---|---|
| 镜面 | 凸球面(SPHERICAL_SURFACE 几何识别) | 平面(命名总成 `内后视镜镜座`+最大平面) |
| 关键结构 | 旋转轴 AXIS2_PLACEMENT_3D | 球铰 pivot(命名点,无结构可借) |
| 调节参数 | ψ 单轴 | yaw/pitch 双角(几何推导) |
| 后挡风 | 不需要 | 需要(REAR_WINDOW 命名面) |
| 车门最外 | 需要(DOOR_OUTER 命名点) | 不需要 |

> 内镜比外镜多一个后挡风,少一个车门;镜面识别从"几何唯一"变为"命名总成"(因平面无唯一性);pivot 与外镜轴线同理,是必须人工/命名补的关键参数。
