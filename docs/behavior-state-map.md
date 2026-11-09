# UI 状态归属与动作副作用映射

2026-10-27，`refactor/standard`。这是逐组件职责/功能审查的共享输入，不是新增测试通过记录。依据当前源码及 [TESTS](TESTS.md)、四份领域审查表；本工作单元没有运行测试或修改产品逻辑。

范围包括 `src/store/` 的 14 个 Zustand store、主站/Intel/user-hub 三个 locale store、两个 React context，以及关键页面外部快照和异步 owner。纯计数缓存、数据加载缓存和传输请求不是用户状态的第二份权威副本。

## 归属边界

| 数据 | 权威归属 | 不得混用的状态 |
| --- | --- | --- |
| 用户点位/非地图档案进度 | `store/userRecord.ts` 的 `activePoints` / `activeArchives` / `updatedAt` | `guideProgress` 只改变显示；marker 的 `selectedPoints` 是选择状态，不是已完成状态 |
| 会话身份 | `store/auth.ts` 的 `sessionUser` / `sessionVersion` | UID 相同不代表同一次会话；保存头像/刷新会话也会提升版本 |
| 主站云同步基线 | `store/progressSync.ts` 的 baseline + baselineUid | 本地进度不随登录自动按账号分开保存；新账号的云端差异须先冲突选择 |
| Intel 云同步 | `ArchiveProgressSyncHost` 的独立 baseline/request owner | 仅同步非地图档案；地图档案写共享 pointId，由主站点位同步负责 |
| 当前查看点与打开请求 | `store/marker.ts` | 当前点、comment/image 请求互有关联，不能把三个独立 setter 当作互不影响 |
| 用户偏好与临时 UI 命令 | `store/uiPrefs.ts` | Drawer snap 命令、guide force 值、公告/guide open 不等于真实当前像素或稳定动画阶段 |

## 主站 store 的写入、重置与订阅

路径均相对于 `talos/src/`。表中“清除”是源码明确执行的重置；没有列出的字段不会因该动作自行复位。

| Owner / 动作 | 写入与重置 | 持久化与下游 |
| --- | --- | --- |
| `store/uiPrefs.ts`：sidebar 开合/宽度；分类展开/排序 | 各 setter 写自己的字段；宽度经 clamp；layoutVersion 仅递增 | `ui-prefs`：sidebar 值/宽度/分类展开依保存 sidebar 偏好恢复；排序依保存顺序偏好恢复。消费者为共享 shell、主站 Sidebar、Intel、MapPage 平移补偿和测量 |
| uiPrefs：cluster/boundary/label/map supplements | 独立开关，不清 point/filter/selection | 开关保存；前三项按 prefsTriggersEnabled 条件恢复，map supplements 独立恢复；useMarker/useBoundary/useLabel/useMapSupplements 消费 |
| uiPrefs：desktop/mobile snap、forceRegion/Layer/Detail/Headbar | setter 仅写命令；`null` 的意义由各 owner 决定；forceHeadbar 是三态 | desktop snap 保存；mobile snap 不保存，初始 0；force 值不保存。Drawer/引导/定位共享这些入口，实际 Motion 像素不能从命令值推导 |
| uiPrefs：guide/announcement open、announcementFlowReady | 独立 open/ready 字段，不自动释放其它 force 值 | 临时，不保存；UserGuide/UIOverlay/SupportAutoPopup 各有生命周期处理 |
| uiPrefs：持久化/性能/隐藏完成点偏好、theme | setter 不直接清业务数据 | 偏好保存。启用 viewState/markerProgress 的订阅另执行 rehydrate；隐藏完成点、聚合、性能模式会改变渲染/布局分支，theme 由 platform/useTheme 连接系统主题 |
| `store/marker.ts`：`setCurrentActivePoint(point)` | 每次设置 currentActivePoint，包含同点再次点击时的新对象；**同时清 imageOpenRequest 和 commentOpenRequest** | current point/请求不保存；Detail 与 uploader 依此开关/重载 |
| marker：`openMarkerImage` / `openMarkerComment` | 图像请求清评论请求；评论请求清图像请求；image generation 递增；空 image/comment id 不发请求 | 非持久；Uploader/Comments 消费。先选点，再设置具体打开请求，否则会被选点清掉 |
| marker：filter/search/scope | filter 相关 setter 写筛选；search 写原始查询；scope setter 仅在值变化时写 visibleSubregionKey | 仅 filter 保存；search/scope 不保存。搜索、侧栏选择、历史、地图菜单都可更新 filter |
| marker：selected / temporary selected | selected 的 batch 去重、一次写入；temporary 可批量追加或局部/全部清除 | selected 保存，temporary 不保存。两者共同驱动地图选中外观，locator/行为关系临时选择必须只撤销自己拥有的项 |
| marker：data version | 递增 markerDataVersion，使真实加载后的 membership/count/cache 重新计算 | 临时；不是一次用户选择或完成动作 |
| `store/region.ts`：`setCurrentRegion` | 写 region，**无条件将 currentSubregionKey 清 null** | `region-storage` v2 保存 region/subregion；旧 Jinlong→Wuling 且清 subregion。地图、定位、导航、regSwitch 都可切区 |
| region：setCurrentSubregion / requestSubregionSwitch / clearRequest | 子区实际值与“请求切换”是两字段；请求只写/清 request，不自动执行地图切换 | request 不保存；useMap/regSwitch 消费并处理后清请求 |
| `store/layer.ts`：setCurrentLayer | 仅写 layer，不校验该 region 可用层，不切 region | `atlos-layer-storage` 保存；layerSwitch/useMap/路由应用负责检查和切换约束 |
| `store/userRecord.ts`：真实记录写入 | Store 本身没有业务 setter；history、同步、导入和 Intel 写 activePoints/activeArchives/updatedAt | `points-storage` 条件写磁盘；hydrate 即使保存偏好当前关闭也保留已有磁盘记录。主站 MapPage/Intel 共用 observeProgressStorage，订阅后初读并监听 storage/BroadcastChannel，去重且合法缺字段保留当前；主站外部 point 变化清 history。`getActivePoints()` 在偏好关闭时返回空，但 React `useUserRecord()` 仍返回真实数组 |
| userRecord：重新启用进度保存 | uiPrefs false→true 后 rehydrate；history 自己订阅 onFinishHydration，在恢复完成时同步清撤销栈 | 此为跨 store 副作用；不能把“重新启用开关”当作只改偏好。修前迟到动态import会清掉恢复后新建的undo，userRecord真实store回归现保护新命令可撤销到恢复值 |
| `store/history.ts`：commit point/filter/selection | 先应用实际差分，有变化才追加 past；清 future；最多 25 条。point 差分写真实进度与时间，selection/filter 差分写 marker | history 不保存；真实 point 变化会被 ProgressSyncHost 订阅。collect 与 select 是不同命令 |
| history：undo / redo / external replace | undo/redo 对当前集合反向/正向应用差分，再移动栈；external replace 替换真实 point 集合并清两栈 | undo 不应回退之后的无关真实编辑；云端/导入替换是历史屏障 |
| `store/guideProgress.ts`：begin / preview / end | begin 新 owner 并清演示覆盖；preview 等真实点位后检查 owner+最后动作序号，仅更新覆盖；end 只清匹配 owner | **不保存、不写 userRecord/history**。地图标记/聚合、统计、详情读 display 合成值，导出/云同步/实际手动命令仍读真实值。清演示显示最新真实数据，不恢复旧快照 |
| `store/userGuide.ts`：single/bulk/replace completed；completeCurrentUserGuide | 单步/批量合并 completed；replace 整体替换；共享点启动仅标记两个 welcome intro 完成 | `UserGuide` v1 只保存 stepCompleted；没有版本更新后强制打开逻辑。force UI 和延时动作属于 UserGuide 组件，不在此 store 自动清理 |
| `store/auth.ts`：set / clear / beginSessionUpdate | set/clear 更新会话缓存与身份，**均递增 sessionVersion**；begin 只递增版本并返回版本值 | 通过 backend session cache 保存，不是 Zustand persist；auth controller/session refresh/sync host/hub/评论/图片共同消费 |
| `store/progressSync.ts`：setBaseline | 写 revision/index/pointIds/retainedPointIds、baselineUid、lastSyncedAt；清 baseline 同时清 uid/time | `talos-progress-sync` v5 只保存 baseline/uid/time。旧版本 baseline 无 owner，迁移时丢基线而保留时间提示 |
| progressSync：status/counts/error/conflict | 独立字段；setCounts 的省略值保留；setConflict(non-null) 同时置 status=conflict；**setConflict(null) 不恢复 status** | 状态/冲突不保存。Host 负责后续 synced/syncing/dirty/error，Modal 关闭不等同于数据已同步 |
| `store/locator.ts`：viewMode/position/banner/auth/bind | setter 独立；reqBind 递增计数；banner/auth 有专门清/关动作 | 不保存；定位 host、按钮、地图 marker proximity、官方绑定入口共享。off 并不由 store 自动清 lastPosition/banner/auth |
| `store/viewState.ts`：save(region,map)/clearAll | 保存每区中心与 zoom；clear 全部 viewStates | `map-view-states` 条件保存；hydrate 只有保存视图偏好开启才 merge；false→true 自动 rehydrate。与 region 切换的旧视图保存顺序相关 |
| `store/link.ts`：upsert/remove/config/import/reset/undo/redo | 修改 current，同步维护 past/future；新修改清 future；resetToBase 可撤销 | 手动安全写 `talos:linkData`，历史不保存；dev linkTool 写、主站 useLink 读。删除不存在项/非法 import 不改数据 |
| `store/label.ts`：upsert/remove/import/reset/undo/redo | 同 link 的快照历史，undo/redo 上限 50；稳定 map selector 给 useLabel | 手动安全写 `talos:labelData`；dev labelTool 写、地图读。重置基线不等于删除磁盘 key |

## Locale 与 React context

| Owner / 动作 | 写入与重置 | 重要连接 |
| --- | --- | --- |
| `locale/index.ts`：loadAndSet / setLocale / initial load | 先并行 catalog/font，再以请求 guard 检查提交；提交 locale/data、持久化语言、切字体并更新 map 字体相关状态 | 初始 catalog 失败持续重试；用户选择保留旧语言直到事务成功。preload 仅预热，不是切换 |
| Intel / hub `locale/index.ts` | 各自独立 Zustand locale/catalog；applyLocaleData 是低层同步提交入口，正常 chooser 由主站事务协调 app prepare/commit | 不能把 app 文本挪到主站目录；主站与 app commit、字体区域须作为一条组合验证，而不是分别看调用次数 |
| `pages/markFilter/reorderContext.tsx` / DragContext | register 保存测量 getter、补入局部 order，同步提交结构顺序；start 捕获 origin rect；update 只改视觉 order/ref；end 持久化最终 ref 并清 dragging；unregister 仅删 registry | uiPrefs.markFilterOrder 是磁盘顺序；Motion 累计位移以起始 rect 为基准。旧注册 timer 覆盖完成拖动/新 owner 的问题已由页面矩阵回归修复，风险表保留最初发现的触发条件 |
| `pages/sideBar/windowStore.ts` / WindowContext | attach 绑定所属窗口/滚动/observer；register 维护 block/测量/延迟 trim；measure 计算虚拟行并通知；记录/恢复滚动 anchor；targets 生成包括离屏项的几何选择目标 | detach 清 observer/listener/trim 和 anchor；焦点/hover 行保留；搜索输入 focus 和新用户滚动应阻止旧 anchor 回写。不能以虚拟DOM只渲染少量行推断选择范围只含这些DOM |

## 异步 owner 与页面局部状态

下列状态不是新 Zustand store，但会跨请求、浮层、tab 或组件挂载存活，必须纳入完整动作链。

| Owner / 操作 | 写入、清理与门槛 | 主要证据 / 后续边界 |
| --- | --- | --- |
| `component/shared/account/useIdCardAuthController.ts` | openAuth 清 authError 并切 mode；离开 passwordReset 清 token/email；avatar 登录前受 authReady gate、登录后开 Profile；OAuth exchange 有正式版本/active guard；登录/注册/重置等待 3333ms wipe 后关窗或转注册；资料保存校验版本 | controller、Access、IDCard 组合。用户确认请求可后台完成、旧 UI 流程不可影响重开面板；独立 UI owner 取消旧 wipe/OTP/重置收尾，详见组件矩阵，不能由 auth store 的安全性单独推导 UI 安全 |
| 主站 `ProgressSyncHost.tsx` | 订阅真实 activePoints；dirty 去抖/最大等待、visibility/pagehide/online 尝试；请求持有 uid+sessionVersion+mounted lifetime 和独立锁；apply remote 抑制本地回声并建立 baseline；冲突本地/合并保留 unknown，云端选择替换并建立基线 | Host spec、progress.integration；选择本地/云端/合并是不同副作用，setConflict(null) 不独立完成同步；真实 server 幂等/跨标签仍另验 |
| Intel `state/collection.ts` | map archive 写 pointId，普通 archive 写 archiveId；setCollected/toggle/applyCollectedState 保留未纳入操作范围的其它记录；实际变化更新时间并 BroadcastChannel；共享 observer 收到 storage/channel 后重读 points-storage，合法局部载荷仅更新存在的集合，重复通知不回写 | collection.spec 与 userRecord.spec；真实双 tab 传播见浏览器基线。不同 tab 并发写仍由磁盘最后写入决定，不承诺事务合并 |
| Intel `ArchiveProgressSyncHost.tsx` | 独立非地图 manifest/baseline；uid/version/lifetime guard；只订阅 activeArchives；差异无可信 owner 时先冲突（含空一侧）；debounce/online/visibility；replaceKnownArchives 保留未知 archive 和全部 point | Host spec；A/B/合并后 write/replace 区别需保留；未确认 mutation 要幂等重放，不可被旧 finally 解新锁 |
| hub `App.tsx` 的 useAccount | uid 边界同步订阅递增 epoch，abort overview、清旧 overview；同批 ABA 也计入；权威 overview 在缓存身份缺失时采用身份；refresh 清读缓存并 revision++ | App.spec；overview 401 清身份但 awaitingAuth 抑制误触身份边界；contribution 401 隐藏而保留原 Content，同账号续页，换账号重建私有树 |
| hub `useContributions(kind,revision,authRevision)` | 每次加载 abort 旧请求；首屏清列表、分页保留既有项；401 保存中断 cursor 并暂停自动翻页；authRevision 同 kind/revision 才续中断 cursor；kind/revision 变化清中断并重载 | hook、Content、App 组合；AbortSignal 检查防止旧结果，DOM隐藏不等于卸载；同账号认证恢复不能换为无条件 refresh |
| hub `Profile` | 选头像即乐观显示并保存；pending ref 去重；发出前校验 props uid；返回校验 generation+sessionVersion+uid 及返回 uid；成功写 auth 并更新 overview 的对应 user | component/App spec；onSaved 不重读贡献列表，旧 props 不应向当前 cookie 发起另一人的昵称保存 |
| `detail/comment/commentSubmissionStore.ts` | 模块级 markerId→任务/snapshot/errors；提交立刻插 local pending，远端完成替换为 submitted，失败删除 pending 并存 ownerUid error；server list 确认相同 id 后去重；快照监听独立于 panel挂载 | Comments/ugc comment tests；模块任务不随 panel卸载销毁，显示 owner 过滤和 keyed panel 的责任不能遗漏 |
| `Comments.tsx` 与评论动作 hook | panel 按 marker+uid+sessionVersion 隔离 draft/reply/edit；action task map 去抖投票/举报，清理失效任务；编辑失败恢复正文与草稿；外部受控草稿恢复需避免 Lexical OnChange 反向清空 | Comments.behavior、editor；IME和真实选区/浏览器输入法另验 |
| `uploader/useUGCPointImages.ts` | 点/uid 改变清 image/myImage/requested/selected/viewer、重置 detail load；enabled gate 按需加载；imageOpenRequest 可指定单图并启用 Viewer；过期加载由 dispose/owner限制 | pointImages/uploader spec；同点 tab 复用与换点清空是不同事件 |
| `uploader/useUGCUpload.ts` | 模块级 markerId→upload task，taskId+ownerUid 隔离；readers/TTL/容量清理非活跃任务；游客先认证再下一帧触发 file picker；进度/错误/submission 跨 tab 保留 | upload.spec；卸载面板不等于取消真实上传；file selection、真实 XHR progress/服务端审核另验 |
| `uploader/useUGCImageActions.ts` | scope 含 point/uid/sessionVersion；投票/举报队列独立；recall 两步定时确认；optimistic 删除并清 Viewer，失败仅当前 scope 回滚原内容与 Viewer | uploader spec；取消/换图/关 Viewer 清 recall确认；旧 finally 不释放新 scope 的动作状态 |
| `notify/notify.tsx` 与 notificationRead | feed/category/cursor/unread/mark-all 和可见已读 batch 共同受身份版本限制；注销/卸载清 pending、计时/observer；新 feed 与直播更新合并去重 | notify/notificationRead spec；焦点、真实视口可见时长和后台切换仍需浏览器结果 |
| `platform/pictureInPicture.tsx` | 模块级当前 app window/document 与订阅；portal、observer、键盘、滚动锁必须迁移到新 ownerDocument | PiP/overlay/shell spec；浏览器实际 Document PiP 窗口生命周期不能由普通 document 替身替代 |

## 后续触点审查必须保留的顺序

1. 路由/搜索/通知定位：先 region，再适用 layer/subregion，再当前点，最后具体 image/comment 打开请求。后续 `setCurrentRegion` 或 `setCurrentActivePoint` 会清掉前面的部分状态。
2. 真实完成命令与选择命令分别进入 history；不要用 selectedPoints 判断已完成，也不要用 display progress 作为云端/导出/手动命令的数据源。
3. cloud apply / import replace 先建立所属 owner 的可信基线并抑制回声，再替换真实记录，最后更新状态；仅关冲突弹窗不代表成功同步。
4. profile→官方绑定/冲突接力需等原 Modal 退出后打开下一层；数据动作与退出动画的计时不能互相覆盖。
5. 认证成功含异步 session 确认、wipe 及可能的 profile setup；AuthGate 必须等所有认证 UI 关闭且非 submitting 才通知列表恢复。
6. 同 UID 重登/ABA 依 sessionVersion，切点 A→B→A 依 scope generation；单纯比较最终 key 不足以使旧请求/回滚失效。
7. 拖动预览尺寸/顺序不是保存完成；完成提交与 cancel/失去捕获/卸载必须分别定义，不能将最后一个帧回调当作用户确认。
8. 当用户在等待期间修改真实数据，退出临时流程应显示最新真实记录；恢复入场快照会覆盖用户之后的有效编辑。

## 本轮交给组件/页面审查的具体风险

这些是源码审查候选，不是已经复现的线上 bug；须用实际触点/可控时序验证后再决定修复。

| 位置 | 风险与触发条件 | 应验证的最终关系 |
| --- | --- | --- |
| `markFilter/reorderContext.tsx` register 的 0ms 保存 | 注册任务捕获旧 next，可能晚于 endDrag 或 provider 卸载执行；状态 updater 中安排外部写入还受重放影响 | 最终磁盘顺序必须为最新有效 owner/完成手势的顺序，旧注册任务不能覆盖 |
| `userRecord.ts` false→true rehydrate 及 dynamic history clear | 连续开关/导入/编辑与恢复 Promise 交错时，旧恢复后的 clear 可能作用于之后的新历史 | 偏好变化对磁盘/内存/撤销的顺序有明确结果，旧生命周期不清新历史 |
| auth controller wipe/OTP/profile setup | 请求成功后延迟关闭/切 tab；等待期间重新打开或切身份 | 旧流程不关闭新弹窗、不重置新表单或再次弹旧 profile setup |
| UserGuide 目标重试/onBefore/滚动/rAF | 原 advance 轮次 guard 只保护步骤完成和 delay；其它任务仍有独立调度及 `.finally` | skip/close/hidden/unmount/换步骤后无旧滚动、旧重挂载或未处理 rejection |
| 外部 store（评论/上传）与 panel 生命周期 | 模块任务可比 React 组件活得久；owner过滤属于消费者而非自动物理删除 | 新点/新身份不读旧 pending/error；同 owner 重开保留有效任务且不重复提交 |
| 双标签页 localStorage + BroadcastChannel | 不同 tab 修改同一真实进度，重读是替换，消息只带更新时间 | 真实传播方向、过期读与并发策略需浏览器验证，不能以模拟 onmessage 就声明端到端通过 |

跟进：auth UI owner 候选已按用户确认修复，并由关闭/同批次重开/切mode/卸载回归保护；框选engine另复现并修复了document迁移后的pointer/rAF/body owner错位。具体实现和实际验证范围见 [组件矩阵](behavior-components-matrix.md)。reorder、guide及其它页面/独立app候选的结论以各自矩阵和主任务最终验证记录为准，此映射不替代各域复现证据。

## 验证说明

本映射仅进行文件/调用方阅读与文档差异检查，未重跑测试；已执行结果以 [TESTS](TESTS.md) 的提交/命令记录为准。映射没有授权新增产品行为；产品歧义由主任务向用户确认。后续修复需同步更新对应组件功能矩阵与 TEST-ID，而非把本表所有审查候选直接标为已修复。

收口补充：userRecord false→true恢复后的动态history.clear已真实复现会清掉紧随其后的新point撤销；现由history owner的persist.onFinishHydration同步建立历史屏障。共享observer补订阅后的初读，两个方向的真实tab传播结果见浏览器基线。风险表保留的是最初审查候选，不能据其历史措辞推导当前仍未修复。
