# 路线回归与逐阶段 profiling

测量日期为 2026-11-10，使用本地工作树、Ganglia alpha.67 和 Node v26.13.0。回归完成后顺序执行正式 profiling。

## 回归结果

| 分类 | 数量 |
|---|---:|
| 持平 | 63 |
| 改善 | 33 |
| 变慢 | 14 |
| 采集事件合同缺口 | 2 |
| 历史基线事件无效 | 1 |

113 项中，34 项通过 SDK、输入绑定校验后复用并重新检查，79 项重新求解。新求解累计 1147.662 秒，全部生成结果，无超时、worker 崩溃或缺失输入。沿用原始 113 项 suite，当前 inventory 的 115 项差异另行保留。61 条输入绑定待核实记录仍列于排除清单。

两项合同缺口为 `035-06IsDPb` 和 `047-0cauQ22`。旧新路线均以步行进入目标体积，均缺少 README 承诺的 `goalHit` 事件证据。`001-0kkQ3em` 的历史采集事件越界 75.874 mm、提前约 9.145 ms，当前事件有效。

最大路线代价增加为 `17nac6U` 的 7.665167 模型秒、`10YLgUg` 的 2.532813 模型秒和 `0bzZEM3` 的 0.990782 模型秒。前两项与当前改善搜索预算减小有关。具体动作和预算差异保存在诊断文件。

[逐项回归 CSV](</Users/canvas/_Code/EF Repos/endfield-noclip/.research/stage123/complex-regression-alpha67/regression-cases.csv>) · [回归总结](</Users/canvas/_Code/EF Repos/endfield-noclip/.research/stage123/complex-regression-alpha67/regression-summary.md>) · [诊断证据](</Users/canvas/_Code/EF Repos/endfield-noclip/.research/stage123/complex-regression-alpha67/diagnosis-20261110.md>)

## 计时范围与口径

- 每个样本同一进程运行 cold、warm 各一次，记录输入 SHA256、加载源码 SHA256、Node／SDK 版本及缓存策略。
- cold 表示应用缓存为空。输入绑定计算会预读文件，OS 页缓存已有预热。地面构建 cold 使用隔离的空输入／tile 缓存，warm 复用这些缓存。物理路线查询使用保留的物理输入和共享 RouteCache。
- 函数 stopwatch 给出调用次数、含子调用耗时和扣除直接子调用忙碌区间后的自身耗时。嵌套 inclusive 行存在包含关系，异步 sibling 的自身等待时间可能重叠。全表时间应按调用树阅读。
- V8 以 1 ms 间隔采样，按试验边界和 progress 区间切分权重。采样墙钟估计包含等待、调度和 GC，process.cpuUsage 单列实际进程 CPU。进度完成事件之后的间隔保留原始语义。
- 每个样本保留完整原始结果和 CPU profile。未执行或未插桩的阶段需要结合调用覆盖判断。

## 样本总耗时

| 样本 | cold 秒 | warm 秒 | cold 模型路线秒 | warm 模型路线秒 |
|---|---:|---:|---:|---:|
| 19Nzh29 复杂动作 | 173.348 | 155.802 | 8.941389 | 8.941389 |
| 19Nzh29 关闭插桩对照 | 154.793 | 152.763 | 8.941389 | 8.941389 |
| 02gcZm4 全局候选 | 103.178 | 1.556 | candidate | candidate |
| 0e9bjd3 绕行比较 | 64.341 | 67.096 | 47.342731 | 47.342731 |
| 0e9bjd3 关闭插桩对照 | 61.459 | 57.692 | 47.342731 | 47.342731 |
| 0e9bjd3 低开销绕行计时 | 65.509 | 60.528 | 47.342731 | 47.342731 |
| 设备入口逐项搜索 | 21.390 | 20.254 | 14.316685 | 14.316685 |
| 粗方向逐项搜索 | 43.431 | 39.612 | 51.802466 | 51.802466 |
| 南北路线未连通窗口 | 23.012 | 20.210 | unavailable | unavailable |
| 初版地面构建 | 16.264 | 3.972 | — | — |
| 地面构建关闭插桩对照 | 16.395 | 3.936 | — | — |
| 地面构建及 I/O 细分 | 18.148 | 3.984 | — | — |
| 02gcZm4 绳索／涡流终段 | 83.456 | 78.900 | 8.068946 | 8.068946 |

表中的耗时为计算时间，模型路线秒为返回路线的移动代价。每次模块加载与设置耗时另见 `runs.csv` 的 setupMs。

## 物理查询各阶段

### 19Nzh29 复杂动作

| 阶段 | cold 秒 | warm 秒 |
|---|---:|---:|
| 输入 | 0.398 | 0.031 |
| 地面图准备与步行查询 | 1.576 | 2.510 |
| 碰撞索引 | 0.348 | 0.000 |
| 固定设备连接 | 0.112 | 0.127 |
| 运动支撑及关联准备 | 1.908 | 2.135 |
| 目标局部细化 | 0.048 | 0.062 |
| 动作搜索 | 168.904 | 150.772 |
| 地面绕行比较 | 0.001 | 0.000 |
| 结果注释 | 0.001 | 0.000 |
| 提取器 total | 173.324 | 155.787 |

### 19Nzh29 关闭插桩对照

| 阶段 | cold 秒 | warm 秒 |
|---|---:|---:|
| 输入 | 0.441 | 0.005 |
| 地面图准备与步行查询 | 1.772 | 1.750 |
| 碰撞索引 | 0.376 | 0.000 |
| 固定设备连接 | 0.127 | 0.124 |
| 运动支撑及关联准备 | 2.029 | 2.467 |
| 目标局部细化 | 0.048 | 0.050 |
| 动作搜索 | 149.959 | 148.261 |
| 地面绕行比较 | 0.001 | 0.001 |
| 结果注释 | 0.001 | 0.000 |
| 提取器 total | 154.784 | 152.750 |

### 0e9bjd3 绕行比较

| 阶段 | cold 秒 | warm 秒 |
|---|---:|---:|
| 输入 | 0.341 | 0.003 |
| 地面图准备与步行查询 | 5.401 | 6.617 |
| 碰撞索引 | 0.595 | 0.000 |
| 固定设备连接 | 0.688 | 0.676 |
| 运动支撑及关联准备 | 2.515 | 3.038 |
| 目标局部细化 | 5.796 | 6.608 |
| 动作搜索 | 22.859 | 23.836 |
| 地面绕行比较 | 26.096 | 26.189 |
| 结果注释 | 0.007 | 0.002 |
| 提取器 total | 64.321 | 67.087 |

### 02gcZm4 绳索／涡流终段

| 阶段 | cold 秒 | warm 秒 |
|---|---:|---:|
| 输入 | 0.599 | 0.002 |
| 地面图准备与步行查询 | 3.430 | 2.969 |
| 碰撞索引 | 0.796 | 0.000 |
| 固定设备连接 | 0.223 | 0.166 |
| 运动支撑及关联准备 | 0.022 | 0.019 |
| 目标局部细化 | 1.655 | 1.365 |
| 动作搜索 | 76.704 | 74.355 |
| 地面绕行比较 | 0.000 | 0.000 |
| 结果注释 | 0.000 | 0.000 |
| 提取器 total | 83.450 | 78.895 |

### 南北路线未连通窗口

| 阶段 | cold 秒 | warm 秒 |
|---|---:|---:|
| 输入 | 0.454 | 0.007 |
| 地面图准备与步行查询 | 3.254 | 3.355 |
| 碰撞索引 | 0.317 | 0.000 |
| 固定设备连接 | 0.135 | 0.116 |
| 运动支撑及关联准备 | 0.053 | 0.044 |
| 随行支撑 | 0.143 | 0.103 |
| 目标局部细化 | 4.110 | 2.814 |
| 动作搜索 | 14.503 | 13.716 |
| 提取器 total | 23.004 | 20.208 |

### 设备入口逐项搜索

| 阶段 | cold 秒 | warm 秒 |
|---|---:|---:|
| 输入 | 1.017 | 0.004 |
| 地面图准备与步行查询 | 1.790 | 1.791 |
| 碰撞索引 | 0.476 | 0.000 |
| 固定设备连接 | 0.182 | 0.153 |
| 运动支撑及关联准备 | 0.016 | 0.014 |
| 目标局部细化 | 2.446 | 2.411 |
| 动作搜索 | 15.074 | 15.551 |
| 地面绕行比较 | 0.309 | 0.301 |
| 结果注释 | 0.000 | 0.000 |
| 提取器 total | 21.384 | 20.252 |

### 粗方向逐项搜索

| 阶段 | cold 秒 | warm 秒 |
|---|---:|---:|
| 输入 | 0.865 | 0.002 |
| 地面图准备与步行查询 | 10.732 | 12.148 |
| 碰撞索引 | 2.640 | 0.000 |
| 固定设备连接 | 1.064 | 1.276 |
| 目标局部细化 | 5.620 | 5.905 |
| 动作搜索 | 20.763 | 18.529 |
| 地面绕行比较 | 1.686 | 1.637 |
| 提取器 total | 43.423 | 39.610 |

### 0e9bjd3 低开销绕行计时

| 阶段 | cold 秒 | warm 秒 |
|---|---:|---:|
| 输入 | 0.427 | 0.002 |
| 地面图准备与步行查询 | 6.015 | 6.560 |
| 碰撞索引 | 1.006 | 0.000 |
| 固定设备连接 | 0.624 | 0.653 |
| 运动支撑及关联准备 | 2.740 | 2.766 |
| 目标局部细化 | 5.778 | 5.994 |
| 动作搜索 | 26.596 | 21.980 |
| 地面绕行比较 | 22.295 | 22.508 |
| 结果注释 | 0.002 | 0.001 |
| 提取器 total | 65.504 | 60.507 |

### 0e9bjd3 关闭插桩对照

| 阶段 | cold 秒 | warm 秒 |
|---|---:|---:|
| 输入 | 0.362 | 0.004 |
| 地面图准备与步行查询 | 5.348 | 5.645 |
| 碰撞索引 | 0.610 | 0.000 |
| 固定设备连接 | 0.701 | 0.891 |
| 运动支撑及关联准备 | 2.483 | 2.700 |
| 目标局部细化 | 6.160 | 5.415 |
| 动作搜索 | 23.526 | 21.341 |
| 地面绕行比较 | 22.239 | 21.662 |
| 结果注释 | 0.002 | 0.001 |
| 提取器 total | 61.454 | 57.684 |

`annotationPreparation` 已包含在运动支撑阶段，独立明细保留于原始 JSON。完整调用耗时还包含 total 记账之后的结果序列化与写出。

## 地面构建内部

| 阶段 | cold 调用数 | cold 含子调用秒 | cold 自身秒 | warm 含子调用秒 |
|---|---:|---:|---:|---:|
| recast::buildPolyMeshDetail | 24 | 9.041 | 9.041 | — |
| ganglia/build.mjs::buildGroundTiles | 1 | 12.343 | 1.228 | 0.960 |
| extractor/game/assets/assets.ts::AssetResolver.findUnique | 2058 | 1.953 | 1.173 | — |
| extractor/commands/player-ground.ts::JSON.stringify | 70 | 1.139 | 1.139 | 0.799 |
| extractor/hg/vfs.ts::Vfs.read | 5109 | 0.884 | 0.884 | 0.121 |
| extractor/commands/player-ground.ts::run | 1 | 18.148 | 0.810 | 3.984 |
| recast::rasterizeTriangles | 24 | 0.788 | 0.788 | — |
| extractor/game/collision-ground.ts::collisionGeometry | 1 | 0.448 | 0.448 | 0.432 |
| extractor/commands/player-ground.ts::writeFile | 23 | 0.408 | 0.408 | 0.356 |
| recast::buildPolyMesh | 24 | 0.391 | 0.391 | — |
| extractor/game/collision-inputs.ts::collectCollisionInputs | 21 | 2.650 | 0.285 | — |
| recast::buildRegions | 24 | 0.163 | 0.163 | — |
| extractor/game/world/world-index.ts::WorldIndex.cellChunkFiles | 42 | 0.116 | 0.116 | 0.107 |
| formats/unity/collision-mesh.ts::readCollisionMesh | 1939 | 0.104 | 0.104 | — |
| extractor/hg/bundles.ts::BundleAssetFile.read | 3935 | 0.093 | 0.093 | — |
| ganglia/support-field.mjs::buildSupportField | 24 | 10.778 | 0.092 | — |
| recast::buildCompactHeightfield | 24 | 0.068 | 0.068 | — |
| recast::buildDistanceField | 24 | 0.067 | 0.067 | — |
| recast::buildContours | 24 | 0.066 | 0.066 | — |
| extractor/game/ground-tile-cache.ts::JSON.stringify | 122 | 0.064 | 0.064 | 0.000 |
| extractor/game/ground-tile-cache.ts::groundTileCache.keyFor | 48 | 0.061 | 0.060 | 0.021 |
| extractor/game/collision-inputs.ts::collectCollisionInputs.meshGeometry | 12600 | 2.109 | 0.058 | — |
| ganglia/build.mjs::buildGroundSurfaces | 24 | 10.869 | 0.057 | — |
| extractor/commands/player-ground.ts::JSON.parse | 2 | 0.055 | 0.055 | 0.242 |
| recast::erodeWalkableArea | 24 | 0.055 | 0.055 | — |
| formats/endfield/streaming-chunk-data.ts::parseStreamingChunk | 35 | 0.051 | 0.051 | — |
| formats/endfield/collision-heightfield.ts::readCollisionHeightfield | 80 | 0.047 | 0.047 | — |
| extractor/game/ground-tile-cache.ts::writeFile | 24 | 0.040 | 0.040 | — |
| recast::init | 24 | 0.033 | 0.033 | — |
| extractor/game/collision-ground.ts::walkableCollisionIndices | 1 | 0.032 | 0.032 | 0.040 |
| ganglia/build.mjs::boundaryEdges | 76 | 0.029 | 0.029 | 0.012 |
| formats/endfield/ecs-collider.ts::readEcsCollider | 2841 | 0.028 | 0.028 | — |
| extractor/commands/player-ground.ts::readFile | 23 | 0.023 | 0.023 | 0.063 |
| recast::filterLowHangingWalkableObstacles | 24 | 0.022 | 0.022 | — |
| extractor/game/world/world-index.ts::WorldIndex.readStreamingPayload | 35 | 0.040 | 0.021 | — |
| recast::filterWalkableLowHeightSpans | 24 | 0.021 | 0.021 | — |
| ganglia/build.mjs::joinTiles | 38 | 0.049 | 0.020 | 0.026 |
| extractor/game/ground-tile-cache.ts::groundTileCache.save | 24 | 0.164 | 0.018 | — |
| extractor/hg/bundles.ts::vfsSource.read | 5070 | 0.722 | 0.010 | — |
| formats/unity/convex-mesh.ts::readConvexMesh | 37 | 0.007 | 0.007 | — |
| extractor/game/ground-tile-cache.ts::rename | 24 | 0.007 | 0.007 | — |
| extractor/game/ground-tile-cache.ts::readFile | 26 | 0.005 | 0.005 | 0.026 |
| extractor/game/collision-inputs.ts::readColliderGeometry | 1978 | 0.116 | 0.005 | — |
| extractor/commands/player-ground.ts::rename | 21 | 0.004 | 0.004 | — |
| recast::markWalkableTriangles | 24 | 0.004 | 0.004 | — |
| extractor/game/assets/assets.ts::AssetResolver.read | 2058 | 0.038 | 0.002 | — |
| extractor/game/ground-tile-cache.ts::groundTileCache.load | 24 | 0.032 | 0.001 | 0.153 |
| extractor/game/ground-tile-cache.ts::groundTileCache | 1 | 0.001 | 0.001 | 0.001 |
| extractor/game/collision-inputs.ts::collisionChunkFiles | 42 | 0.116 | 0.000 | 0.107 |
| recast::createHeightfield | 24 | 0.000 | 0.000 | — |
| extractor/game/ground-tile-cache.ts::JSON.parse | 2 | 0.000 | 0.000 | 0.090 |

本样本包含 24 个 tile、100,435 个导航面及 4,207,547 个碰撞三角形。warm 的每个 tile 均命中缓存。Recast detail mesh 的耗时由公开 buildPolyMeshDetail 边界直接测量，原始采样也保留其 WASM 调用栈。

## 动作搜索内部

### 19Nzh29 复杂动作

| 函数 | cold 次数 | cold 含子调用秒 | cold 自身秒 | warm 含子调用秒 |
|---|---:|---:|---:|---:|
| ganglia/jump-planner.mjs::planJumpRoute | 1 | 168.904 | 0.000 | 150.772 |
| ganglia/jump-planner.mjs::planBaseRoute | 3 | 168.886 | 0.000 | 150.767 |
| ganglia/airborne-goal.mjs::planAirborneGoal | 2 | 167.031 | 15.701 | 149.058 |
| ganglia/boosted-route.mjs::planBoostedRoute | 1 | 154.675 | 0.016 | 132.102 |
| ganglia/jump-planner.mjs::planDirectedRoute | 22 | 149.804 | 0.001 | 127.993 |
| ganglia/jump-planner.mjs::solveJumpRoute | 22 | 149.803 | 0.007 | 127.992 |
| ganglia/shortcuts.mjs::findJumpShortcuts | 14 | 143.975 | 0.001 | 121.223 |
| ganglia/shortcuts.mjs::findConnections | 14 | 143.974 | 143.434 | 121.223 |
| ganglia/ground.mjs::createGroundPlanner | 3 | 4.865 | 0.076 | 5.943 |
| ganglia/routes.mjs::search | 50 | 0.727 | 0.727 | 0.602 |
| ganglia/shortcuts.mjs::prepareGeometry | 14 | 0.241 | 0.230 | 0.251 |
| ganglia/locomotion.mjs::retimeGroundRoute | 167 | 0.163 | 0.039 | 0.161 |
| extractor/game/ground-refinement.ts::refineGoalGround | 1 | 0.047 | 0.010 | 0.062 |
| ganglia/ground-detours.mjs::pruneGroundDetours | 1 | 0.000 | 0.000 | 0.000 |

### 0e9bjd3 绕行比较

| 函数 | cold 次数 | cold 含子调用秒 | cold 自身秒 | warm 含子调用秒 |
|---|---:|---:|---:|---:|
| ganglia/locomotion.mjs::retimeGroundRoute | 113 | 32.265 | 10.695 | 32.311 |
| ganglia/ground-detours.mjs::pruneGroundDetours | 1 | 26.096 | 0.111 | 26.188 |
| ganglia/jump-planner.mjs::planJumpRoute | 1 | 22.859 | 0.000 | 23.836 |
| ganglia/jump-planner.mjs::planBaseRoute | 5 | 20.837 | 0.000 | 21.604 |
| ganglia/boosted-route.mjs::planBoostedRoute | 1 | 16.788 | 0.003 | 17.371 |
| ganglia/jump-planner.mjs::planDirectedRoute | 5 | 15.543 | 0.000 | 16.542 |
| ganglia/jump-planner.mjs::solveJumpRoute | 5 | 15.543 | 0.003 | 16.542 |
| ganglia/ground.mjs::createGroundPlanner | 6 | 14.191 | 0.213 | 16.382 |
| ganglia/shortcuts.mjs::findJumpShortcuts | 3 | 7.024 | 0.000 | 7.490 |
| ganglia/shortcuts.mjs::findConnections | 3 | 7.023 | 3.697 | 7.489 |
| extractor/game/ground-refinement.ts::refineGoalGround | 1 | 3.486 | 0.043 | 3.602 |
| ganglia/shortcuts.mjs::prepareGeometry | 3 | 3.157 | 1.512 | 3.348 |
| ganglia/routes.mjs::search | 68 | 1.714 | 1.714 | 1.983 |
| ganglia/route-shortcuts.mjs::findRouteShortcuts | 3 | 0.067 | 0.067 | 0.071 |

### 02gcZm4 绳索／涡流终段

| 函数 | cold 次数 | cold 含子调用秒 | cold 自身秒 | warm 含子调用秒 |
|---|---:|---:|---:|---:|
| ganglia/jump-planner.mjs::planJumpRoute | 1 | 76.704 | 0.001 | 74.355 |
| ganglia/jump-planner.mjs::planBaseRoute | 3 | 76.702 | 0.013 | 74.354 |
| ganglia/airborne-goal.mjs::planAirborneGoal | 2 | 74.302 | 18.328 | 72.157 |
| ganglia/boosted-route.mjs::planBoostedRoute | 1 | 61.190 | 0.001 | 59.834 |
| ganglia/jump-planner.mjs::solveJumpRoute | 25 | 55.459 | 0.005 | 54.289 |
| ganglia/jump-planner.mjs::planDirectedRoute | 24 | 55.457 | 0.000 | 54.288 |
| ganglia/shortcuts.mjs::findJumpShortcuts | 23 | 54.598 | 0.001 | 53.611 |
| ganglia/shortcuts.mjs::findConnections | 23 | 54.597 | 54.332 | 53.610 |
| ganglia/ground.mjs::createGroundPlanner | 4 | 6.607 | 0.060 | 5.968 |
| extractor/game/ground-refinement.ts::refineGoalGround | 1 | 0.242 | 0.010 | 0.104 |
| ganglia/shortcuts.mjs::prepareGeometry | 23 | 0.224 | 0.205 | 0.205 |
| ganglia/routes.mjs::search | 36 | 0.021 | 0.021 | 0.021 |
| ganglia/locomotion.mjs::retimeGroundRoute | 82 | 0.012 | 0.005 | 0.015 |
| ganglia/ground-detours.mjs::pruneGroundDetours | 1 | 0.000 | 0.000 | 0.000 |

- device-entry-search 的 progress 区间累计为 61.195 秒。

### 南北路线未连通窗口

| 函数 | cold 次数 | cold 含子调用秒 | cold 自身秒 | warm 含子调用秒 |
|---|---:|---:|---:|---:|
| ganglia/jump-planner.mjs::planJumpRoute | 1 | 14.502 | 0.000 | 13.716 |
| ganglia/jump-planner.mjs::planBaseRoute | 1 | 14.502 | 0.002 | 13.716 |
| ganglia/jump-planner.mjs::planDirectedRoute | 1 | 14.500 | 0.000 | 13.716 |
| ganglia/jump-planner.mjs::solveJumpRoute | 1 | 14.499 | 0.004 | 13.716 |
| ganglia/shortcuts.mjs::findJumpFrontier | 25 | 11.889 | 0.001 | 11.404 |
| ganglia/shortcuts.mjs::findConnections | 25 | 11.888 | 11.662 | 11.403 |
| ganglia/ground.mjs::createGroundPlanner | 3 | 4.485 | 0.075 | 4.463 |
| extractor/game/ground-refinement.ts::refineGoalGround | 1 | 2.606 | 0.026 | 1.391 |
| ganglia/shortcuts.mjs::prepareGeometry | 1 | 0.211 | 0.211 | 0.209 |
| ganglia/routes.mjs::search | 36 | 0.031 | 0.031 | 0.025 |
| ganglia/locomotion.mjs::retimeGroundRoute | 1 | 0.000 | 0.000 | 0.000 |

### 设备入口逐项搜索

| 函数 | cold 次数 | cold 含子调用秒 | cold 自身秒 | warm 含子调用秒 |
|---|---:|---:|---:|---:|
| ganglia/jump-planner.mjs::planJumpRoute | 1 | 15.074 | 0.000 | 15.551 |
| ganglia/jump-planner.mjs::planBaseRoute | 1 | 15.074 | 0.001 | 15.551 |
| ganglia/jump-planner.mjs::planDirectedRoute | 19 | 14.194 | 0.000 | 14.692 |
| ganglia/jump-planner.mjs::solveJumpRoute | 19 | 14.194 | 0.004 | 14.692 |
| ganglia/shortcuts.mjs::findJumpFrontier | 71 | 10.918 | 0.001 | 11.548 |
| ganglia/shortcuts.mjs::findConnections | 71 | 10.917 | 10.778 | 11.548 |
| ganglia/ground.mjs::createGroundPlanner | 3 | 2.548 | 0.024 | 2.736 |
| extractor/game/ground-refinement.ts::refineGoalGround | 1 | 1.572 | 0.020 | 1.297 |
| ganglia/locomotion.mjs::retimeGroundRoute | 23 | 0.948 | 0.219 | 0.909 |
| ganglia/ground-detours.mjs::pruneGroundDetours | 1 | 0.309 | 0.030 | 0.301 |
| ganglia/shortcuts.mjs::prepareGeometry | 1 | 0.114 | 0.114 | 0.107 |
| ganglia/routes.mjs::search | 202 | 0.100 | 0.100 | 0.108 |

- device-entry-search 的 progress 区间累计为 6.307 秒。

### 粗方向逐项搜索

| 函数 | cold 次数 | cold 含子调用秒 | cold 自身秒 | warm 含子调用秒 |
|---|---:|---:|---:|---:|
| ganglia/jump-planner.mjs::planJumpRoute | 1 | 20.763 | 0.000 | 18.529 |
| ganglia/jump-planner.mjs::planBaseRoute | 1 | 20.763 | 0.000 | 18.529 |
| ganglia/jump-planner.mjs::planDirectedRoute | 1 | 20.763 | 0.058 | 18.529 |
| ganglia/jump-planner.mjs::solveJumpRoute | 10 | 19.570 | 0.004 | 17.257 |
| ganglia/shortcuts.mjs::findConnections | 25 | 15.394 | 12.430 | 12.771 |
| ganglia/shortcuts.mjs::findJumpFrontier | 24 | 13.722 | 0.001 | 11.382 |
| ganglia/ground.mjs::createGroundPlanner | 3 | 13.577 | 0.170 | 15.725 |
| ganglia/shortcuts.mjs::prepareGeometry | 1 | 2.861 | 0.695 | 2.465 |
| ganglia/routes.mjs::search | 102 | 1.967 | 1.967 | 1.762 |
| ganglia/ground-detours.mjs::pruneGroundDetours | 1 | 1.685 | 0.052 | 1.637 |
| ganglia/shortcuts.mjs::findJumpShortcuts | 1 | 1.674 | 0.000 | 1.389 |
| extractor/game/ground-refinement.ts::refineGoalGround | 1 | 1.408 | 0.052 | 0.761 |
| ganglia/locomotion.mjs::retimeGroundRoute | 107 | 0.099 | 0.036 | 0.091 |
| ganglia/route-shortcuts.mjs::findRouteShortcuts | 1 | 0.044 | 0.044 | 0.042 |

- direction-search 的 progress 区间累计为 21.307 秒。

### 0e9bjd3 低开销绕行计时

| 函数 | cold 次数 | cold 含子调用秒 | cold 自身秒 | warm 含子调用秒 |
|---|---:|---:|---:|---:|
| ganglia/locomotion.mjs::retimeGroundRoute | 113 | 29.472 | 29.472 | 28.850 |
| ganglia/jump-planner.mjs::planJumpRoute | 1 | 26.596 | 0.000 | 21.980 |
| ganglia/jump-planner.mjs::planBaseRoute | 5 | 23.236 | 0.000 | 19.316 |
| ganglia/ground-detours.mjs::pruneGroundDetours | 1 | 22.295 | 0.101 | 22.508 |
| ganglia/boosted-route.mjs::planBoostedRoute | 1 | 20.376 | 0.006 | 16.486 |
| ganglia/jump-planner.mjs::planDirectedRoute | 5 | 18.099 | 0.000 | 14.603 |
| ganglia/jump-planner.mjs::solveJumpRoute | 5 | 18.099 | 0.004 | 14.602 |
| ganglia/ground.mjs::createGroundPlanner | 6 | 14.660 | 0.282 | 14.996 |
| ganglia/shortcuts.mjs::findJumpShortcuts | 3 | 8.603 | 0.001 | 6.781 |
| ganglia/shortcuts.mjs::findConnections | 3 | 8.603 | 4.237 | 6.781 |
| ganglia/shortcuts.mjs::prepareGeometry | 3 | 4.082 | 2.185 | 2.885 |
| extractor/game/ground-refinement.ts::refineGoalGround | 1 | 3.579 | 0.038 | 3.475 |
| ganglia/routes.mjs::search | 68 | 1.798 | 1.798 | 2.099 |
| ganglia/route-shortcuts.mjs::findRouteShortcuts | 3 | 0.068 | 0.068 | 0.064 |

### 每次方向与设备入口搜索

每个区间以同次搜索的开始／完成事件配对，包含函数结束后写入诊断的少量记账。

| 样本 | 缓存 | 阶段 | 序号 | 结果 | 秒 |
|---|---|---|---:|---|---:|
| device-entry | cold | device-entry-search | 1/33 | no-verified-route | 0.002 |
| device-entry | cold | device-entry-search | 2/33 | no-verified-route | 0.002 |
| device-entry | cold | device-entry-search | 3/33 | no-verified-route | 0.238 |
| device-entry | cold | device-entry-search | 4/33 | no-verified-route | 0.240 |
| device-entry | cold | device-entry-search | 5/33 | no-verified-route | 0.206 |
| device-entry | cold | device-entry-search | 6/33 | no-verified-route | 0.330 |
| device-entry | cold | device-entry-search | 7/33 | no-verified-route | 0.456 |
| device-entry | cold | device-entry-search | 8/33 | no-verified-route | 0.331 |
| device-entry | cold | device-entry-search | 9/33 | no-verified-route | 0.236 |
| device-entry | cold | device-entry-search | 10/33 | no-verified-route | 0.261 |
| device-entry | cold | device-entry-search | 11/33 | no-verified-route | 0.333 |
| device-entry | cold | device-entry-search | 12/33 | no-verified-route | 0.319 |
| device-entry | cold | device-entry-search | 13/33 | no-verified-route | 0.331 |
| device-entry | cold | device-entry-search | 14/33 | no-verified-route | 0.205 |
| device-entry | cold | device-entry-search | 15/33 | no-verified-route | 0.395 |
| device-entry | cold | device-entry-search | 16/33 | no-verified-route | 0.401 |
| device-entry | cold | device-entry-search | 17/33 | no-verified-route | 0.409 |
| device-entry | cold | device-entry-search | 18/33 | no-verified-route | 0.002 |
| device-entry | cold | device-entry-search | 19/33 | no-verified-route | 0.352 |
| device-entry | cold | device-entry-search | 20/33 | no-verified-route | 0.333 |
| device-entry | cold | device-entry-search | 21/33 | complete | 0.618 |
| device-entry | warm | device-entry-search | 1/33 | no-verified-route | 0.002 |
| device-entry | warm | device-entry-search | 2/33 | no-verified-route | 0.002 |
| device-entry | warm | device-entry-search | 3/33 | no-verified-route | 0.248 |
| device-entry | warm | device-entry-search | 4/33 | no-verified-route | 0.224 |
| device-entry | warm | device-entry-search | 5/33 | no-verified-route | 0.210 |
| device-entry | warm | device-entry-search | 6/33 | no-verified-route | 0.324 |
| device-entry | warm | device-entry-search | 7/33 | no-verified-route | 0.411 |
| device-entry | warm | device-entry-search | 8/33 | no-verified-route | 0.318 |
| device-entry | warm | device-entry-search | 9/33 | no-verified-route | 0.238 |
| device-entry | warm | device-entry-search | 10/33 | no-verified-route | 0.517 |
| device-entry | warm | device-entry-search | 11/33 | no-verified-route | 0.406 |
| device-entry | warm | device-entry-search | 12/33 | no-verified-route | 0.359 |
| device-entry | warm | device-entry-search | 13/33 | no-verified-route | 0.354 |
| device-entry | warm | device-entry-search | 14/33 | no-verified-route | 0.223 |
| device-entry | warm | device-entry-search | 15/33 | no-verified-route | 0.420 |
| device-entry | warm | device-entry-search | 16/33 | no-verified-route | 0.420 |
| device-entry | warm | device-entry-search | 17/33 | no-verified-route | 0.419 |
| device-entry | warm | device-entry-search | 18/33 | no-verified-route | 0.002 |
| device-entry | warm | device-entry-search | 19/33 | no-verified-route | 0.355 |
| device-entry | warm | device-entry-search | 20/33 | no-verified-route | 0.324 |
| device-entry | warm | device-entry-search | 21/33 | complete | 0.514 |
| direction | cold | direction-search | 1/9 | complete | 0.032 |
| direction | cold | direction-search | 2/9 | complete | 3.735 |
| direction | cold | direction-search | 3/9 | no-verified-route | 1.128 |
| direction | cold | direction-search | 4/9 | no-verified-route | 0.859 |
| direction | cold | direction-search | 5/9 | complete | 1.836 |
| direction | cold | direction-search | 6/9 | no-verified-route | 1.829 |
| direction | cold | direction-search | 7/9 | complete | 1.531 |
| direction | cold | direction-search | 8/9 | no-verified-route | 1.419 |
| direction | cold | direction-search | 9/9 | no-verified-route | 1.191 |
| direction | warm | direction-search | 1/9 | complete | 0.043 |
| direction | warm | direction-search | 2/9 | complete | 3.602 |
| direction | warm | direction-search | 3/9 | no-verified-route | 1.241 |
| direction | warm | direction-search | 4/9 | no-verified-route | 0.920 |
| direction | warm | direction-search | 5/9 | complete | 0.968 |
| direction | warm | direction-search | 6/9 | no-verified-route | 0.964 |
| direction | warm | direction-search | 7/9 | complete | 1.320 |
| direction | warm | direction-search | 8/9 | no-verified-route | 1.331 |
| direction | warm | direction-search | 9/9 | no-verified-route | 1.220 |
| tail | cold | device-entry-search | 1/2 | no-verified-route | 0.000 |
| tail | cold | device-entry-search | 2/2 | no-verified-route | 0.000 |
| tail | warm | device-entry-search | 1/2 | no-verified-route | 0.000 |
| tail | warm | device-entry-search | 2/2 | no-verified-route | 0.000 |

### jump-discovery 进度区间的叶节点采样分区

下表沿用原始进度事件区间，区间结束于下一条进度事件。方向搜索与设备入口会进入各自的进度区间，部分结果比较也可能位于最后一条搜索事件之后。完整 search 耗时以 diagnostics.timingMs.search 及函数 stopwatch 为准。每个采样叶节点在同组中计入一个类别。

| 样本 | 类别 | cold 采样秒 |
|---|---|---:|
| action | Ganglia/bounds.mjs | 54.435 |
| action | Ganglia/shortcuts.mjs | 40.421 |
| action | Garbage collection | 24.276 |
| action | Ganglia/collision.mjs | 20.291 |
| action | Ganglia/landings.mjs | 5.677 |
| action | Ganglia/goals.mjs | 5.430 |
| action | Ganglia/surfaces.mjs | 2.763 |
| action | Ganglia/straighten.mjs | 2.667 |
| action | Ganglia/jumps.mjs | 2.377 |
| action | Ganglia/traversal.mjs | 1.938 |
| action | Ganglia/airborne-goal.mjs | 1.876 |
| action | Ganglia/boundary-order.mjs | 1.356 |
| action | Profiler frames | 1.228 |
| action | Other runtime | 1.213 |
| action | Ganglia/routes.mjs | 1.087 |
| action | Ganglia/ground.mjs | 0.678 |
| action | Ganglia/walls.mjs | 0.330 |
| action | Ganglia/connectivity.mjs | 0.244 |
| action | Ganglia/distance-field.mjs | 0.241 |
| action | Ganglia/locomotion.mjs | 0.123 |
| action | Ganglia/heap.mjs | 0.100 |
| action | Ganglia/support-snapshot.mjs | 0.057 |
| action | Ganglia/motion.mjs | 0.037 |
| action | Ganglia/movement-geometry.mjs | 0.027 |
| action | Extractor JS | 0.011 |
| action | Ganglia/support-projector.mjs | 0.008 |
| action | Ganglia/boosted-route.mjs | 0.006 |
| action | Ganglia/jump-planner.mjs | 0.006 |
| action | Async context | 0.003 |
| action | Node JS | 0.001 |
| detours-lowoverhead | Ganglia/locomotion.mjs | 22.113 |
| detours-lowoverhead | Garbage collection | 9.896 |
| detours-lowoverhead | Ganglia/straighten.mjs | 2.325 |
| detours-lowoverhead | Ganglia/surfaces.mjs | 2.309 |
| detours-lowoverhead | Ganglia/bounds.mjs | 2.245 |
| detours-lowoverhead | Ganglia/traversal.mjs | 2.132 |
| detours-lowoverhead | Ganglia/shortcuts.mjs | 1.463 |
| detours-lowoverhead | Ganglia/routes.mjs | 1.330 |
| detours-lowoverhead | Ganglia/collision.mjs | 1.182 |
| detours-lowoverhead | Ganglia/walls.mjs | 0.821 |
| detours-lowoverhead | Profiler frames | 0.594 |
| detours-lowoverhead | Ganglia/boundary-order.mjs | 0.467 |
| detours-lowoverhead | Other runtime | 0.372 |
| detours-lowoverhead | Ganglia/connectivity.mjs | 0.338 |
| detours-lowoverhead | Ganglia/support-snapshot.mjs | 0.283 |
| detours-lowoverhead | Ganglia/distance-field.mjs | 0.233 |
| detours-lowoverhead | Ganglia/ground.mjs | 0.217 |
| detours-lowoverhead | Ganglia/goals.mjs | 0.165 |
| detours-lowoverhead | Ganglia/landings.mjs | 0.155 |
| detours-lowoverhead | Ganglia/heap.mjs | 0.120 |
| detours-lowoverhead | Ganglia/jumps.mjs | 0.046 |
| detours-lowoverhead | Ganglia/ground-detours.mjs | 0.031 |
| detours-lowoverhead | Ganglia/motion.mjs | 0.026 |
| detours-lowoverhead | Ganglia/route-shortcuts.mjs | 0.013 |
| detours-lowoverhead | Ganglia/movement-geometry.mjs | 0.004 |
| detours-lowoverhead | Extractor JS | 0.004 |
| detours-lowoverhead | Ganglia/boosted-route.mjs | 0.003 |
| detours-lowoverhead | Ganglia/support-projector.mjs | 0.003 |
| detours-lowoverhead | Ganglia/jump-planner.mjs | 0.002 |
| detours-lowoverhead | Async context | 0.001 |
| direction | Ganglia/routes.mjs | 0.633 |
| direction | Garbage collection | 0.169 |
| direction | Ganglia/connectivity.mjs | 0.108 |
| direction | Ganglia/straighten.mjs | 0.045 |
| direction | Ganglia/goals.mjs | 0.040 |
| direction | Ganglia/surfaces.mjs | 0.036 |
| direction | Profiler frames | 0.036 |
| direction | Other runtime | 0.026 |
| direction | Ganglia/heap.mjs | 0.019 |
| direction | Ganglia/walls.mjs | 0.016 |
| direction | Ganglia/bounds.mjs | 0.010 |
| direction | Ganglia/motion.mjs | 0.003 |
| direction | Ganglia/movement-geometry.mjs | 0.001 |
| direction | Ganglia/ground.mjs | 0.000 |
| device-entry | Ganglia/bounds.mjs | 3.637 |
| device-entry | Ganglia/shortcuts.mjs | 1.504 |
| device-entry | Ganglia/collision.mjs | 0.885 |
| device-entry | Garbage collection | 0.594 |
| device-entry | Ganglia/goals.mjs | 0.583 |
| device-entry | Ganglia/traversal.mjs | 0.551 |
| device-entry | Ganglia/boundary-order.mjs | 0.241 |
| device-entry | Ganglia/landings.mjs | 0.217 |
| device-entry | Ganglia/surfaces.mjs | 0.200 |
| device-entry | Profiler frames | 0.127 |
| device-entry | Ganglia/jumps.mjs | 0.119 |
| device-entry | Other runtime | 0.113 |
| device-entry | Ganglia/walls.mjs | 0.089 |
| device-entry | Ganglia/routes.mjs | 0.070 |
| device-entry | Ganglia/connectivity.mjs | 0.063 |
| device-entry | Ganglia/straighten.mjs | 0.040 |
| device-entry | Ganglia/ground.mjs | 0.014 |
| device-entry | Ganglia/distance-field.mjs | 0.011 |
| device-entry | Ganglia/heap.mjs | 0.004 |
| device-entry | Ganglia/motion.mjs | 0.004 |
| device-entry | Ganglia/support-projector.mjs | 0.003 |
| device-entry | Node JS | 0.002 |
| device-entry | Async context | 0.001 |
| device-entry | Ganglia/movement-geometry.mjs | 0.001 |
| device-entry | Ganglia/jump-planner.mjs | 0.001 |

细粒度空间近邻、候选配对、落点生成与胶囊扫掠采用采样归因，保留各自自身和含子调用估计。初步可相加叶节点分类及父子调用解释见分析文件。

[动作与地面采样分析](</Users/canvas/_Code/EF Repos/endfield-noclip/.research/stage123/detailed-profile-20261110/profile-analysis-final.md>)

## 全局候选内部

| 阶段 | cold 秒 | warm 秒 |
|---|---:|---:|
| 导航数据读取／JSON | 0.809 | 0.000 |
| 候选拓扑准备 | 91.663 | 0.000 |
| 候选搜索 | 10.693 | 1.552 |
| worker plan total | 103.165 | 1.553 |

| 函数 | cold 次数 | cold 含子调用秒 | cold 自身秒 |
|---|---:|---:|---:|
| ganglia/candidate-planner.mjs::createCandidatePlanner | 1 | 91.661 | 86.682 |
| ganglia/candidate-planner.mjs::createCandidatePlanner.plan | 1 | 10.688 | 10.663 |
| ganglia/surfaces.mjs::surfacePortals | 1 | 2.379 | 2.379 |
| ganglia/surfaces.mjs::surfaceGraph | 1 | 2.065 | 2.065 |
| world/candidate-worker.ts::plan | 1 | 103.167 | 0.818 |
| ganglia/connectivity.mjs::groundComponents | 1 | 0.535 | 0.535 |
| ganglia/straighten.mjs::createGroundStraightener | 1 | 0.025 | 0.025 |

输入复用正常 travelArrivals 与 selectTerminal，85 个起点、640,747 个导航面，查询目标为已验证终段的地面入口。

## 插桩对照

| 样本／缓存 | 插桩秒 | 关闭插桩秒 | 观察差 |
|---|---:|---:|---:|
| 19Nzh29 复杂动作 cold | 173.348 | 154.793 | 11.99% |
| 19Nzh29 复杂动作 warm | 155.802 | 152.763 | 1.99% |
| 地面构建及 I/O 细分 cold | 18.148 | 16.395 | 10.69% |
| 地面构建及 I/O 细分 warm | 3.984 | 3.936 | 1.21% |
| 0e9bjd3 低开销绕行计时 cold | 65.509 | 61.459 | 6.59% |
| 0e9bjd3 低开销绕行计时 warm | 60.528 | 57.692 | 4.92% |

初版 detours 对 scheduleBlock 进行了约 385 万次逐调用计时。最终 loader 将该高频 DP 函数交由采样分析，detours-lowoverhead 使用更新后的白名单，原始试验全部保留。

这些是单次冷／热对照，两组均启用 CPU 采样，观察差覆盖源码插桩增量及运行波动。采样器自身的开销尚未单独量化。路线／几何一致性比较保留在审查结果。

## 普通 HTTP 入口

全新 Vite 查询服务与候选 worker、保留的物理磁盘缓存及已验证终段资产条件下，普通 02gcZm4 入口在 97.689 秒观察到完整结果，含 1 秒间隔轮询。Vite 初始化另为 0.297 秒，合计 97.986 秒。相同请求缓存复用耗时 0.008 秒。完整结果代价为 96.075256 模型秒、707.206168 米。

[逐次请求与缓存口径](</Users/canvas/_Code/EF Repos/endfield-noclip/.research/stage123/detailed-profile-20261110/ordinary-http/summary.json>)

| 普通入口阶段 | 秒 |
|---|---:|
| 导航读取 | 0.859 |
| 候选准备 | 71.262 |
| 候选搜索 | 9.052 |
| 候选 worker 合计 | 81.174 |
| 其余入口／缓存读取／窗口拼接／轮询合并项 | 16.515 |

该普通请求记录到 6 次物理结果磁盘缓存命中。其余入口合并项的内部细分仍有覆盖缺口，逐次 HTTP 耗时与状态均保留。终段资产复用与整条路线深比较通过。

## 工具验证与交付

World 52/52、Ganglia 242/242 的既有验证结果保留。本轮补跑 server／worker／历史计时测试 14/14，extractor 路线测试在配置的 Node v26.13.0 下为 18/18。默认 Node v25.9.0 首次运行 extractor 测试遇到 Map.getOrInsertComputed 不可用，切换至项目配置运行时后通过。profiling 工具新增测试 5/5。World 类型检查通过。

新增独立 profiling CLI、loader 和计时保护测试。生产算法实现及此次检查发现的合同缺口保留在测量状态。

[完整函数阶段表](</Users/canvas/_Code/EF Repos/endfield-noclip/.research/stage123/detailed-profile-20261110/all-stages.md>) · [函数 stopwatch CSV](</Users/canvas/_Code/EF Repos/endfield-noclip/.research/stage123/detailed-profile-20261110/function-stopwatches.csv>) · [CPU 函数采样 CSV](</Users/canvas/_Code/EF Repos/endfield-noclip/.research/stage123/detailed-profile-20261110/cpu-function-samples.csv>) · [progress 区间 CSV](</Users/canvas/_Code/EF Repos/endfield-noclip/.research/stage123/detailed-profile-20261110/progress-intervals.csv>) · [逐次搜索 CSV](</Users/canvas/_Code/EF Repos/endfield-noclip/.research/stage123/detailed-profile-20261110/search-attempts.csv>) · [全部运行 CSV](</Users/canvas/_Code/EF Repos/endfield-noclip/.research/stage123/detailed-profile-20261110/runs.csv>)

每个样本目录下的 cold／warm 子目录保存 stages.json、stages.md、result.json、command.log 和 cpu.cpuprofile。

## 复现

使用 extractor 配置的 Node 可执行文件，输入为已保存的参数数组。输出目录需要全新创建。

```sh
/Users/canvas/.npm/_npx/bac97da9607b7ef2/node_modules/node/bin/node --max-old-space-size=6144 \
  talos/scripts/profile-route-stages.mjs \
  --command player-ground \
  --extractor talos/.cache/noclip \
  --args '/Users/canvas/_Code/EF Repos/endfield-noclip/.research/stage123/detailed-profile-20261110/ground-args.json' \
  --output /tmp/atlos-ground-profile-new --cpu
```

`player-route` 使用相同格式的参数数组。`candidate-worker` 使用 candidate-input.json 并复用普通 worker 的 plan 实现。加 --baseline 可关闭函数插桩。
