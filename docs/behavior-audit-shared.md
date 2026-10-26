# 共享界面行为基线核对

范围：`talos/src/component/shared/` 的全部 17 个 TSX 文件，以及它们直接使用的账户控制器、进度同步 store。依据是本次源代码、调用方和已有 spec 的逐项阅读。表中的“覆盖”仅指所列代表行为有可执行证据，不代表所有可能输入或真实浏览器表现均已证明。整体范围与最终检查结果见 [TESTS](TESTS.md)；阶段计划保留在本地忽略的 `docs/roadmap.md`。

## 执行方式与边界

- 默认入口：`cd talos && pnpm test`。下列 spec 均被主站 Vitest 配置发现，不需要手动白名单。
- 本工作单元：`pnpm exec vitest run src/component/shared src/store/progressSync.spec.ts --reporter=dot`。
- 真实执行：React、Modal、按钮、卡片、冲突对比、Zustand 状态更新、格式化、英文发布目录；语言事务测试额外使用真实 locale store 和动态目录。
- 模拟边界：服务 API、字体字节/FontFace、设备状态、浏览器布局和 observer。`testFixtures.ts` 复用发布目录文本；`test-support/browser.ts` 提供显式 ResizeObserver/Popover/PointerCapture/几何输入。无线上账户、真实官方服务、PiP 原生窗口、GPU/玻璃视觉或性能结论。
- API 拒绝、旧响应、损坏偏好均是故障注入，不能据此声称线上已发生同一故障。

## 逐组件核对表

表中路径均相对 `talos/src/component/shared/`；测试路径无前缀时也相对该目录。

| 文件 | 设计意图与原有覆盖审查 | 当前可执行行为证据 | 仍需区分的边界 |
| --- | --- | --- | --- |
| `ErrorBoundary.tsx` | 原来无 spec；隔离单个子树、记录错误，owner key 改变时重试 | `ErrorBoundary.spec.tsx`：相邻地图工具仍可用、fallback/onError、相同值的新 key 数组不误重试、NaN 与 key 数量变化 | 事件处理器/异步 API 失败不属于 React 渲染边界 |
| `account/access/access.tsx` | 原来仅 controller spec，未覆盖表单 DOM 与两级键盘 handler | `account/access/access.spec.tsx`：首次/延迟校验、合法/非法邮箱密码、IME Enter、一次提交、自动提交去重、注册 OTP 格式/冷却成功失败、reset link 与带 token 阶段、OAuth选择/忙态、关闭取消定时提交 | 真实浏览器密码管理器及 OAuth 重定向由外部环境决定 |
| `account/idcard.tsx` | 原来 controller 能验证入口状态，但无法证明实际卡片接入了相同入口 | `account/idcard.spec.tsx`：真实卡片→Access 注册与dismiss事件；已登录头像→Profile，原页面路径保持；编辑名称经过真实 controller 清洗并保存，主卡同步更新 | Profile 内头像 `/me/` 导航代码已核对；jsdom 不实现原生 Location 导航，独立 app 路由另有 app 基线 |
| `account/idcardView.tsx` | 原来无直接 spec；只展示传入模型并报告用户操作 | `account/idcardView.spec.tsx`：身份字段、ref、头像序号/点击；隐藏年龄/karma；嵌入受控名称、长度、autocomplete约束 | 字体字形、CSS头像图像与倾斜光效不由 DOM 模型证明 |
| `account/profile/profile.tsx` | 原来仅同步服务/controller测试；未覆盖按钮状态、官方导入与退出后的冲突接力 | `account/profile/profile.spec.tsx`：编辑/保存/退出、移动全屏、忙态、真实store同步状态与legacy、selector隔离；绑定接力、待返回去重、相同进度直接导入、真实冲突弹窗等退出后显示并完成三种选择；真正API失败提示/手动重试，unresolved数据静默 | 后台同步 host 在此 spec 隔离，真实 host→conflict 路径由 `sync/progress.integration.spec.tsx` 覆盖 |
| `comments/CommentContent.tsx` | `comments/emoji.spec.ts` 已覆盖常见格式/emoji/不安全链接；`pages/detail/comment/spoiler.spec.tsx` 已覆盖多行、键盘揭示、内容更换、编辑器嵌套，保留 | 扩展 `comments/emoji.spec.ts`：每例清理、真实 DOM HTML不执行、链接安全属性、多个spoiler独立、隐藏链接首次点击仅揭示，揭示后不吞激活 | 复杂编辑输入/IME由页面编辑器专项测试管理，不在此重复堆叠 |
| `language/language.tsx` | 原来 locale纯函数/font专项不能证明选择器与 app 目录的事务配合 | `language/language.spec.tsx`：全部支持语言radio、预热不提交；真实locale store 中较新选择胜出，app目录与主目录一起提交；失败保持旧语言并允许重试；optional预热失败、更新后的app回调 | 实际FontFace加载/闪烁、app各语言目录一致性另有font/i18n专项 |
| `siteShell/sideBar.frame.tsx` | 原来主站SideBar有少量外层验证，共享app frame未覆盖 | `siteShell/sideBar.frame.spec.tsx`：真实桌面开合与store、content ref/工具、隐藏inert、宽度拖动预览→释放提交与上限、锁定app宽度；pointercancel/lostpointercapture/卸载恢复宽度并释放捕获，取消后可重新拖动；真实移动Drawer命令→手柄循环回写store；Footer→Support真实弹窗与社交链接 | 根任务另统一懒加载重试；真实窗口缩放/触摸需浏览器验证 |
| `siteShell/headBar/headBar.tsx` | 原 `headBar.spec.tsx` 仅移动/隐藏tooltip锚点；未覆盖真实响应式分支 | 保留原测试；`headBar.behavior.spec.tsx`：桌面/移动compact仅保留显示UI入口，disabled/active/badge，按真实uiPrefs切换渲染分支 | 主站UI隐藏链路由 MapPage/UIOverlay 基线负责 |
| `siteShell/headBar/headBar.desktop.tsx` | 桌面玻璃与性能模式fallback必须保持同一操作可达 | `headBar.behavior.spec.tsx` 同一操作在两个分支保留、禁用阻止执行 | LiquidGlass渲染作为外部视觉组件fake，不证明GPU效果 |
| `siteShell/headBar/headBar.desktop.fallback.tsx` | 无独立状态，承接桌面操作和compact布局 | 同上，真实fallback组件参与 | CSS布局在DOM环境仅验证结构/可达属性 |
| `siteShell/headBar/headBar.mobile.tsx` | 自身展开、强制展开、compact、外点收起；性能分支与fallback一致 | 参数化 `headBar.behavior.spec.tsx`：展开、内部点不收起、外部touch收起、强制状态禁用toggle、卸载监听释放 | 原生多点触摸事件顺序不由jsdom证明 |
| `siteShell/headBar/headBar.mobile.fallback.tsx` | 上述交互在性能模式中保持 | 同一参数化场景执行真实fallback | 样式无视觉快照结论 |
| `support/support.tsx` | 原来无spec；内容按目录渲染，支持目的地由按钮选择 | `support/support.spec.tsx`：真实Modal/按钮、三目的地的 `_blank`+noopener/noreferrer、关闭委托；footer集成验证进入/退出 | 发布目录中既有说明文本未作产品改写 |
| `support/SupportAutoPopup.tsx` | 主站MapPage当前注释停用；保留组件的版本化偏好/引导延迟合同仍需可靠 | `support/support.spec.tsx`：guide期间等待、取消/重启延迟、关闭保存版本、重挂载不重复、坏JSON及合法错误形状恢复、卸载清理 | 不因此重新启用主站自动支持弹窗 |
| `sync/ProgressSyncHost.tsx` | 原12例专注legacy acknowledgement、patch/409/manifest、竞态；断言有效保留，缺会话/卸载和真实冲突按钮链路 | 原spec扩展：未登录不请求、启动响应晚于注销/卸载不落地、同uid重登及A→B→A、旧manifest重注册不能继续发请求、旧finally不能解新请求锁、卸载write留待幂等重放、离线恢复、dirty卸载清理；跨账号不同数据与无owner旧baseline必须冲突、同账号已验证baseline可接收更新。`sync/progress.integration.spec.tsx` 真实host/store/Modal执行本地/云端/合并，确认legacy保留、owner和patch | 真实服务幂等与账号cookie由API/服务测试负责；未模拟任何线上写入 |
| `sync/conflict.tsx` | 原来仅 host mock；统计、point/archive namespace和交互没有UI证据 | `sync/conflict.spec.tsx`：纯档案不加载地图、相同ID不同namespace分别计数、空来源、caller受控choice；地图异步分区统计，仅成功后展示明细；失败持续重试，关闭/卸载停止，重新打开再试。profile/host集成执行三种选择 | 点位/类型不齐属于允许静默的数据缺口，成功空数据仍是有效数据；未将“未加载”显示为0或当作正常完成 |

## 缺陷到回归证据

| TEST-ID | 触发与修前证据 | 当前修复与保护 |
| --- | --- | --- |
| TEST-AUTH-ENTER-001 | 输入框Enter经input→form两级handler；新login/reset用例修前分别实际2次提交/请求 | form尊重`defaultPrevented`；一次Enter只提交一次，IME/自动提交去重继续有效 |
| TEST-AUTH-STALE-001 | 资料保存待返回时注销/切另一uid；两个用例修前均恢复旧uid | 复用现有sessionVersion，旧保存响应/错误不再改写新会话 |
| TEST-SUPPORT-STORAGE-001 | `support-prefs=null/{}/viewedVersions:4`在effect中抛TypeError；`[null]`污染版本数组 | 验证存储形状并过滤非字符串；坏偏好视为未看过，仍可正常关闭保存 |
| TEST-LANGUAGE-PREFETCH-001 | 空依赖warm callback保留旧app回调；更新props后新回调实际0次 | callback声明真实依赖；optional预热拒绝被处理，选择事务不变 |
| TEST-SYNC-STALE-001 | 启动fetch未返回时注销；修前旧响应建立冲突。dirty后unmount仍剩1个60秒timer | 启动await后检查uid；卸载清理dirty定时器，生命周期入口移除 |
| TEST-SYNC-EPOCH-001 | 交叉复核新增deferred回归：卸载后旧fetch仍建冲突；同uid重登/ABA被旧in-flight阻塞；旧missing-manifest失败又注册1次，四例修前失败 | uid+真实sessionVersion+挂载lifetime共同校验每个异步读取/注册/重试边界；锁归属独立请求，旧finally不能释放新锁或排新任务；卸载后未确认mutation保留供下次幂等重放 |
| TEST-SYNC-OWNER-001 | 账号A进度作为baseline，切账号B且云进度不同；修前本地p1被直接换成p2 | 按用户确认：不同账号或旧无owner基线不能授权自动覆盖，始终由冲突选择；baselineUid随基线持久化，旧v4迁移保留同步时间并弃无owner基线。`src/store/progressSync.spec.ts`另验证持久化/迁移 |
| TEST-SYNC-DISTRIBUTION-001 | 临时最小诊断使`loadAllMarkers`拒绝；Vitest报告1条Unhandled Rejection，exit1。实际是分区明细缺失，先前“显示0”的说法不准确 | 按用户确认：复用共享useRetryImport，未就绪显示Loading，持续重试直到成功，关闭停止；来源总数和选择始终基于已知ids |
| TEST-OFFICIAL-FAILURE-001 | 导入官方API拒绝后原实现只console.warn，按钮恢复却无用户反馈；验证未写入本地 | 按用户确认：复用sync.failed和现有错误区，手动重试成功清提示；正常unresolved计数不产生警告 |
| TEST-SIDEBAR-CANCEL-001 | 400px拖到450px后pointercancel/lostpointercapture/unmount，三例修前均保留450px预览 | 取消恢复原CSS宽度、保持store、释放pointer capture；完成释放先清owner，避免lostpointercapture误回滚；无需额外window级移动监听，卸载清理拥有的捕获和预览 |

以上为integration/regression protection；数据、网络或字体边界由fixture控制。新故障用例没有删除原断言、放宽期望、扩大mock吞错，也未更新快照。

## 验证记录

- 第一轮集中运行（尚未接入新的冲突加载策略）：`pnpm exec vitest run src/component/shared src/store/progressSync.spec.ts --reporter=dot`，15文件92例通过。
- 新的失败恢复/跨账号选择集中验证：`pnpm exec vitest run src/component/shared/account/profile/profile.spec.tsx src/component/shared/sync/conflict.spec.tsx src/component/shared/sync/progress.integration.spec.tsx --reporter=dot`，3文件18例通过。
- 新失败恢复和真实冲突集成完成后的集中运行：`pnpm exec vitest run src/component/shared src/store/progressSync.spec.ts --reporter=dot`，16文件97例通过，exit0。
- `pnpm exec eslint src/component/shared src/store/progressSync.ts src/store/progressSync.spec.ts --quiet`，最终exit0，无错误。
- 侧栏取消补齐后的必要增量：`pnpm exec vitest run src/component/shared/siteShell/sideBar.frame.spec.tsx --reporter=dot`，1文件8例通过；同两个文件的focused ESLint exit0。根任务负责随后全范围检查。
- 同步epoch交叉复核后的必要增量：`pnpm exec vitest run src/component/shared/sync/ProgressSyncHost.spec.ts src/component/shared/sync/progress.integration.spec.tsx src/component/shared/account/idcard.spec.tsx src/store/progressSync.spec.ts --reporter=dot`，4文件34例通过；Host及其spec的focused ESLint exit0。
- 主站`tsc --noEmit --project .`曾执行：本工作单元无类型错误；当时并行中的drawer/地图事件/pages fixture存在错误，已通知对应owner。不能将这次运行记为全站类型检查通过。
- 没有提交/推送。本地commit由主任务在全范围验证后统一组织；性能基线未开展。
