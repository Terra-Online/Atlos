# 行为基线与测试入口

本轮对应本地 `docs/roadmap.md` 的阶段 2，先完成行为基线。该计划由仓库明确忽略，继续保留本地；可提交的行为与验证记录以本索引为入口。范围包含主站 `component/`、`pages/` 全部生产 TSX、两个独立 app 的组件与启动行为；地图渲染内核的既有专项测试保留，不修改其渲染实现。

## 当前验收状态：未完成

2026-10-27 复核修正：完成的是首轮逐文件审查、组件/集成测试与 fixture 补充，以及当轮已复现缺陷的修复。**行为基线整体尚未验收，不能将 109 个生产 TSX 均有审查记录或 979 条测试通过，解释为所有功能、时序与动画均有保护。** 原完整检查的通过结果仍成立；以下缺口不能由重复运行该检查消除。

后续扩展或重构前，需补齐以下证据。动画的进出场、打断、命中区域与状态衔接属于行为；帧耗时、掉帧和资源占用另属性能基线，不能把动画正确性推迟到性能阶段。

| 未完成项 | 当前证据及具体缺口 | 验收结果应能说明什么 |
| --- | --- | --- |
| 功能与状态清单 | 现有领域表以文件为行，混合记录设计意图和部分用例，未逐项列明每个功能的合法状态、事件及证据状态 | 为各组件及关键 owner 列出输入、输出、副作用、正常/空/错误/忙碌/禁用状态；适用的每条契约对应有效证据，未测与不适用需写明依据，不以单条 smoke 代表整个文件 |
| 关键异步交错 | 已覆盖多处旧响应、卸载、账号 ABA，但不是所有延迟、轮询、rAF、动画回调都已审查；引导仍有独立调度的下一步、目标重试、滚动与异步步骤动作 | 对重要可观察副作用验证完成前关闭/跳过/卸载、关闭后重开、切换对象/身份、快速反向操作；旧 owner 的任务不能影响新流程，失败/取消后控制权可恢复 |
| 动画与布局 | Modal suite 保护阶段和延迟卸载，未证明 CSS 过渡；AdaptiveLinearBlur suite 使用 `animate` 替身并手动触发 `onfinish`；Intel 虚拟卡片用测量与 observer fixture | 在实际浏览器保留真实 CSS/Motion/WAAPI，验证进入、退出、中途反转、连点、尺寸/字体变化与桌面/移动布局切换，观察中间状态和最终状态；记录图像或轨迹证据，不能只推进固定毫秒数后检查 DOM |
| 完整跨组件路径 | Intel App suite 明确替换共享 shell、顶栏和同步 host；引导替换 Joyride driver；其它 suite 的局部组合也不等于全站组合 | 用完整入口覆盖搜索→筛选→详情→评论/图片、浮层叠加与焦点/滚动锁、账号→同步冲突→继续操作、引导→目标展开/滚动、app 之间共享进度与身份的链路 |
| 浏览器与持久化边界 | 默认 UI suite 全部运行于 jsdom；Popover、pointer capture、视口和跨文档行为有显式替身；无已执行的浏览器 E2E | 真实 top layer、触摸/鼠标/键盘、输入法、滚动/resize、页面后台恢复、刷新恢复和跨标签页广播有结果；记录实际验证的浏览器/设备范围，不能把桌面触摸模拟写成真机验收 |
| 可复用的对照与执行入口 | 已有测试入口和修复回归记录，尚无已执行的浏览器行为/动画对照集 | 固定可复现的数据与状态，保存已确认版本的路径、关键画面/轨迹和结果；后续改动在相同条件下比较，用户确认的修复作为明确差异，不能为追求与旧版相同而保留缺陷 |

### 复核修复：引导演示与真实进度

修复前，`pages/userGuide/procedure/steps.desktop.ts` 的 `STEP-6_selector-complete`、`STEP-7_trigger-handle`，以及 mobile 的相应步骤，会在 `loadAllMarkers()` 返回后逐点执行 `applyPointProgressSilently` 的 collect/uncollect。这个函数写真实 `useUserRecordStore.activePoints` 和时间，只是不添加撤销记录；`ProgressSyncHost` 订阅该数组变化。后续批量 uncollect 不恢复用户原先的完成集合，且步骤动作没有向引导 owner 返回这些 Promise。

用户已确认“隔离演示状态，保留用户真实进度”。新增的桌面/移动回归在修复前均失败，直接观察到原 store 增加 `guide-new` 且改写时间戳；未声称线上数据丢失或真实服务已收到写入。现在 `store/guideProgress.ts` 只为显示提供临时覆盖：地图标记/聚合、统计和详情读演示值，持久化、导出、历史和云同步继续读真实记录。结束、跳过、外部关闭、卸载及同批关闭后重开使旧请求失效；清除演示后直接显示最新真实记录，避免用旧快照覆盖演示期间的真实编辑。重复加载按最后一次动作生效，步骤向 owner 返回 Promise，原先仅为引导使用的 silent 写入入口及其旧测试已被移除。

`UserGuide.spec.tsx`、`guideProgress.spec.tsx`、`marker.counts.spec.ts` 与 `map/useMarker.spec.tsx` 保护实际步骤接线、生命周期、反序返回、失败恢复、不通知真实进度消费者、不改存储/历史、真实点位统计和真实 Leaflet 标记模型；相关 12 文件、56 条用例通过。统计验证使用真实本地点位加载；最初把统计断言放在替换了 `loadRegionMarkers` 的 map fixture 中时，因为该替身没有填充数据缓存而得到 0，现将统计验证移到已有真实数据 suite，保留原地图断言并增加演示状态回归。这不证明真实动画画面、Joyride 测量或引导其它延时回调都已验收；上表缺口继续保留。

继续复核 Promise 接线时，新用例另检出旧步骤在 skip→重新打开→旧加载完成后把新引导从第 0 步跳到第 6 步。现以引导轮次校验异步完成及延迟推进，并在轮次边界重置 transition 锁；补充旧 Promise 与旧推进延迟两条用例。其它目标重试、步骤内部滚动等待和真实 Joyride 定位不在这一修复的完成声明中。

## 范围与证据索引

| 范围 | 逐项核对记录 | 验证方式 |
| --- | --- | --- |
| 19 个基础 TSX、选择 hook、搜索、MapPage、主站启动 | [controls](behavior-audit-controls.md) | 已有用例边界复核；新增真实组件、store、Orama、Leaflet 与异步/浮层组合 |
| 17 个 shared TSX、账户/语言/同步与持久化 | [shared](behavior-audit-shared.md) | 真实 Modal/表单/store/同步冲突选择；服务与字体边界可控替身 |
| pages 的全部 53 个生产 TSX | [pages](behavior-audit-pages.md)；MapPage/搜索详见 controls | 桌面/移动、筛选→详情、编辑/上传、定位、通知、引导、存储与地图菜单组合 |
| Intel 10 个、user-hub 10 个生产 TSX | [apps](behavior-audit-apps.md) | 真实 app/组件/状态组合与现有协议、分页、locale 测试 |

每份核对表记录源码意图、旧测试的实际保护范围、新证据和未覆盖的运行环境。空的未使用 `favPOI` 与未启用的 `LazyApp` 明确标注，不用假 smoke 冒称活跃产品路径。TSX 中的 helper、wrapper、不同布局可由同一条有实际用户结果断言的组合覆盖，不按文件机械添加渲染快照。

## 标准执行入口

在 `talos/` 执行：

| 命令 | 范围与外部依赖 |
| --- | --- |
| `pnpm test` | Node 脚本测试、主站/Relink、Intel、user-hub；不调用生产服务 |
| `pnpm type-check` | 主站与全部 app/worker，先生成所需类型输入 |
| `pnpm lint` | tracked 与 non-ignored 新文件的 ESLint、Stylelint |
| `pnpm check` | 数据校验→类型准备与全项目类型检查→lint→上述所有默认 tests |
| `pnpm exec vitest run <路径>` | 精确运行该组件/页面及其组合 suite；新增文件一律 `.spec.*` |
| `pnpm exec vitest run --coverage` | 可选 V8 代码覆盖报告；本轮不以百分比作为行为完成标准 |

Intel 默认 UI 用 jsdom；`apps/intel/src/data/importContract.spec.ts` 单独标注 Node 环境，保留真实 Web Streams/Blob/gzip 校验。主站 config 增加项目现有 React/SVGR 插件以运行真实组件，不修改生产 bundle 切分。`test-support/browser.ts`、`test-support/pages.ts`、`test-support/search.ts` 和 app/shared fixture 的模拟边界见各核对表。

CI 的 `.github/workflows/build.yml` 已静态确认调用 `pnpm check --build --source-only --skip-subset`，包含完整 check 后才做源码构建；本次没有推送或触发远端 CI。

## 用户确认的产品契约

| TEST-ID | 决定 | 证据索引 |
| --- | --- | --- |
| TEST-SEARCH-001 | Enter 不提交或刷新，保留查询和地图状态 | controls |
| TEST-HUB-AUTH-001 | 贡献列表 401 留在 `/me/` 登录，同账号续原 cursor，另一账号重新加载私有数据 | apps |
| TEST-HUB-LOCALE-001 | 评论日期使用当前 app 语言 | apps |
| TEST-BINDING-BUSY-001 | 绑定请求未完成前禁用关闭与 SKLAND/SKPORT 切换，失败后可操作 | pages |
| TEST-SYNC-OWNER-001 | 切换账号后，本地与新云端不同时由用户选本地、云端或合并，不能沿用旧账号 baseline 自动覆盖 | shared |
| TEST-IMPORT-RETRY-001 | 已有动态入口按需要加载，加载失败间隔重试到成功；关闭/卸载停止后续尝试；静态弹窗不因基线任务重新拆包 | controls、apps、shared |
| TEST-SYNC-DISTRIBUTION-001 | 点位/类型不对齐仍可静默忽略；真正数据加载未完成时不冒充完整明细，失败持续重试；官方导入 API 错误保留数据并给出失败提示 | shared |
| TEST-GUIDE-PROGRESS-001 | 详细引导使用隔离演示状态，保留用户真实进度；清理后显示最新真实记录，旧加载不得影响新一轮引导 | pages；上方复核记录 |

## 真实回归与测试设计

重要修复均先用原始失败形状验证，再修改实现。包括重复 Enter/关闭通知、Loading 重复完成、搜索旧响应与 fallback 错区、拖动取消与卸载清理、账号/点位切换后的异步写回、同步基线归属、编辑失败草稿丢失。各核对表记录修复前结果与对应 TEST-ID；没有放宽断言、跳过用例或 bulk snapshot 更新来消除这些失败。

异步用可控 Promise 和实际 store/sessionVersion；浮层用真实 Modal/Viewer/Popover/ContextMenu/ActionBar 组合；分页、投票、回滚和冲突验证最终 UI/数据关系。仅“函数被调用”、mock 内字段或渲染成功不作为这些链路的完整证据。

## 集成验证记录

2026-10-27，仓库 `refactor/standard`：

| 实际执行 | 结果 |
| --- | --- |
| `VITEST_MAX_FORKS=4 VITEST_MIN_FORKS=1 pnpm check` | **退出 0**；仅限制本机测试并发，不缩小发现范围 |
| 数据校验 | overrides、Intel 数据、各 app/ICU locale、tile coverage 与 marker lookup 均通过 |
| 类型检查 | 主站、Intel、user-hub、oem-search、oem-relink 全部通过 |
| lint | ESLint 606 文件，0 error、1 既有 warning；Stylelint 92 文件通过 |
| Node 脚本 suite | 29 例通过，无跳过/取消 |
| 主站与 Relink | 151 文件、836 例通过 |
| Intel | 9 文件、58 例通过 |
| User hub | 11 文件、56 例通过 |
| `git diff --check` | 通过 |
| tracked `.test.*` 检查 | `git ls-files '*.test.*'` 无结果 |

共 **979 条用例**，均来自标准入口；不是“本轮新增 979 条”。完整本地日志为 `/tmp/atlos-behavior-check-pass.log`，关键结果保存在本表以便日志清理后仍能审查。

首次集中 check 在新增测试类型处退出 1，补齐按钮查询的元素泛型和 SessionUser fixture 必填字段、去掉无用 import 后，所有项目类型检查通过。第二次进入 lint 后发现原 `reorderContext.spec.ts` 两个只改变数组内容的变量用了 `let`，改为 `const`；同时消除本轮 conflict 的不稳定空数组依赖 warning。最终完整 check 退出 0。没有改变行为断言来绕过这两轮失败。

保留的提示来自未修改的 `locale/useFontRegion.ts` 的依赖 warning、通知 `NotificationMessage` 的既有 React key warning，以及过期 Browserslist 数据提示；未升级依赖或屏蔽提示。未运行生产构建、远端 CI、浏览器 E2E 或性能基线。

### 复核修复的验证过程

隔离演示修复的首轮相关 12 文件、56 例通过；增加引导轮次回归与纠正 Drawer 准备条件后，两文件 19 例通过，引导单文件 15 例也通过。过程中完整检查先在新测试的 Layer/GuideStep 类型处退出，再在 useMemo 回调推断与测试 act 返回类型的 lint 约束处退出；均通过正确类型与回调上下文修正，没有改断言来消除失败。后续完整检查检出上述 Drawer 的 0.08px 时序假设。引导清理使用数值 ref 的 lint 提示通过收拢重复的失效操作消除，未添加 suppression。

复核修复完成后的 `VITEST_MAX_FORKS=4 VITEST_MIN_FORKS=1 pnpm check` **退出 0**，本地日志 `/tmp/atlos-behavior-followup-check-final.log`：

| 范围 | 实际结果 |
| --- | --- |
| 数据与类型 | 数据校验、主站与四 app/worker 项目类型检查全部通过 |
| lint | ESLint 608 文件，0 error、1 既有 warning；Stylelint 92 文件通过 |
| Node 脚本 | 29 例通过 |
| 主站与 Relink | 152 文件、850 例通过 |
| Intel / User hub | 9 文件、58 例 / 11 文件、56 例通过 |
| 合计 | 993 例通过；不等于全部用户行为已验收 |

最后一轮通过后仅整理此验证记录与本地提交，未补记浏览器 E2E、生产构建、真实服务或性能结果。

## 保留的验证边界

- jsdom 的布局、IntersectionObserver/ResizeObserver、native Popover、pointer capture 与 FontFace 是显式 fixture；这些测试不证明真实浏览器 top layer、视觉/字体重排、触控合成或浏览器默认表单导航。
- 服务替身覆盖失败、取消、竞态和载荷契约，不代表 Bayes/OEM-SDK 等服务端、线上认证/CDN、真实跨标签页传输或真实设备已验收。
- 性能基线尚未执行：包体、首屏、Profiler、真实设备耗时不能从这些行为测试推导。后续性能工作须另存同环境、同输入的前后数据。

新需求、测试入口变更或新回归出现时，更新对应领域核对表及 TEST-ID；不再复制每个测试函数到本索引。
