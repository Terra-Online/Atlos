# 浏览器行为对照与复跑边界

本文件补充 [TESTS](TESTS.md) 与三份组件矩阵，记录原生浏览器证据。它不是性能基线，也不是线上服务或全部设备的验收证明。逐组件职责、输入输出、正常/空/错误/忙碌/禁用状态及异步边界分别见 [共享组件 36 项](behavior-components-matrix.md)、[主站 pages 53 项](behavior-pages-matrix.md)、[独立 app 20 项](behavior-apps-matrix.md)；[状态映射](behavior-state-map.md)解释跨组件读写关系。

## 固定环境与入口

在 `talos/` 执行 `pnpm test:behavior`。配置为 `playwright.config.mjs`，单 worker、零自动重跑；三站分别运行在本机 5173/5174/5175，主站 dev proxy 保留 `/intel/`、`/me/` 的同源装配。运行前使用与本次相同的本地数据/字体/切片，按原项目流程准备素材，再执行 `pnpm data prepare` 并安装 Playwright 的 Chromium、Firefox、WebKit。Vite 依赖扫描固定从 `index.html` 进入，避免扫描本地备份的 SEO 页面；浏览器 fixture 独立 HTML/TSX 不进入生产入口。

Playwright 固定为 1.62.1；本次安装的引擎为 Chromium 151.0.7922.34（revision 1234）、Firefox 153.0（1538）、WebKit 26.5（2336），Node 25.9.0。桌面视口 1440×1000；移动模拟 390×844、touch/isMobile，默认 en-US。WebKit 是 Playwright 引擎，不能等同于某台 iPhone 的 Safari。

浏览器测试使用真实 React 入口、当前生成数据、Orama、本地主要字体、CSS/Motion/WAAPI、滚动、ResizeObserver/IntersectionObserver、原生 Popover/inert、localStorage/BroadcastChannel 和表单。`fixtures.mjs` 对认证、贡献、同步、通知等 HTTP/WS 提供逐条明确的契约，远程图片使用固定 PNG，可选 Google fallback 字体不联网。未知请求及未处理页面异常使测试失败，所有测试均不写生产服务。第三方 OAuth、邮件、定位服务与真实云端幂等不由这里证明。

## 行为证据

| TEST-ID | 真实入口和保护结果 | 对照产物/边界 |
| --- | --- | --- |
| TEST-BROWSER-OVERLAY-001 | Modal→嵌套 Viewer→真实图片加载→键盘轮播；Escape 仅退出顶层；下层滚动锁保持；两级键盘入口焦点依次恢复 | 截图、完整 trace；焦点检查等待生命周期完成 |
| TEST-BROWSER-MOTION-001 | 弹窗进入的中间透明度/几何，退出时 inert，80ms 后反向重开保留同节点且不回调关闭；最终退出恰好一次回调 | 逐 rAF 的 opacity/transform/rect/state/inert JSON 与重开画面；先确认实际退出已发生，防止采样误把原 open 当新 open |
| TEST-BROWSER-POPOVER-001 | 真实 tooltip 在视口边缘定位；晚到字体改变尺寸后重新限制位置；鼠标右键菜单、跳过禁用项、动作/关闭；独立键盘入口精确恢复焦点 | 定位 JSON、trace；WebKit 的按钮鼠标默认失焦与键盘保留焦点分别验证 |
| TEST-BROWSER-LAYOUT-001 | 真实 ResizeObserver 在 TabView 改宽后保持指示器局部中心；Feed 实际滚动改变遮罩、reset 回顶 | 实际布局截图；不以 jsdom 几何替身代替布局 |
| TEST-BROWSER-ACTIONBAR-001 | 编辑器聚焦→浮动操作→保留输入焦点→Escape 释放原生浮层 | trace；受控选区由真实输入 focus 捕获，不持续传入伪造非空矩形 |
| TEST-BROWSER-DRAWER-001/002/003 | CDP 可信 touch：拖动中 disabled 释放触摸策略；新拖动打断旧 snap 后持指尺寸不漂移；反向越过起点后交还内容滚动并释放策略 | Chromium mobile；持指逐帧 JSON、实际可滚内容；不等同于系统惯性或真机多指 |
| TEST-BROWSER-MAIN-SEARCH-001 | 主站完整入口搜索→原生滚动定位后真实鼠标点击→筛选→点位详情，Enter 保留文档、查询、筛选和当前点 | 主站画面与 trace，使用实际搜索数据 |
| TEST-BROWSER-MAIN-SETTINGS-001 | 主站设置切主题、刷新恢复；语言弹窗实际切换目录与文档语言 | 主题/语言画面，实际主要字体；不测字体 CDN 可用性 |
| TEST-BROWSER-INTEL-MOTION-001 | 实际分类/查询与卡片收集；正向/反向变化保持到匹配的原生动画事件结束 | 动画时间线、状态与画面，不向页面手动派发 animationend |
| TEST-BROWSER-INTEL-LAYOUT-001 | 鼠标拖动侧栏改宽，展开详情的卡片高度存在中间帧；真实 IO 离屏占位与回滚恢复高度 | 高度帧/原生transition事件 JSON、虚拟占位/恢复截图；侧栏测量稳定后观察自然动画，返顶后连续2秒验证高度与挂载 |
| TEST-BROWSER-CROSS-TAB-001 | 两个真实同源 tab：主站完成地图档案→Intel 显示完成→Intel 取消→已打开主站 canonical 内存与磁盘同时取消 | 双 tab 画面、canonical 值 JSON；这是最终写入后的传播合同，不承诺并发不同 tab 写操作的无损事务合并 |
| TEST-BROWSER-HUB-001 | 完整 hub 评论页签、当前语言日期、路由/返回、头像 pending 禁用与成功更新 | 头像/贡献画面；HTTP 状态可控，未替换 auth/store/router UI |
| TEST-BROWSER-HUB-AUTH-001 | 贡献第二页 401→留 `/me/content`→实际 Access 表单登录→关闭成功反馈→保留第一页并从原 cursor 恢复 | trace/恢复画面；确切两次 cursor 请求；分页可由真实 IO 或显式 Load more 触发，不据此单独证明自动 sentinel 的全部边界 |
| TEST-BROWSER-MOBILE-{MAP,HEADBAR,INTEL,HUB}-001 | 窄屏主站抽屉搜索/详情与 Enter、头栏和语言弹窗、Intel tap 收集/刷新/取消、hub 导航和头像 | Chromium/WebKit 移动模拟；页面无横向溢出，HTTP 为 fixture |

`TEST-BROWSER-GUIDE-001` 使用真实Help/Joyride：桌面Next后39.3ms点击Skip、再开800ms逐帧无旧推进；实际定位/滚动与spotlight中间帧；走到boss的完成/清除，真实canonical/storage/point历史/fixture同步写入始终不变，退出恢复真实显示。移动范围为紧凑头栏展开、下一目标与关闭重开；移动演示批量本身由实际步骤接线的组件回归保护，不冒称移动全tour已走完。各project最终结果以 [TESTS](TESTS.md) 为准。

`userRecord.spec.ts`另复现保存偏好开启后迟到清history使恢复后新point无法undo；历史屏障改到onFinishHydration同步触发，恢复后的新命令保留并能undo回磁盘快照。

## 真实失败与纠正

- 跨 tab 原用例读到 `memory:true / persisted:false`：Intel 已取消、主站仍旧值。共享 observer 现在由主站/Intel 复用，读真实磁盘快照、保留合法局部载荷的缺省集合并去重通知；主站收到外部 point 变化后清撤销历史，archive-only 不清。订阅建立时另重读一次，补启动字体/地图等待期间漏收事件的窗口。`userRecord.spec.ts` 验证局部/损坏/旧数字 ID、无效通知、关闭/禁用保存与启动窗口。
- 移动 tooltip 在实际 390px 视口右缘达到 394.48px；固定 fixture 溢出后仍失败。源码只在窗口 resize/scroll 定位，无法跟随晚到字体。补充 tooltip/anchor ResizeObserver 和所属 fontregionchange，关闭断开观察；真实原失败转绿，组件回归在修前同样得到 1100>1020。
- Drawer 原生 touch 与组件回归验证旧 snap 继续覆盖新拖动、disabled 遗留锁；补查接管后反向交还内容滚动也曾遗留锁。释放策略与 snap 动画所有权已修复，未改变既有吸附阈值。
- 原生滚动/测量前提：WebKit自动scrollIntoView在CSS smooth容器中继续滚动，曾使真实pointer按旧坐标落下；显式瞬时揭示目标后仍保留真实鼠标点击。Intel侧栏拖动结束时字体/布局测量仍可能在进行，先验证可见卡片测量与12帧几何稳定，再记录自然展开；没有改中间帧1px断言。原生平滑滚动到达端点后，虚拟卡片还要连续2秒保持挂载/高度/scrollTop，而非采一次DOM。
- 两处测试前提纠正没有改产品实现：WebKit 鼠标默认让按钮失焦，overlay 按打开时的实际 activeElement 恢复，键盘激活精确恢复 opener；动画断言必须先观察退出，再等待重开，否则可能仍读到点击前的 open。

## 产物与复跑

每条用例保留 trace，关键路径 attach 截图、原生事件/动画帧与服务边界 JSON。本次运行报告在 `talos/test-results/behavior-report/html/index.html`，JSON 在同目录 `report.json`，trace 在 `talos/test-results/behavior/`；这些目录由 git 忽略，下一次运行会重建。可用 `pnpm exec playwright show-report test-results/behavior-report/html`，或 `pnpm exec playwright show-trace <trace.zip>` 检查。提交中保留 fixture、断言和此证据说明；冻结验收为62/62，零skip/flaky/retry；[永久结果清单](baselines/2026-10-27-behavior/result.json)关联生产commit、源码摘要、全部scenario以及11份原始对照（5PNG、6JSON，带sha256）。这些选取的画面/轨迹已提交；完整HTML/trace仍为本地ignored产物。

复跑时保持相同数据版本、语言/初始存储、viewport 与引擎，再比较状态关系和关键帧。截图是可审查对照，不使用批量更新像素快照来消除行为差异。

明确未宣称：所有操作系统/物理移动设备、系统输入法/密码管理器、Document PiP 原生窗口、真实定位/GPS/剪贴板权限、所有视觉像素、屏幕后台节流与并发多 tab 事务。帧耗时、掉帧、内存、包体和首屏时间仍属后续性能基线。各组件矩阵逐行保留其余原生/传输边界，不能用本表有限路径抹掉。

性能交接：WebKit自然展开记录曾出现208–277ms rAF空档；修正测量前置条件后的诊断样本仍有约246ms空档，冻结62例验收保存的WebKit样本为221ms，但有58→64→195px的实际中间高度及原生transitionrun/start/end。行为过渡/最终几何成立，不据此宣称动画流畅。此现象须在后续性能基线中复测、归因，不在本轮擅自进行性能重构。


## 2026-10-28 追加的真实布局合同

新增桌面 `TEST-BROWSER-HUB-CONTENT-001`（生产入口为 `TEST-PRODUCTION-HUB-CONTENT-001`），移动 `TEST-BROWSER-MOBILE-HUB-001` 从空列表扩充为20条图片占位卡。要求滚动视口容纳完整卡片，首/末卡可滚入视口和屏幕，Profile往返后仍可达；`toBeVisible()`不能替代祖先裁剪检查。原生产产物确定失败后修复了恢复wrapper高度链。当前开发矩阵因此由62增加到65个project实例，生产矩阵为20个；本段只说明发现范围，实际运行结果及仍保留的Firefox全列表滚动波动见 [PERFORMANCE](PERFORMANCE.md)。2026-10-27的62例结果仍是当时版本的历史证据。
