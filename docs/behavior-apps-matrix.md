# 独立 app：组件职责、功能与覆盖矩阵

范围为 Intel 和 user-hub 的全部 20 个生产 TSX，以及它们直接依赖的分页、导入、集合、同步和两个 worker 的入口契约。`main.tsx` 是启动边界而不是可交互控件，仍逐项列出。组件内的子视图在所属文件内展开说明，不通过文件数冒充功能数。

本表中的“自动化覆盖”指列出的输入/可观察结果已由相应 suite 验证；不表示每种 props 的笛卡尔积或真实浏览器均已验证。动画事件替身、几何尺寸和观察器 fixture 与真实动画应区分。完整入口的浏览器证据、环境和未测边界统一见 [TESTS](TESTS.md)，不能从本表的 jsdom 结果推导。

## Intel（路径相对 `talos/apps/intel/src/`）

| 组件 | 职责 | 功能、状态和副作用 | 自动化覆盖与证据 | 时序、动画与边界 |
| --- | --- | --- | --- | --- |
| `App.tsx` | 组装侧栏、顶栏、分类、搜索、收集分桶、导入、虚拟卡片和同步 host | 分类与规范化标题搜索取交集；正常/空结果；本次打开时的已收集/未收集分桶保持位置，数量随实时记录变化；内容/分类框选按起始集合反转；移动端搜索仅空→非空自动升抽屉；显示详情控制统一收放；URL type 定位且首次 hover 撤掉高亮；导入 pending 不展示错误快照，成功只应用列明档案、选择未完成分类，失败保留原记录；保留其它 URL 参数和 debug 路径 | `App.spec.tsx` 运行真实分类、搜索、卡片、共享记录及框选连接；覆盖筛选/空结果、稳定分桶/统计、移动搜索、导入成功/失败/取消、解码期间外部编辑、StrictMode；导入字节另见 `data/importContract.spec.ts` | 本轮补旧 import resolve/reject 在卸载后不得写真实记录或改新页面 URL；初始分桶按提交后的最新 store 派生。展开 350ms/折叠 950ms 的虚拟化准备、type 双 rAF 滚动有源码清理；完整外壳/顶栏/同步 host 在本 suite 中被替换，组合与真实几何/滚动须看浏览器记录 |
| `main.tsx` | 启动门槛和 React StrictMode 挂载 | 缺 `#root` 明确抛错；Intel/主站 catalog 和四个布局字体准备完毕才挂载；字体拒绝可降级；catalog 初始加载失败持续重试 | `main.spec.tsx` 验证未就绪不 mount、准备完成才 mount；`locale/startup.spec.ts` 在 loader 边界注入多次失败后导入真实 catalog，字体/提交只执行一次 | 真实字体请求、字形重排和启动画面不是字体 Promise fixture 的证明；StrictMode 下导入由 App 的实际组合例保护 |
| `components/categoryFilter/categoryFilter.tsx` | 受控分类选择入口与分类进度显示 | click/Enter/Space 请求 owner 切换，键盘取消默认激活避免二次调用；`active`/`aria-pressed` 随输入；`collected===total` 切完成标识；没有独立网络/持久化/异步任务 | `components/controls.spec.tsx`：点击/键盘、受控值、进度和完成；`App.spec.tsx`：分类影响实际卡片/计数 | 颜色/边框过渡需要实际 CSS；无独立 busy/失败/卸载写回，相关状态由 App 管理 |
| `components/archiveSummary/archiveSummary.tsx` | 本地档案总数与可选 SDK 版本提示 | 总数无需等待网络；stable channel→同源 manifest→gameVersion+gameBuild；跨源 manifest/HTTP失败/缺版本字段不显示误导版本；卸载 abort；计数始终保留 | `components/controls.spec.tsx`：立即总数、成功版本含 build、跨源拒绝、卸载 abort；Popover 行为由共享组件 suite 保护 | 版本信息是非阻断增强；服务器/真实字体、tooltip 定位及字体宽度需浏览器验证。此组件不会修改收集状态 |
| `components/intelSidebarBrand/intelSidebarBrand.tsx` | 品牌展示与替代文本 | app 资产引用、使用主站本地化 alt、图片禁拖动；无可交互状态/请求/计时器 | `components/controls.spec.tsx` 检查图像语义/禁拖动；作为 App 侧栏装配的一部分 | 不为每个样式类增加伪行为测试；视觉比例/主题由浏览器画面核对 |
| `components/intelHeadBar/intelHeadBar.tsx` | 主题与 Intel 独立语言 chooser 的入口 | theme init/cleanup、亮暗切换；点击打开/关闭语言 Modal；prepare/commit 使用 Intel 自有 catalog、预热目标字体；主站与 Intel catalog 保持各自职责；保留静态导入设计 | `components/intelHeadBar/intelHeadBar.spec.tsx`：主题生命周期、开关、Intel prepare/commit/font 接线；语言切换的忙碌/乱序等逻辑由共享 Language suite 保护 | suite 中 chooser 是回调边界替身；实际 Modal 聚焦、退出、字体宽度变化及与侧栏相处的表现看完整入口浏览器证据 |
| `components/intelCard/intelCard.tsx` | 单条档案的收集入口、获得方法、地图链接、预览、尺寸和动画 | 受控 collected/aria-pressed；click 与卡片本身 Enter/Space 请求 toggle；嵌套地图链接不触发卡片收集；map/mission/shop/auto/invstgt 文案、任务阶段/可选点位交互/特殊 NPC、商店地区；可见后才加载预览；type target hover 通知 owner；标题截断展开与批量尺寸测量；正向/反向进度条动画 | `components/intelCard/intelCard.spec.tsx`：各获取形状、HTML 标签清理、嵌套链接、受控收集、预览 observer 清理、目标 hover、反向动画跨无关渲染持续到进度条实际 end/cancel；App suite 覆盖卡片→真实记录 | 反向动画原依赖一次 render 的 previousCollectedRef，本轮修成显式动画生命周期，避免测量/布局重渲染提前撤掉属性。尺寸批量读写、标题双 rAF 和 observer 有清理；字形截断、长标题 hover、移动纵向/桌面横向动画与中途反转仍以真实浏览器结果为准 |
| `components/intelCard/virtualIntelCard.tsx` | 视口外内容替换为保高占位，保留 grid/身份 | 初始完整卡；离屏卸重内容但保留 archive identity/测量高度/z-index；进入邻近窗口恢复；完整卡与占位替换后重绑 observer；virtualize=false 立即回完整卡，动画期间由 App 禁用虚拟化；缺 IO 回退完整内容 | `components/intelCard/intelCard.spec.tsx`：显式几何与 IO fixture、两种节点重绑/恢复、尺寸保留、禁虚拟化、缺 IO、卸载解绑 | 观察器 callback 不是浏览器滚动证据；不能据 fixture 判断实际 rootMargin、列重排、滚动锚点或卡片动画期间的 viewport 稳定性 |
| `components/boxSelection/boxSelection.tsx` | 将共享框选引擎与 Intel 框选层装配 | 区域/项目/key/active 属性由 owner 输入；按初始集合反转交集并回传 keys；最终释放时 flush；选择中显示、退出 250ms 淡出，可被新选择打断；无网络或持久化写入，App 决定提交 | `components/controls.spec.tsx`：真实共享引擎/指针 fixture，初始集合反转、释放提交/capture/body 清理/淡出；基础引擎额外覆盖取消/不同 pointer/控件优先 | 拖拽命中、自动滚动、系统 pointercancel 与真实触摸应结合共享框选/浏览器记录；不是只断言 `onChange` 被调用 |
| `state/ArchiveProgressSyncHost.tsx` | 以账号/session/lifetime 为 owner 协调非地图档案云同步 | 匿名/离线不写；启动 hydration/index/manifest；新账号差异含一边为空须三选择；未知本地档案保留；去抖差分；pending 幂等重放和期间新编辑；manifest 缺失回补；409 已确认不误弹冲突；未确认 mutation 卸载仍保留 | `state/ArchiveProgressSyncHost.spec.tsx`：22 条 host→真实 Modal/store/服务边界测试，覆盖三选择×两空侧、差分、错误恢复/回补、同 uid 重登/ABA、旧 finally 不放新请求锁、旧 resolve/reject/卸载失效 | 与主站点位同步共用身份但数据集合隔离；服务替身可验证载荷/任务归属，不能证明实际后端、跨 tab 锁或真实网络幂等性。App suite 替换此 host，完整装配由浏览器组补证 |

## User hub（路径相对 `talos/apps/user-hub/src/`）

| 组件 | 职责 | 功能、状态和副作用 | 自动化覆盖与证据 | 时序、动画与边界 |
| --- | --- | --- | --- | --- |
| `App.tsx` | `/me/` 路由、账户概览、刷新、认证恢复与私有内容 owner | 根/未知路由归一 content；content/profile 两个导航目的；概览 loading/error/刷新；401 留本页打开认证，ready/提交/弹窗关闭门槛后重读；同 uid 自动尝试上限与显式重试；贡献 401 同账号续 cursor、异账号清私有页面；普通身份切换即时清旧身份/列表并 abort，批量 ABA 仍识别；无缓存身份时由权威 overview 建立 owner；头像更新不重新请求 UGC | `App.spec.ts`：真实 App/Content/IDCard/Profile/Feed/分页链，传输、共享 auth controller、部分 header 为边界；覆盖上述状态、导航、头像回滚、401恢复、无401身份切换、ABA与旧请求，以及同uid新身份提交后的旧overview成功/401；`api/client.spec.ts` 读缓存单独验证 | UID、owner epoch、AbortController 联合限制旧 overview。同uid已提交身份遇到pending overview时，失效旧请求并清缓存重读；已settled页面普通头像更新继续保留UGC，不强制刷新。仅beginSessionUpdate尚未提交身份不被误当已完成登录。真实cookie认证、完整共享Auth/UI、字体、导航和跨tab必须查看浏览器/服务边界记录 |
| `main.tsx` | app 独立启动与布局字体准备 | 缺 root 明确报错；hub/主站 catalog 和布局字体准备后挂载；可选字体失败继续；catalog 初始加载失败持续间隔重试 | `main.spec.tsx`、`locale/startup.spec.ts`：挂载 gate、字体拒绝降级、真实 catalog 重试且不重放字体/提交 | 不把 catalog 读取替身当真实离线/CDN 验收；页面实际首屏和字体稳定性由浏览器观察 |
| `components/authGate.tsx` | 把共享登录/Profile 控制器接到 hub 的认证恢复流程 | authReady 且无 session 时自动开一次；有 session 且所有 auth UI 已关、未提交、该 uid 尚未尝试时通知 owner；attemptedSession 由 App 持有跨 remount 防401循环；显式登录清尝试记录；Access/Profile 的忙碌/错误/关闭/保存交给共享组件/控制器 | `App.spec.ts`：原地认证、ready/submitting/modal 门槛、尝试上限、显式重试、同 uid续页/异uid重读；共享 auth controller 自身服务步骤由 shared suites 保护 | 不能把被替换的 controller 当线上登录结果；真实输入法、焦点、OAuth/验证码邮件和 cookie 服务另有边界 |
| `components/authLoader.tsx` | 条件下载认证 UI并限制加载/渲染失败影响 | module pending 显示 loading；并发共享和成功缓存；下载失败按共享 retryImport 持续重试，卸载后不呈现；渲染错误局部 alert+明确恢复入口，不把 render throw 当作传输无限重试 | `components/authEntry.spec.ts`、`components/behavior.spec.tsx`、共享 `useRetryImport.spec.tsx`：并发、缓存、卸载、失败间隔恢复、局部 render 失败入口 | 模块替身验证调度，不代表真实 bundle/CDN。此组件的 render boundary 只管 auth 子树，不能推导整个 App 任意异常均受保护 |
| `components/header/header.tsx` | hub 主题、刷新与独立语言入口 | theme init/cleanup；busy 禁用刷新；语言 chooser 只有点击才激活加载；pending 使用真实可关闭 Modal；关闭后到达不显示，重开复用；hub catalog prepare/commit 及字体预热与主站隔离 | `components/header/header.spec.tsx`：真实 HeadBar/Modal、受控延迟模块，未默认加载、busy/主题、Escape关闭、旧加载/重开/提交；catalog 字体竞态由 `locale/index.spec.ts` 保护 | chooser 内容在 Header suite 为回调边界；实际语言布局/字体切换及弹窗动画看浏览器结果 |
| `components/nav/nav.tsx` | 提供 contributions/profile 路由入口与当前项语义 | 普通左键阻止默认并走 app history；中/右键与Ctrl/Meta/Alt/Shift保留原生导航；active只由输入决定；没有网络/计时器/存储副作用 | `components/behavior.spec.tsx`：普通/修饰键、active受控；`App.spec.ts`：实际路径、未知路径归一、popstate监听与两目的区分 | jsdom 可验证preventDefault和href/状态，浏览器修饰键开新页与返回栈的原生行为须浏览器证据 |
| `components/idcard/idcard.tsx` | 用概览身份展示卡片并提供 hub 内个人资料入口 | 使用共享 profile view model、头像规范化、卡片缩放/hover；头像转 hub profile；不自行登录或写账户，不混淆主站“先面板再个人中心”契约 | `App.spec.ts` 点击真实 IDCard 到 profile；共享 idcard/scale/hover suites 覆盖数据/清理/几何 | 卡片实际透视、缩放、字形和容器尺寸依赖共享浏览器几何，不能仅凭此文件的组合点击称视觉已验收 |
| `components/profile/profile.tsx` | 当前账号头像即选即存 | 合法头像范围/归一；控件pending禁用、只发一个请求；失败恢复props头像并显示错误，可重试；成功更新auth owner及父overview，不重读UGC；发请求前检查props uid和当前store，返回核对uid/sessionVersion/generation；换用户/注销/卸载/ABA拒绝旧保存 | `components/behavior.spec.tsx`：并发、失败/成功、发起前不同owner、过期账号/ABA/卸载；`App.spec.ts`：实际头像→卡片联动和不重载列表 | 服务载荷为替身；真实服务返回和cookie权限不由本地证明；既有radio group禁用和受控值有结果断言 |
| `components/content/content.tsx` | 图像/评论页签、分页状态与Feed/近视口入口装配 | 页签受控切kind并复位滚动；首屏loading/空/失败重试；后续失败保留原条目与cursor；手动与近视口加载去重；error/401暂停自动翻页；同账号认证后从中断cursor续，换kind/revision取消旧响应 | `components/content/content.spec.tsx`、`useContributions.spec.ts`、`App.spec.ts`：真实Feed/ModalTabs/hook、可控分页/observer、状态恢复与401 owner链 | 真实滚动视口、滑动页签、触摸/键盘焦点以及原生 IO 调度仍需浏览器；自动翻页不是以mock handler调用次数作为完整证据 |
| `components/content/list.tsx` | 贡献条目的图片/评论、审核轨迹与定位链接 | empty提示；图片预览失败fallback、URL改变复位；评论实际正文、当前语言日期、可解析点位地区；图像/评论分享参数分别定位；审核节点只依据已有时间/状态生成，不捏造审核/发布完成；tooltip显示有据的绝对/相对时间；comment点位数据加载过期/卸载忽略 | `components/content/list.spec.ts`：审核路径/撤回/缺时间、精确和相对时间、深链、locale重排、预览失败恢复；正文/资源路由沿用共享解析器测试 | 预览字节和点位加载为边界；图片解码、tooltip实际位置与字体宽度不由DOM文本测试证明；服务端审核真实性另属服务契约 |

## 非 TSX 的 app / worker 契约

| 模块 | 职责与功能 | 状态、时序及自动化证据 | 运行边界 |
| --- | --- | --- | --- |
| `apps/intel/src/state/collection.ts` | 地图档案映射点位ID，其它映射档案ID；toggle、范围 set/apply、当前集合快照、跨tab重读 | `state/collection.spec.ts`：两类记录隔离、apply无变化不写时间/广播、范围保留外部ID、storage/BroadcastChannel重读、malformed忽略/卸载解绑；本轮补合法局部/旧版payload不清另一集合、合法JSON错误shape不写store；随后统一复用共享 userRecord observer/merge；App导入补并发编辑后的最新快照 | storage/频道 fixture与真实双tab的 TEST-BROWSER-CROSS-TAB-001 分开记录。跨tabmerge遵循共享userRecord“缺字段保留当前”，数字ID保留原兼容归一；持久化开关沿用共享store，不额外复制演示进度 |
| `apps/intel/src/data/importContract.ts` | OEA/MAE token识别、gzip/base64url字节和已知ID载荷契约 | `data/importContract.spec.ts` 显式Node环境：真实gzip/Blob/Streams、前缀、重复/空白ID、冲突/结构错误、token与解压上限、缺API | 协议验收不等于完整 URL导入生命周期，后者由App suite保护 |
| 两 app 的 `locale/index.ts` | 独立catalog、语言别名、字体准备与提交、主catalog桥接边界 | 启动retry suites；hub `locale/index.spec.ts` 验证字体/存储失败保留现值、快速切换不提交旧语言；数据与ICU校验由标准check负责 | 字体Promise和catalog隔离有证据；真实字体下载、断网和排版由浏览器记录限制 |
| `apps/user-hub/src/components/content/useContributions.ts` | 分页游标和请求 owner；首屏/追加/失败/401/显式恢复 | `useContributions.spec.ts` 与App/Content suite：不取消其它消费者的读缓存、当前controller取消后旧返回不写、并发去重、原cursor恢复、换kind/revision失效 | 使用可控响应和实际hook，服务分页完整性/权限/真实重复记录另属provider验证 |
| `apps/user-hub/src/api/client.ts` | 共享HTTP边界、overview/贡献短缓存、预览URL、资料保存 | `api/client.spec.ts`：profile规范化、同源/公共预览URL、15s TTL、并发读去重、失败不缓存、身份隔离、consumer abort不取消共享请求、特殊cursor和真实401错误分类 | 无真实服务请求；缓存合同不是上线后端的证据 |
| `talos/oem-relink/src/index.ts`、`forward.ts`、`download/` | 无React UI；短域/地区转跳、翻译站、点位/图片/评论/hub路径、SEO预览、OEA下载 | `oem-relink/src/index.spec.ts`、`src/oemRelink.spec.ts` 保护入口状态码/Location/geo/白名单、深链参数、/me路由、manifest校验；下载/host专项沿现有suite | Request/Response是真实序列化边界，CF地理元数据、对象存储和社交爬虫仍为模拟；不把worker算新增UI组件 |
| `talos/oem-search/src/index.ts` | 无React UI；GET search、health、OPTIONS/CORS、locale索引、CJK/绑定组补充与排序、命中去重、limit | 本轮接入现有主站vitest发现。`oem-search/src/index.spec.ts` 用真实handler/Response/Orama验证两种索引的失败恢复、成功并发缓存、路由/空查询、locale别名/英语回退、无效行过滤、中文命中形状、绑定组优先/去重和limit | 请求索引的fetch为替身；不是已部署CF isolate。新用例修前确认两种缓存首次503后第二请求仍500，修后失败Promise逐键清除，保留成功缓存/协议 |

## 本轮新增回归与变更依据

| TEST-ID | 真实触发与修前结果 | 修复及观察结果 |
| --- | --- | --- |
| `TEST-INTEL-IMPORT-LIFETIME-001` | 解码尚未完成时卸载 Intel 并导航到 `/me/?import=keep#current`；旧成功写真实档案/时间，旧失败删新页面的 import 参数；两例修前失败 | effect消费 owner 限制提交/URL清理，复用decode Promise支持StrictMode；两种结局都不改旧store或新URL |
| `TEST-INTEL-IMPORT-SNAPSHOT-001` | 解码中另一tab编辑未包含在token中的档案；真实记录保留，但初始分桶仍用旧闭包，把它放错桶；先显式重新勾选已完成分类后，正确的已收集region查找仍失败 | 共享集合派生函数从提交后的当前记录拍初始快照，保留外部编辑和“本次分桶稳定”的设计；真实分类/卡片UI断言 |
| `TEST-INTEL-COLLECTION-MOTION-001` | 受控collected从true→false后，任意stackOrder重渲染撤掉uncollect属性；修前 `expected uncollect, received undefined`。补查快速反转时，同一bar旧正向动画的cancel也不能结束新逆向阶段，该边界在初版修复后再次被用例检出 | 用动画生命周期状态保持反向效果，只有对应Reverse animationName的progress条end/cancel或重新收集结束该阶段；无关重渲染、容器动画和旧正向cancel不提前结束。fixture显式提供原生animationName，未假装jsdom执行了CSS动画 |
| `TEST-SEARCH-WORKER-RECOVERY-001` | locale模板和legacy JSON两种索引第一次503后，源数据恢复，第二次仍500；两例修前失败 | 失败缓存Promise清除，下一请求重建；已有成功并发读缓存继续复用；用真实HTTP响应和命中载荷验证 |
| `TEST-INTEL-STORAGE-MERGE-001` | storage只含合法activePoints时清掉已有档案；合法JSON但无合法集合时清掉全部进度；两例修前失败 | 缺失集合保留当前，无合法集合直接忽略；时间缺失沿用当前，不生成伪新编辑；storage与频道入口实际hook断言 |
| `TEST-HUB-PENDING-IDENTITY-001` | 同uid新身份已提交，旧pending概览成功覆盖新卡片，旧401则clearSessionUser；两例修前分别未显示Fresh session/当前session变null | 只有pending概览的同uid新对象提交触发失效/清缓存/重读，已完成页面保留原头像即存不刷新UGC；旧成功/失败不再影响新身份 |

## 共享进度收口

`store/userRecord.ts` 为主站和Intel提供唯一的持久化合并与storage/BroadcastChannel观察入口。主站原先未观察外部编辑，真实双tab出现Intel取消而主站memory=true/persisted=false；现MapPage同步外部point后清history，archive-only更新不清point撤销。注册时先重读，补字体/地图启动期间漏收事件；合法局部记录保留另一集合，重复通知不回写。

`userRecord.spec.ts`八例保护hydration、坏shape/JSON、旧数字ID、局部合并、去重/停用保存/解绑/启动窗口，以及保存偏好恢复后的新命令仍可undo。历史屏障由history owner的onFinishHydration同步执行，消除动态import迟到清掉新undo。真实双tab传播、各app完整入口/动画/401表单恢复的范围见浏览器基线；服务替身与浏览器证据不混记。

## 本轮实际验证

以下命令均在 `talos/` 执行，未调用线上服务或启动浏览器；浏览器证据由总任务统一登记。

| 命令/范围 | 结果 |
| --- | --- |
| `pnpm exec vitest run --config apps/intel/vitest.config.ts --reporter=dot` | 退出0，9文件65例；日志 `/tmp/atlos-apps-closeout-intel-final.log` |
| 收紧Reverse animationName后 `pnpm exec vitest run --config apps/intel/vitest.config.ts apps/intel/src/components/intelCard/intelCard.spec.tsx --reporter=dot` | 退出0，1文件10例；相应Card逐文件ESLint与Intel项目tsc再次退出0 |
| `pnpm exec vitest run --config apps/user-hub/vitest.config.ts --reporter=dot` | 退出0，11文件58例；日志 `/tmp/atlos-apps-closeout-hub-final.log` |
| `pnpm exec vitest run oem-search/src/index.spec.ts --reporter=dot` | 退出0，1文件7例；日志 `/tmp/atlos-apps-closeout-search-final.log` |
| 对本轮 Intel App/Card/collection、Hub App、worker及vitest config的逐文件 ESLint | 退出0，无新增warning；worker spec 首次有3处类型写法错误，改为typed fetch mock/Response.json泛型及直接响应断言后通过，未削弱断言 |
| `pnpm exec tsc --noEmit --project apps/intel` / `apps/user-hub` / `oem-search` | 三个项目均退出0 |
| `git diff --check` | 退出0 |

主站完整检查、生产构建、真实服务/Cloudflare isolate和跨浏览器结果不由以上命令推导。整体验收仍以 TESTS 的实际运行记录与已列边界为准，不以本文行数作完成判据。


## 2026-10-28 生产画面复核补充

`App.tsx` 的认证恢复容器在保留 Content 挂载时新增了一层无高度 div，切断了 Feed 的百分比高度链。贡献数据和 li 虽已存在，实际 tabpanel 只有约10px，浏览器 `toBeVisible()` 仍可能对被祖先裁剪的卡片返回 true。新增 `TEST-{BROWSER,PRODUCTION}-HUB-CONTENT-001` 在原冻结产物上真实失败：视口减首卡高度为 −125.92px，而要求至少容纳一整张卡片。

修复仅给现有恢复容器分配剩余高度与min-height，不改变401恢复/身份owner。共享浏览器合同使用20条无预览图贡献，验证首卡和末卡在实际滚动视口及屏幕中完整可达，跳转Profile再返回、刷新失败保留旧列表并显示错误时仍成立；同一合同覆盖开发/生产入口，移动两引擎也复用。这个发现补足 App→恢复wrapper→Content→Feed 的真实CSS组合边界；单独Feed几何和文字可见断言都没有证明此前整个高度链可用。最终运行与产物身份以生产基线（本地 `docs/PERFORMANCE.md`）为准。


## 2026-10-28 Stage 0滚动几何补全

IntelCard/VirtualIntelCard新增“虚拟化恢复首帧沿用已有高度”和“已脱离DOM/零尺寸/非有限测量不得写回owner”的回归。旧恢复高度及detached/zero-size形状均有修前失败；修后聚焦14例、完整Intel73例及完整开发65例通过。三引擎原全列表原生smooth滚动往返保留全部底部/回顶/恢复/动画断言，新增全程scrollHeight range<2px，实际均0px。对应39个owner与109个组件的成本不重复归属，见逐组件对照（本地 `docs/behavior-change-ledger.md`）；原始帧见 scroll-stability（本地 `docs/baselines/2026-10-28-closure/scroll-stability.json`）。
