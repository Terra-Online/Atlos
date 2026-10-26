# 独立 app 行为基线核对

本次范围：`talos/apps/intel/src`、`talos/apps/user-hub/src` 的全部 **20 个生产 TSX 文件**，以及它们直接使用的 collection、同步、路由、读缓存、分页和 locale 逻辑。逐个阅读实现后审查已有断言，再补有实际失败边界的用例。组件文件存在或测试通过均不等于浏览器端到端验证。

## 执行边界

- `pnpm test` 的 Intel、user-hub 分组发现 `.spec.ts` 和 `.spec.tsx`；Intel UI 用 jsdom，`data/importContract.spec.ts` 显式保留 Node 环境，以真实 Blob/Web Streams/gzip 验证协议。
- 组件测试使用真实分类、卡片、集合 store、框选引擎、Modal、冲突弹窗、贡献列表与分页 hook；布局尺寸、观察器、网络/认证服务为显式 fixture。
- Intel App 组合测试隔离共享站点外壳、顶栏与云同步 host；这些表面由各自组件/同步测试负责，未声称其组合测试验证了完整站点外壳或线上认证服务。
- Header 测试验证独立 app 的 locale prepare/commit/font 回调接线；语言 chooser 自身由共享组件基线负责。
- 未运行真实性能基准、真实 CDN/认证/云存储、真实移动设备和浏览器原生 top layer/手势验证。

## 逐文件核对

以下文件路径相对于各 app 的 `src/`；证据列的 spec 也相对同一目录。

### Intel（10 个 TSX）

| 组件文件 | 设计意图与边界 | 可执行证据 |
| --- | --- | --- |
| `App.tsx` | 分类与去标签标题搜索取交集；收集状态实时变化但本次打开时的分桶位置保持；移动搜索只在空→非空时升起抽屉；导入未完成前不显示错误快照，成功后重算未完成分类；错误回退本地状态，保留其它 URL 参数及 debug 模式 | `App.spec.tsx`；导入字节协议另见 `data/importContract.spec.ts` |
| `main.tsx` | 缺 root 明确报错；两个 catalog 与四个布局字体准备好才挂载，字体失败不阻断 | `main.spec.tsx`；真实字体加载时间不在此证据内 |
| `components/categoryFilter/categoryFilter.tsx` | 受控选中；点击、Enter、Space 请求切换；按键取消默认激活避免重复；完成状态随计数变 | `components/controls.spec.tsx` |
| `components/archiveSummary/archiveSummary.tsx` | 先显示本地总数；版本失败不阻断；manifest 同源验证；版本必须带 gameBuild；卸载中止请求 | `components/controls.spec.tsx` |
| `components/intelSidebarBrand/intelSidebarBrand.tsx` | 品牌图语义、不可拖动；没有独立状态机，不重复为每个 CSS 类建测试 | `components/controls.spec.tsx` |
| `components/intelHeadBar/intelHeadBar.tsx` | 保留现有静态语言组件，不借行为基线拆包；theme 生命周期；点击控制弹窗；语言切换连接 Intel 自有 catalog 与字体区域 | `components/intelHeadBar/intelHeadBar.spec.tsx` |
| `components/intelCard/intelCard.tsx` | 受控收集；嵌套地图链接不触发收集；键盘只响应卡片本身；map/mission/shop/auto/invstgt 获取说明及特殊 NPC/交互；可见性触发预览下载；目标高亮移除 | `components/intelCard/intelCard.spec.tsx` |
| `components/intelCard/virtualIntelCard.tsx` | 离屏保留测量高度与 archive identity；观察器跟随替换节点重绑；回到视口恢复内容；展开动画期间保留完整卡片；缺观察器回退完整内容 | `components/intelCard/intelCard.spec.tsx` |
| `components/boxSelection/boxSelection.tsx` | 初始集合上按交集反转；最终指针释放时提交待更新集合，释放捕获和 body user-select，再淡出选框 | `components/controls.spec.tsx`；底层引擎由共享组件基线负责 |
| `state/ArchiveProgressSyncHost.tsx` | 匿名/离线不发起同步；非地图档案与地图点隔离；去抖增量同步；冲突 A/B/合并保留未知本地档案；失败重放相同幂等键，再补后续编辑；manifest 回补；409 已确认状态不误弹冲突；旧账户响应不污染新账户 | `state/ArchiveProgressSyncHost.spec.tsx` |

`state/collection.spec.ts` 另外保护 App→共享 `useUserRecordStore` 的跨边界契约：地图档案写点位 ID，其它档案写 archive ID；范围更新保留其它点/档案；无变化不写时间或广播；storage/BroadcastChannel 重新读取和卸载清理。

### User hub（10 个 TSX）

| 组件文件 | 设计意图与边界 | 可执行证据 |
| --- | --- | --- |
| `App.tsx` | 缺省 content 路由和未知路由归一；两导航目的不同；overview 401 在原地认证；等待认证提交和弹窗关闭后重载；已恢复 session 反复 401 有自动重试上限；刷新失败展示且可恢复；贡献 401 同账号继续原 cursor、换账号重载私有数据；无 401 的账户边界立即清旧身份/列表并重新读取；同批 ABA 与过期成功/401 不能污染当前账户；cookie 已认证时由 overview 建立 owner | `App.spec.ts` |
| `main.tsx` | 缺 root 明确报错；catalog/字体准备完成后挂载；字体拒绝可降级 | `main.spec.tsx` |
| `components/authGate.tsx` | 等待 authReady 再自动打开一次；只有 session 存在、所有认证 UI 已关闭且不在提交时才能通知父组件；同 uid 避免无限循环；手动登录允许再次尝试 | `App.spec.ts`；共享 auth controller 自身的服务调用由共享 suite 负责 |
| `components/authLoader.tsx` | 条件加载登录模块；共享缓存/并发加载；未下载时 loading；卸载后的结果忽略；传输失败间隔重试，组件渲染异常保持局部恢复入口 | `components/behavior.spec.tsx`、原 `components/authEntry.spec.ts`、共享 `useRetryImport.spec.tsx` |
| `components/header/header.tsx` | theme 生命周期；忙碌时禁止刷新；语言 chooser 点击后才加载；等待弹窗可 Escape 关闭；成功后复用并提交 hub 自有 catalog | `components/header/header.spec.tsx`、共享 `useRetryImport.spec.tsx` |
| `components/nav/nav.tsx` | 普通左键走本地 history；修改键点击保留浏览器导航语义；active 来自父组件 | `components/behavior.spec.tsx`、`App.spec.ts` |
| `components/idcard/idcard.tsx` | 只展示 overview 身份；头像在 app 内导航 profile；公共 card 和 scale/hover 保持原有交互 | `App.spec.ts` 点击真实 IDCard 头像；共享视觉布局不视为本 suite 的浏览器证据 |
| `components/profile/profile.tsx` | 头像即选即存；阻止并发；失败回滚；成功更新身份与卡片，不重载 UGC；发起前核对 props owner 与当前身份；旧账户/注销/卸载/ABA 后的保存不能覆盖当前身份 | `components/behavior.spec.tsx`、`App.spec.ts` |
| `components/content/content.tsx` | image/comment 页签切换；Feed 随 kind 复位；分页失败保留条目及同 cursor 重试；错误时暂停自动加载；近视口事件并发去重；401 交给 app 登录并保留原列表 | `App.spec.ts`、`components/content/content.spec.tsx`、`components/content/useContributions.spec.ts`；浏览器真实视口/滚动仍需另验 |
| `components/content/list.tsx` | 真实审核路径不凭空补步骤；时间只显示有依据的节点；评论/图像使用各自定位链接；预览失败回退且换 URL 后恢复；评论日期随当前语言 | `components/content/list.spec.ts` |

## 现有测试审核

| 现有资产 | 审核结果与本次补充 |
| --- | --- |
| Intel `data/importContract.spec.ts` | 原 6 个用例有真实 gzip 正常路径及冲突/格式拒绝，但缺少 token/解压上限、缺 API、重复 ID 和结构错误边界。本次补齐这些协议边界；没有用 Node mock 掩盖 Blob/jsdom 的差异。 |
| Hub `App.spec.ts` | 原 5 个测试覆盖导航、overview 401、头像即时保存；无法保护贡献 401 与 authReady/submitting/profileOpen 等状态门槛。本次新增真实 App→Content→hook 的 401 恢复及另一 uid 重新读取，校正 beforeEach 的 mockReset，避免残留单次响应跨用例泄漏。 |
| Hub `components/authEntry.spec.ts` | 已保护条件加载、并发去重、缓存复用；保留。Loader UI/卸载/失败另由组件用例补充。 |
| Hub `components/content/useContributions.spec.ts` | 原 4 例对取消后仍返回、分页失败保留/重试 cursor、首屏重试、并发与刷新过期结果均有有效结果断言。保留，401 改由 App 集成例验证，避免继续用 `isUnauthorized: false` 的 hook mock 声称覆盖认证。 |
| Hub `components/content/list.spec.ts` | 原审核路径和真实点位分享链接有价值；没有覆盖预览 onError 或动态 locale。本次新增，未删除审核节点断言。 |
| Hub `api/client.spec.ts` | 既有读缓存、TTL、uid 隔离、取消消费者而不取消共享请求、失败不缓存有明确契约。新增特殊 cursor 保真与真实 HttpRequestError 401 分类。 |
| Hub `locale/index.spec.ts` | 已覆盖与主站 catalog 隔离、语言别名、storage 不可用、新旧语言竞态、字体失败回退；无需再复制相同测试。 |

## 已确认的产品行为与缺陷回归

- `TEST-INTEL-SYNC-EPOCH-001`（integration，regression protection）：Intel archive host 原保护仅比较uid，卸载及同uid重登/ABA不能使旧请求失效。新增8条deferred回归修前全部失败：卸载后rehydrate/index仍发后续请求；新session被旧锁阻塞；过期manifest缺失响应又注册一次、late注册后继续重发；旧finally可动新锁；卸载write清除未确认mutation。现以uid、真实sessionVersion、挂载lifetime共同校验hydration/读取/注册/重试边界，以独立owner限制finally，新session可立即继续，卸载保留幂等mutation。该Host/spec的focused ESLint和`tsc --noEmit --project apps/intel`均退出0。
- `TEST-INTEL-SYNC-OWNER-001`（integration，rule protection）：用户明确确认非地图档案同样在切账号后本地/云端不同（包括任一边为空）先由冲突弹窗选择，禁止自动上传或覆盖。去掉空云端例外；新增“新云端空/本地空 × 本地/云端/合并”6条真实Host→Modal→store/API链路，确认选择前不写、所选数据正确、差分payload正确。原transport failure/409测试改为先建立相等可信baseline，再编辑触发失败，保留原幂等/补丁断言，避免以旧自动上传假设绕过新契约。最终`pnpm exec vitest run --config apps/intel/vitest.config.ts apps/intel/src/state/ArchiveProgressSyncHost.spec.tsx --reporter=dot`：1文件22例通过；Host/spec ESLint及Intel全量类型检查均退出0。
- `TEST-HUB-AUTH-001`（integration，critical path）：用户确认贡献列表 401 应留在个人中心登录并恢复列表。旧 hook 直接 `window.location.assign('/')`，因此丢失当前列表。现将认证请求交给 App，暂停自动翻页；同 uid 登录后重试原 cursor，另一 uid 则清空旧私有列表并重载 overview。证据：`App.spec.ts` 的两条恢复链路。
- `TEST-HUB-LOCALE-001`（integration，rule protection）：用户确认评论日期应跟随当前语言。旧 `list.tsx` 硬编码 `zh-CN`。改读 hub `useLocale()`；同一 DOM 节点从 en-US 更新到 de-DE 的结果与真实日期工具一致。
- `TEST-HUB-PROFILE-001`（integration，regression protection）：旧头像保存可在账户切换后把 AuthStore 改回旧账户。修复前单独运行 `behavior.spec.tsx -t 'previous account'` 退出 1，`expected 'u2', received 'u1'`。以请求 generation、身份版本及卸载失效限制旧响应；同一用例修复后通过，并保护 logout/unmount。
- `TEST-HUB-OWNER-001`（integration，regression protection）：交叉评审发现仅保护响应仍不足：App 不监听 uid 边界，会保留 A 的 overview/Profile；store 已是 B 时点击旧 Profile 会用 A.nickname 修改当前 B cookie 的资料。修复前 focused 执行 `App.spec.ts` 与 `components/behavior.spec.tsx` 的 `without a 401|same-batch|cookie-authenticated|props belong` 四例全失败，分别显示旧身份/私有图片未清除、旧请求未 abort、无缓存身份未建立、错误昵称已发出。现由 App 同步订阅 uid 边界并递增 epoch，捕获同批 ABA，取消旧请求并销毁旧私有页面；过期 resolve/reject 都忽略；权威 overview 仅在身份未知或不同才建立 store owner。贡献 401 明确保留隐藏的原列表并让同 uid 续 cursor，另一 uid 则销毁列表重读。Profile 在请求发起前与返回时均校验 owner，测试特意在身份已变化、旧 DOM 尚未重绘时点击，避免仅靠 disabled 掩盖缺陷。原头像即存不重载 UGC、同账号 401 续页测试保持通过。

App 测试的认证控制器已改读真实 `useAuthStore` selector。旧 mock 的独立 `auth.sessionUser` 不受 `clearSessionUser()` 影响，曾制造实际不存在的自动恢复；现在“恢复 session”必须在测试中执行真实 store 动作，再验证自动尝试上限和显式登录恢复，没有放宽 401 或分页断言。
- `TEST-IMPORT-RETRY-001`（unit/integration，critical path）：用户确认已有动态加载应持续尝试到成功、入口按意图激活，并要求主站和 app 对齐；本次不把原静态组件改成动态拆包。公共 `retryLoad` 是唯一的重试/延迟/取消循环，`useRetryImport` 提供 React owner 生命周期；失败间隔 800ms，关闭/卸载取消并忽略过期结果，成功 payload 复用。hub 原动态语言 chooser 与 AuthLoader 使用此 hook，组件 render 异常仍由局部边界处理。共享 hook 7 例覆盖反复失败/取消/旧响应/同步 throw，Header 模块计数证明没有默认加载、等待期可关闭及重开复用。Intel 和主站的语言组件保留静态设计。
- `TEST-STARTUP-LOCALE-001`（unit/integration，critical path）：主站与两 app 的 `i18nInitPromise` 原先一旦 catalog 加载失败即永久 rejected，后续本地缓存即使已清失败项也不会使启动恢复。现在只对初始 catalog dataPromise 使用公共 `retryLoad`，字体准备及成功提交维持单次，不重跑整个 bootstrap。三个 `locale/startup.spec.ts` 在 loader 调度边界注入两次失败后运行真实 catalog 导入，验证启动 gate 恢复、字体只调一次、catalog 非空且每次错误均有诊断。该证据不声称真实 CDN 故障注入或后端稳定性。

## 验证记录

- `pnpm exec vitest run --config apps/intel/vitest.config.ts --reporter=dot`：最终 9 文件、44 用例通过，退出 0。
- `pnpm exec vitest run --config apps/user-hub/vitest.config.ts --reporter=dot`：最终 11 文件、56 用例通过，退出 0。
- `pnpm exec vitest run src/lib/async/retryLoad.spec.ts src/lib/dom/useRetryImport.spec.tsx src/locale/startup.spec.ts --reporter=dot`：3 文件、12 用例通过，退出 0。
- 针对两个 app、公共 retry primitive/hook、主 locale 的 ESLint：退出 0（完整命令由最终集成记录）。
- app 全量类型检查与仓库总体检查由集成者集中执行；这里不把尚未完成的检查记录为通过。

## 未验证或待决边界

- 原生 IntersectionObserver、布局/字体重排、虚拟卡片真实视口尺寸、跨 tab 实际广播和移动触摸链路仍需浏览器证据。fixtures 保护确定的状态契约，不能推导性能或渲染正确性。
- catalog 连续失败会保持启动 gate 等待并按间隔重试，console 诊断不会静默；没有重放已成功的字体/提交，也没有额外创建整页错误/重试流程。真实离线设备的加载表现仍需浏览器验证。
