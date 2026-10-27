# 行为基线与测试入口

对应本地 `docs/roadmap.md` 阶段 2，范围包含主站 `component/`、`pages/` 全部生产 TSX、主站启动以及两个独立 app。地图渲染内核沿用既有专项测试。本轮没有执行性能基线。

## 当前状态：本轮自动化行为基线已收口

职责、功能、状态和证据已经逐文件复核并独立清点：**36 个共享组件、53 个 pages、Intel 10 个、user-hub 10 个，无路径遗漏**。这表示清单完整，不表示所有可能输入、时序和运行环境均能绝对保证。每行列明有效断言、传输/测量替身及原生边界，纯 wrapper、停用入口和不适用状态不制造重复测试。

| 范围 | 每个组件的职责、功能与覆盖清单 | 补充依据 |
| --- | --- | --- |
| `talos/src/component/` 全部36项 | [共享组件矩阵](behavior-components-matrix.md) | 基础控件/账户/浮层/站点壳/同步及非TSX交互hook |
| `talos/src/pages/` 全部53项 | [主站 pages 矩阵](behavior-pages-matrix.md) | 页面内部子组件、引导、评论/上传、定位、通知、虚拟列表与跨页owner |
| `talos/apps/` 两个 app 各10项 | [独立 app 矩阵](behavior-apps-matrix.md) | 启动/路由、贡献分页、档案导入与同步；附两个worker合同 |
| 跨组件状态 | [状态归属与副作用](behavior-state-map.md) | 17个Zustand owner、context、请求生命周期、历史屏障与持久化 |
| 实际浏览器/动画/布局 | [浏览器行为对照](behavior-browser-baseline.md) | 三种引擎、五个project、真实CSS/原生事件、HTTP隔离范围与可复跑fixture |
| 首轮源码与旧测试审查 | [controls](behavior-audit-controls.md)、[shared](behavior-audit-shared.md)、[pages](behavior-audit-pages.md)、[apps](behavior-audit-apps.md) | 历史发现及修前失败；当前覆盖范围以三矩阵和本索引为准 |

主站没有独立 `App.tsx`；`src/main.tsx` 装配 MapPage。`main.spec.tsx` 检查区域资源提前启动、导航与两层字体gate、分享点预加载及可降级失败；`MapPage.spec.tsx` 检查视野补偿、装配和错误隔离，浏览器用完整入口验证搜索/设置/引导。`src/LazyApp.tsx` 未启用、`pages/favPOI` 为空，不作为活跃用户路径验收，也未重新启用它们。

## 执行入口

在 `talos/` 执行：

| 命令 | 范围 |
| --- | --- |
| `pnpm check` | 数据校验、类型准备、主站/Intel/user-hub/两worker类型检查、ESLint/Stylelint、Node与全部Vitest suites |
| `pnpm test` / `pnpm type-check` / `pnpm lint` | 上述各独立入口，无生产服务写入 |
| `pnpm exec vitest run <路径>` | 主站/两worker精确suite；独立app需相应 `--config apps/<app>/vitest.config.ts` |
| `pnpm test:behavior` | 完整真实浏览器矩阵，独立于默认check，需已安装Playwright三个引擎；本机三站可自动启动 |
| `pnpm exec vitest run --coverage` | 可选V8覆盖报告，本轮不以百分比作为完成判据 |

新增测试一律 `.spec.*`。UI默认jsdom，Intel importContract显式Node环境保留真实Web Streams/gzip。`test-support/browser.ts`、`pages.ts`、`search.ts`是组件测试替身；`test-support/browser/`是实际浏览器fixture，二者不能混作证据。CI现有 `build.yml` 调用完整check后源码构建；本轮未运行生产构建、未推送、未触发远端CI或部署。

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
| TEST-AUTH-UI-OWNER-001 | 登录/注册可在请求中关闭，认证可后台完成；旧流程不得关闭重开面板、改新表单或弹旧资料设置 | 组件矩阵 |
| TEST-LOCATOR-STATUS-001 | 绑定状态失败保留已知值，未知时持续重试；关闭/切账号停止，401 登录；未查明不当作未绑定 | pages 矩阵 |
| TEST-GUIDE-PROGRESS-001 | 详细引导使用隔离演示状态，保留用户真实进度；清理后显示最新真实记录，旧加载不得影响新一轮引导 | pages、浏览器基线 |

## 真实回归与测试设计

重要修复均先用原始失败形状验证，再修改实现。包括重复 Enter/关闭通知、Loading 重复完成、搜索旧响应与 fallback 错区、拖动取消与卸载清理、账号/点位切换后的异步写回、同步基线归属、编辑失败草稿丢失。各核对表记录修复前结果与对应 TEST-ID；没有放宽断言、跳过用例或 bulk snapshot 更新来消除这些失败。

异步用可控 Promise 和实际 store/sessionVersion；浮层用真实 Modal/Viewer/Popover/ContextMenu/ActionBar 组合；分页、投票、回滚和冲突验证最终 UI/数据关系。仅“函数被调用”、mock 内字段或渲染成功不作为这些链路的完整证据。

## 本轮集中验证

2026-10-27，`refactor/standard`：`VITEST_MAX_FORKS=4 VITEST_MIN_FORKS=1 pnpm check` **退出0**。限制并发不缩小发现范围，未跳过用例。

| 实际范围 | 结果 |
| --- | --- |
| 数据校验 | overrides、Intel数据、各app/ICU目录、tile coverage、marker lookup全部通过 |
| 类型检查 | 主站、Intel、user-hub、oem-relink、oem-search全部通过 |
| lint | ESLint628文件：0 error、1既有warning；Stylelint92文件通过 |
| Node脚本 | 29例通过 |
| 主站及两worker | 160文件935例通过 |
| Intel | 9文件65例通过 |
| User hub | 11文件58例通过 |
| 合计 | **1087例通过**，不是本轮新增1087例 |

日志 `/tmp/atlos-behavior-closeout-check-complete.log`。此前check两次停在新增fixture的必填字段：binding.enabled、图像author.publicUid/createdAt；补完整真实接口后重跑通过，没有删断言或放宽类型。保留既有useFontRegion依赖warning、NotificationMessage key warning与Browserslist数据提示，未借本轮升级依赖或屏蔽提示。

冻结生产版本 `475d7441` 后，`pnpm test:behavior` **退出0，62/62通过**，零skip/flaky/retry；unknown HTTP/WS及未处理页面异常均为0。

| 实际project | 通过 |
| --- | --- |
| Chromium desktop / Firefox desktop / WebKit desktop | 各13例 |
| Chromium mobile | 13例（含3条可信touch拖动） |
| WebKit mobile | 10例 |

日志 `/tmp/atlos-browser-baseline-complete.log`；机器可读清单和11份原始截图/轨迹在 [已确认对照](baselines/2026-10-27-behavior/result.json)。[浏览器说明](behavior-browser-baseline.md)列出20条不同路径的输入/结果及环境边界；完整HTML/trace保留在本地ignored测试目录，可复跑。截图已人工查看主站详情、嵌套Viewer、Intel展开、移动引导与hub窄屏布局。

WebKit展开在本次自然帧中仍有221ms空档；此前诊断为208–277ms。行为过渡/最终几何通过，流畅性须进入性能基线，不将当前通过解释为性能合格。保存偏好恢复的迟到清栈修复也已纳入此check；新增真实store回归与history/同步3文件44例先通过，再运行完整入口。首轮979例与隔离引导后993例属于历史通过记录，本表1087为本轮当前完整入口结果。

## 保留的验证边界

- 组件/集成测试用显式几何、observer、pointer capture、FontFace及服务故障注入；真实浏览器组另保留CSS、Motion/WAAPI、Popover/inert、存储广播、布局和表单，不据jsdom属性推导原生表现。
- 原生浏览器范围为Playwright Chromium/Firefox/WebKit桌面与Chromium/WebKit移动模拟。物理设备、系统输入法/自动填充、原生Document PiP、真实定位/GPS/剪贴板权限以及完整视觉像素没有被这组有限路径全部验收。
- HTTP/WS/会话/云数据明确为fixture，未知请求及未处理页面异常会失败。本地验证不代表线上cookie、OAuth/邮件、服务端权限/幂等或CDN已通过；两个真实tab的传播测试也不等于并发跨tab事务合并。
- 性能基线未执行：包体、首屏、Profiler、掉帧、资源占用和真机耗时不能从本轮行为结果推导。

每次扩展/重构先定位矩阵中的契约与owner，运行受影响suite和对应浏览器路径；更新必要fixture/证据，解释真实行为差异。不得为追求通过而批量改快照、降低断言或用一个smoke代表整组件。
