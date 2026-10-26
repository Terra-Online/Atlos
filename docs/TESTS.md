# 行为基线与测试入口

本轮对应本地 `docs/roadmap.md` 的阶段 2，先完成行为基线。该计划由仓库明确忽略，继续保留本地；可提交的行为与验证记录以本索引为入口。范围包含主站 `component/`、`pages/` 全部生产 TSX、两个独立 app 的组件与启动行为；地图渲染内核的既有专项测试保留，不修改其渲染实现。

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

## 保留的验证边界

- jsdom 的布局、IntersectionObserver/ResizeObserver、native Popover、pointer capture 与 FontFace 是显式 fixture；这些测试不证明真实浏览器 top layer、视觉/字体重排、触控合成或浏览器默认表单导航。
- 服务替身覆盖失败、取消、竞态和载荷契约，不代表 Bayes/OEM-SDK 等服务端、线上认证/CDN、真实跨标签页传输或真实设备已验收。
- 性能基线尚未执行：包体、首屏、Profiler、真实设备耗时不能从这些行为测试推导。后续性能工作须另存同环境、同输入的前后数据。

新需求、测试入口变更或新回归出现时，更新对应领域核对表及 TEST-ID；不再复制每个测试函数到本索引。
