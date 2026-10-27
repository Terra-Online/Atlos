# 基础组件与主站启动行为核对

范围为 `talos/src/component/` 下 shared 以外的全部 19 个 TSX、选择 hook、主站搜索、`MapPage` 和启动入口。先读实现及调用方，再检查既有断言是否真的保护输入、输出和生命周期；本表不把文件存在或代码覆盖率当作验收。

所有 spec 均由主站 `vitest.config.ts` 的正常发现机制运行。新增 React/SVGR 转换使用项目已经安装的插件，减少图标替身；不会改动生产构建配置。

## 逐组件核对与已有测试复核

以下组件路径相对于 `talos/src/component/`。

| 文件 | 设计意图、原用例边界与补充 | 可执行证据 |
| --- | --- | --- |
| `button/button.tsx` | 原 suite 已覆盖 native attributes/ref、非提交按钮、禁用、可访问名称及三种实际视觉变体；尺寸是组件公开输入，保留，无需重复堆叠点击例 | `button/button.spec.tsx` |
| `button/IconButton.tsx` | 只负责原生按钮语义与可选 pressed；原测试检验 ref/label/pressed，新增真实工具栏和 Viewer 组合保护 disabled、事件和焦点 | 上述 suite、`actionBar/behavior.spec.tsx`、`viewer/viewer.spec.tsx` |
| `button/EntryButton.tsx` | 可选平台图标与原生属性；原测试检验内容/回调，账户保存、冲突三选择和授权弹窗组合补充禁用与异步动作 | 上述 suite、shared 与 pages 审查表 |
| `trigger/trigger.tsx` | 状态由 owner 控制，阻止父级点击/提交；原 suite 已保护受控、不传 handler、disabled、分组，无新增机械复制 | `trigger/trigger.spec.tsx`；页面设置/筛选组合另验 |
| `searchInput/SearchInput.tsx` | 原 suite 已验证原始输入值、空白查询、ICU 单复数、locale 数字、submit 阻止；主站使用另一个搜索组件，不能用此 suite 代表主站已拦截提交 | `searchInput/SearchInput.spec.tsx`、`pages/search/search.spec.tsx` |
| `tabView/TabView.tsx` | 原 suite 的几何、字体/滚动变化、受控与清理有有效断言；绑定请求期间需要新增原生 disabled 语义，覆盖禁用→启用且仍由 owner 选中 | `tabView/TabView.spec.tsx`、`pages/locator/LocatorFlows.spec.tsx` |
| `shortcut/shortcut.tsx` | 原 suite 已保护 chip 顺序、重复标签、平台尺寸及缩放；它显示调用方传入的标签，不自行生成快捷键名称 | `shortcut/shortcut.spec.tsx` |
| `loading/Loading.tsx` | 原 suite 检查“完成过”但漏掉重复通知和完成计时器泄漏；补持续挂载时只完成一次、两个退出阶段卸载均不再回调 | `loading/Loading.spec.tsx` |
| `feed/Feed.tsx` | 原 suite 对滚动末端舍入、尺寸变化、重置键/children/ref 变更和清理均有有效断言；通知与个人中心使用真实 Feed 验证 owner 接线 | `feed/Feed.spec.tsx`、通知/贡献列表组合 |
| `carousel/Carousel.tsx` | 原 suite 已保护空/单张/未知 key、两端循环与受控回调；Viewer 组合补足图片、作者、投票状态、加载状态同步变化 | `carousel/Carousel.spec.tsx`、`viewer/viewer.spec.tsx` |
| `modal/modal.tsx` | 原 suite 主要保护 presence 与 swipe indicator，未保护关闭策略和焦点。新增按钮/遮罩/Escape callback 契约、IME、disabled tabs、quick action、跨文档 portal、焦点循环/恢复及退出中 scroll lock | `modal/modal.spec.tsx`、`modal/overlays.spec.tsx` |
| `viewer/viewer.tsx` | 原 Modal suite 只有等待 URL 进入；补完整图片轮播与元数据、坐标命中区域、权限/pending/recall-only、操作回调、单图、退出中重开 | `viewer/viewer.spec.tsx`、`modal/overlays.spec.tsx`、uploader 组合 |
| `popover/popover.tsx` | 原 suite 保护触摸/焦点、受控可见和清理；补合并 object/callback ref 与原事件、四向边界与 resize、真实 overflow text 接线、modal 中 tooltip 的 Escape 优先级 | `popover/popover.spec.tsx`、`popover/behavior.spec.tsx`、`modal/overlays.spec.tsx` |
| `popover/OverflowPopoverText.tsx` | 原 suite 把 Popover mock 掉，只证明字体区域重测；新增真实 Popover，超过 1px 才启用，恢复到适配宽度后撤下提示 | `popover/OverflowPopoverText.spec.tsx`、`popover/behavior.spec.tsx` |
| `contextMenu/ContextMenu.tsx` | 原 suite 已保护 basic clamp/native/fallback/退出，补 disabled/keep-open action、Home/End/四向循环、Tab/resize cleanup、native API 抛错与空菜单 | `contextMenu/ContextMenu.spec.ts`、modal 与地图菜单组合 |
| `actionBar/ActionBar.tsx` | 原 suite 只保护生命周期泄漏，补 grouped/separate 按钮语义、disabled/pressed、阻止卡片点击、floating 保留编辑器焦点、hover/touch/重开与 modal 争用 | `actionBar/ActionBar.spec.tsx`、`actionBar/behavior.spec.tsx`、`modal/overlays.spec.tsx` |
| `drawer/drawer.tsx` | 原 suite 仅保护打开后搜索改变 collapsed height；补真实 use-gesture 触摸拖动、内容滚动/控件优先、snap 归一/循环/进度、disabled、rem 与 snap 重定位 | `drawer/drawer.spec.tsx`、移动 sidebar 组合 |
| `banner/banner.tsx` | 原 suite 保护用户关闭中重开；新增 prop-driven 退出保留旧内容、不冒充用户关闭通知以及重开新内容 | `banner/banner.spec.tsx`、定位/Domain 组合 |
| `effects/AdaptiveLinearBlur.tsx` | 原 suite 已保护双边 mask、normal 切换、动画结束后去 mask；实际 caller 的尺寸、滚动边界由 Feed/搜索/Modal suite 提供。真正合成/视觉仍需浏览器 | `effects/AdaptiveLinearBlur.spec.ts`、上述组合 |

选择 hook 由 `selection/selection.spec.tsx` 组合真实 scoped engine 与 visibility：初始集合反转、隐藏项排除、交互控件禁止起拖、阈值/非主键/不同 pointer、释放时提交最后一批、取消/卸载释放 capture 与恢复文本/滚动策略、淡出及第二次手势读取 owner 新值。既有 `useSelectionVisibility.spec.ts` 保留退出被打断的专项边界。

2026-10-27 复核：完整检查暴露 Drawer 的 disabled 用例把 `data-snap=0` 当成动画已经完成，但该属性在距目标 0.5px 内即可更新，本次实际尺寸仍为 `0.0809740594285131px`。修正为先等待真实 Motion 尺寸精确到 `300px`/`0px`，再执行后续循环和禁用点击；保留原属性、回调与精确尺寸断言，没有改生产动画或放宽精度。此例只纠正测试准备条件，不说明真实浏览器动画、手势中断或所有禁用时序已验收。整体验收仍未完成，缺口见 [TESTS](TESTS.md) 开头。

## 主站与跨组件契约

| TEST-ID | 来源与输入/可观察结果 | 层级与目的 | 证据 |
| --- | --- | --- | --- |
| TEST-OVERLAY-001 | Modal→tooltip→Viewer/menu：Escape 只关闭顶层、子层退出后焦点回到触发点、底层仍锁滚动；portal 换文档后监听/锁迁移 | integration；critical path | `modal/overlays.spec.tsx`；低层 `lib/dom/overlay.spec.ts` 和 `useOverlayLayer.spec.tsx` 保留 |
| TEST-SEARCH-001 | 用户确认 Enter 不提交/刷新；真实 Orama+真实 marker/region store+desktop/mobile owner 的查询、分组筛选、唯一点导航、档案摘要、CJK/绑定组、区域计数和 scroll mask | integration；critical path, regression protection | `pages/search/search.spec.tsx` |
| TEST-SEARCH-STALE-001 | 请求未完成时清空/改变查询，旧结果在新防抖窗口到达，不能显示或覆盖当前查询 | integration；regression protection | 同 suite 两条可控响应回归 |
| TEST-SEARCH-FALLBACK-001 | 搜索索引请求失败后加载 Wuling 本地点，定位必须仍属于 Wuling；fallback 点位加载临时失败后自动恢复，关闭后停止 | integration；regression protection | 同 suite；复用 `services/routing/protocol.ts` 的区域映射 |
| TEST-LOADING-001 | 100% 后仍挂载也只通知一次，完成暂停/动画期间卸载都取消所有后续通知 | unit；regression protection | `loading/Loading.spec.tsx` |
| TEST-APP-SHELL-001 | 真实 Leaflet 的侧栏切换补偿、宽视图/移动不补偿、区域切换恢复 bounds；UI 隐藏不卸载地图、引导准备通知、局部地图错误不毁侧栏、全局 Safari 手势与清理 | integration；critical path | `pages/MapPage.spec.tsx`；UIOverlay/Map 内部由 pages 审查表列出的独立组合验证 |
| TEST-APP-STARTUP-001 | 正确 region 先启动资源，导航/两步字体 gate 前不 mount；共享点只预加载已解析视图；可降级错误后继续 | integration；rule protection | `src/main.spec.tsx`；真实 catalog 恢复另见 `locale/startup.spec.ts` |
| TEST-IMPORT-RETRY-001 | 用户要求已有动态入口对齐：需要时加载，间隔 800ms 持续重试，关闭/卸载忽略旧结果且取消计时器，成功复用；启动只重试读取，不重放字体/提交 | unit/integration；critical path | `lib/async/retryLoad.spec.ts`、`lib/dom/useRetryImport.spec.tsx` 与三个 locale startup suites；旧单次重试 helper 已删除 |

`src/LazyApp.tsx` 是未启用的旧入口（`main.tsx` 的引用与渲染都已注释），不制造它是线上启动路径的断言；它依赖的 Loading 完成序列已有回归。`MapPage` 的自动新手引导和常驻 AccountCard 是既有自动行为，未改成需要额外点击；个人中心语言 chooser 仍只有点击后下载。静态导入弹窗没有独立 chunk 加载步骤，不为本次行为测试重新拆包。

## 修复前证据

- Loading：旧代码在 state updater 中每 tick 排入完成 timer。卸载后两种延迟分别仍调用 3 次和 16 次；新增回归失败后，改为 effect 独占一个序列并清理，保留原 30+300ms 暂停和 450ms 动画时间。
- 搜索 Enter：真实 submit 的 `defaultPrevented` 为 false；用户明确确认后加表单拦截。
- 旧查询：查询变成空串/另一查询后，旧响应仍产生 2 个按钮；cleanup 在防抖开始时即使旧 token 失效。
- fallback 区域：真实导航参数收到 `regionKey: Valley_4, subregionKey: WL_A`；改复用区域映射并静默跳过没有区域的点位。
- fallback 加载：注入一次点位分片拒绝，旧实现出现未处理拒绝并持续 loading；重试后恢复真实结果，且取消可停止重试。

## Fixture 和证据限制

`talos/test-support/browser.ts` 提供可恢复的 ResizeObserver、Popover API 状态、显式布局/滚动尺寸和 PointerEvent/capture；`test-support/search.ts` 使用真实索引 tuple 形状，包括分组、唯一点、CJK、档案与坏行。真实 Orama、store、ICU、资源 URL 工具及 React 组件不做替身。服务/字体注册/无法在 jsdom 实现的浏览器 API 才替换。

jsdom 的 `touchAction` 只是 expando：赋值后 cssText 仍为空，`removeProperty('touch-action')` 不会清掉 expando。因此抽屉清理用 capture、handle 状态与 overscroll 策略验证，不从这个假 CSS 实现推断浏览器手势。Popover fixture 在断开 DOM 后视为离开 top layer；图标中的 SVG style 文本不算可见按钮计数。动画 snap 允许进入半像素范围后先报告 data-snap，测试等待真实最终尺寸再验最终进度。

以上不证明原生 top layer 绘制、真实设备触摸/合成、网络部署或性能指标；没有运行性能基线，也没有使用覆盖率百分比替代行为核对。最终标准检查的命令与结果集中记录在 [TESTS.md](TESTS.md)。
