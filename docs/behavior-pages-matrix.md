# 主站 pages：组件职责、功能与覆盖矩阵

范围：`talos/src/pages/` 的 **53 个生产 TSX 文件**，包括同文件内实际使用的子组件、context 和返回 UI 的 hook。不是按文件名推断功能：本表承接此前逐项源码/调用方审查，复核事件顺序、旧测试的保护边界及本轮发现的生命周期缺口；直接依赖的 `.ts` hook 在下方单列。无输出的 context、Lexical 节点和占位文件也保留。

“自动化覆盖”表示对应真实状态/最终 UI 或数据断言存在；传输、布局、第三方驱动等替身边界明确写出。它不表示该组件任意状态组合均已穷尽。基础显示组件没有自己的网络请求时，网络失败归其 owner；不能为它伪造“失败已测”。本表中浏览器待验项应对照 [统一验收记录](TESTS.md)，不能由 jsdom 用例数量抵扣。主站入口与跨 app/服务的浏览器结果由集成者统一记录，本文不预先宣称通过。

## 装配与通用页面

| 文件 / 组件 | 职责 | 功能与状态合同 | 自动化覆盖及边界 | 时序、动画与浏览器边界 |
| --- | --- | --- | --- | --- |
| `MapPage.tsx` / MapPage | 地图、侧栏、全局 UI 与引导的应用 owner | 地图 ready 后装配 UI；桌面侧栏开合补偿视野；区域 bounds；隐藏/恢复 UI 保持地图；子区域/全局错误隔离；Safari 手势监听；共享进度外部更新与 point 撤销屏障 | `MapPage.spec.tsx`：桌面/移动/宽屏补偿分支、region、hidden、ready、错误；真实 Leaflet，Map/SideBar/UIOverlay 子树为边界替身 | 全入口的真实布局、连续侧栏开合与地图动画需浏览器；壳测试不证明所有子树组合；主站↔Intel 双 tab 真实传播及 userRecord 启动窗口/局部载荷见浏览器基线 |
| `MetaHelper.tsx` / MetaHelper | 同步语言与页面 head | 更新 lang/title/标准与 OG meta；缺标准 tag 时创建且不重复；不输出页面节点 | `domain/domain.spec.tsx`：切语言、已有/缺失 meta 的结果；与搜索引擎实际抓取无关 | 无进出场动画；字体加载/SEO 抓取属于外部边界 |
| `announcement/announcement.tsx` / AnnModal | 受控公告阅读 | 最新公告/日期/未读；强制未读；空与列表缩短；关闭后记录阅读；按钮/遮罩/Escape 只通知一次 | `announcement.spec.tsx`：上述正常/空/关闭路径；公告数据为 fixture，真实 Modal | 关闭回调重复缺陷已修；真实滚动、公告长文与退出重开画面由浏览器验收 |
| `domain/domain.tsx` / DomainBanner | 在既有引导/公告顺序后提示站点建议 | 国内/国外及当前域名判定；离线/未知地域不提示；有效 dismissal/过期；完成退出后才保存 dismissal | `domain.spec.tsx`：地域/域名/离线/过期/先后顺序；geo/location 是 fixture | Banner 200ms 退出后写入已保护；真实导航与地域服务不是本地测试证据 |
| `favPOI/favPOI.tsx` / FavPOI | 未启用的空占位 | 当前仅返回空 fragment，没有收藏列表或操作 | `domain.spec.tsx` 只确认空输出；调用方审查确认不是活跃功能 | 不把空渲染计作收藏功能完成；无自己的时序/动画合同 |
| `uiOverlay/UIOverlay.tsx` / UIOverlay | 全局面板、账户、通知与首轮引导/公告的装配 | 显式入口开面板；UI 隐藏清面板；compact 恢复；guide ready 后只自动公告一次；分享链接抑制自动但保留手动入口；PiP/移动限制；账户 live channel owner | `UIOverlay.spec.tsx`：真实 controller/prefs/auth/HeadBar；下游面板、geo、live API 模拟 | session 切换/卸载旧 channel 忽略已保护；完整面板叠加、焦点、PiP 原生窗口需浏览器 |

## 搜索、筛选与选择

| 文件 / 组件 | 职责 | 功能与状态合同 | 自动化覆盖及边界 | 时序、动画与浏览器边界 |
| --- | --- | --- | --- | --- |
| `search/search.desktop.tsx` / SearchDesktop | 桌面查询入口 | 共享 query；清空与关闭；Enter 保留查询/地图；接真实结果模型 | `search.spec.tsx`：desktop/mobile owner、真实 Orama、marker/region store、Enter；小索引/点位 fixture | 默认表单导航及侧栏测量需真实浏览器 |
| `search/search.mobile.tsx` / SearchMobile | 移动查询入口及宽度接线 | 与桌面共享 query/results；宽度；档案摘要/高亮；query 触发移动 Drawer 规则 | `search.spec.tsx` 与 `sideBar/layout.behavior.spec.tsx`：切布局保留 query；level0→1、不压低 level2 | store 链路有证据；软键盘、视口 resize、触摸滚动需浏览器 |
| `search/search.shared.tsx` / SearchShared、HighlightText | 结果搜索、分组展示与高亮 | 规范化/CJK/空白/0 结果；绑定组/档案；类型过滤；唯一点导航；地区计数；scroll mask | `search.spec.tsx`：真实 Orama 和 store；导航 service、小索引与点位为边界 | 防抖中旧响应/清空/卸载失效，fallback 失败重试与 Wuling 归属已保护；实际高亮字形与列表滚动需浏览器 |
| `markFilter/markFilter.tsx` / MarkFilter | 分类展开、为空反馈和拖动外壳 | 显式开合/自动空分类折叠；空说明；过滤全部/取消；内容 grid；拖动 handle；drag 后抑制点击 | `sideBar/filters.integration.spec.tsx`：真实 MarkFilter/provider、空→有/有→空、500ms 保留退出；context menu 行为接实际 store | 初始双 rAF、Motion reorder 和拖动回弹需要真实布局；500ms 保留窗口不是动画视觉已完成的证明 |
| `markFilter/reorderContext.tsx` / MarkFilterDragProvider | 分类顺序、测量注册与拖动持久化 | register/unregister；多邻居移动/反向；其它 id 不得改序；拖动结束才提交交互顺序；结构注册立即提交不可延迟回放 | `reorder.behavior.spec.tsx`：正式 provider+prefs，多次交换、移除、结构注册→drag→timer、卸载→新 owner；`reorderContext.spec.ts` 验证数学阈值 | 本轮消除 updater 中的 0ms 持久化，修前实测旧注册覆盖已完成拖动/新 owner；真实手势与 Motion projection 另验 |
| `markFilter/reorderCore.tsx` / DragContext、useMarkFilterDragContext | 向分类提供唯一 drag context 合同 | 正常读共享 owner；无 provider 时明确 throw；不拥有单独 DOM/动画 | provider 集成验证共享 order/drag 状态；数学 suite 保护 LayoutRect 输入 | 无独立网络/空列表 UI；不能为 context 伪造视觉 smoke |
| `markSelector/markSelector.tsx` / MarkSelector | 单类型筛选与进度显示 | 受控选中/取消；类型与资源名/icon；完成百分比；紧凑截断；hover/focus 暂时提高层级；脱离后恢复 | `sideBar/filters.integration.spec.tsx`、`sidebarFilters.spec.tsx`：与 Binder/filter strip 同步；测量由 `measureQueue.spec.ts` 承接 | hover 延迟回落与 DOM 测量已读生命周期，真实文本展开、触摸/焦点视觉与字形仍需浏览器 |
| `markBinder/markBinder.tsx` / MarkBinder | 绑定组汇总与组内类型独立操作 | 整组全选/取消；子项单独切换；组汇总与子状态一致；紧凑/展开/重测 | `filters.integration.spec.tsx`：真实 Binder→Selector→filterList/store；`markBinder.spec.tsx` 保护尺寸重测 | 不把 binder key 当类型写入；真实自适应行高与展开动画需浏览器 |
| `filterList/filterList.desktop.tsx` / FilterListDesktop | 桌面已选类型横条 | files 类型排除；点击移除；横向 wheel；左右渐隐边缘；scroll/resize/font 变化 | `sideBar/filters.integration.spec.tsx`：实际选择链、wheel 防默认、边缘/observer 清理；几何显式 fixture | Motion exit 与设备滚轮惯性、字体重排后 mask 的视觉需浏览器 |
| `filterList/filterList.mobile.tsx` / FilterListMobile | 移动已选条与内容宽度 | 与桌面相同过滤/移除；向 owner 报内容宽度，供 Drawer/搜索布局使用 | 同 integration 的移动分支：正式 strip、store、width callback、scroll 与清理 | 真实触摸横滚、键盘展开后的宽度变化需浏览器 |
| `scopeIndicator/ScopeIndicator.tsx` / ScopeIndicator | 提示并清除子区域过滤 | 有 scope 显示区域说明；恢复全部只清 subregion，不清类型；无 scope 不显示 | `filters.integration.spec.tsx`：文字/状态、点击前后正式 marker store；地区数据为正式索引 | 纯派生显示无异步错误态；长语言布局需浏览器 |

## 侧栏与布局

| 文件 / 组件 | 职责 | 功能与状态合同 | 自动化覆盖及边界 | 时序、动画与浏览器边界 |
| --- | --- | --- | --- | --- |
| `sideBar/sideBar.tsx` / SideBar | 响应式选择唯一侧栏 | desktop/mobile 互斥；共享 store；字体区域变化后合并一次布局刷新；跨 document swap 清理监听 | `sideBar.spec.tsx`、`layout.behavior.spec.tsx`：分支/字体/rAF 合并/监听释放；device fixture | 真实断点切换、PiP document 与字体布局需浏览器 |
| `sideBar/sideBar.desktop.tsx` / SideBarDesktop | 桌面开合、宽度和内容准备 owner | intent 后准备；开合只通知一次；拖动 clamp/列数；内容 admission；hidden/inert 与底部工具 | `layout.behavior.spec.tsx`、`useDividerDrag.spec.tsx`：真实 Trigger/windowStore，内容/账户子树替身；取消/丢捕获/卸载回滚 | 拖动中字体/窗口变化、连续开合和地图补偿整链需浏览器 |
| `sideBar/sideBar.mobile.tsx` / SideBarMobile | 移动 Drawer 与共享 snap owner | hydration 后恢复；query 仅将收起态升一级；保留最高级；hidden 不交互；内外滚动/divider 规则 | `layout.behavior.spec.tsx`：真实 Drawer/Motion，正式 prefs；搜索子树为替身 | 真实 timer 保护目标尺寸，合成触摸不等于软键盘/惯性/多指验收 |
| `sideBar/sidebarFilters.tsx` / SidebarFilters | 将地图/查询/完成统计映射为分类 UI | 按 preparedCount admission；普通/新版本类型同选中状态；档案分组与独立子项；region/query 隐藏保留 filter；安全 Intel 链接 | `sidebarFilters.spec.tsx`+`model.spec.ts`：真实模型、统计、分类、store；小型类型/点位/diff fixture | 大列表完整视觉、统计变化造成的布局动画由浏览器与性能分开验收 |
| `sideBar/sidebarWindow.tsx` / SidebarWindow、SelectorRows、Row | 虚拟窗口、行 admission 与选择层共享测量 | 可见行/overscan；pinning/锚点；scroll 后新行；列数与紧凑模式；缺视口/替换节点与清理 | `windowStore.spec.ts` 和 `sidebarFilters.spec.tsx`：正式 react-window、WindowStore/SelectionLayer；尺寸为 fixture | 真实 ResizeObserver、字体变化、动画中保持滚动锚点需浏览器 |
| `sideBar/selectionLayer.tsx` / SelectionLayer | 跨虚拟行框选并实时提交正式筛选 | 选择初始可见行；保持pointer按下跨scroll继续选择起始视口外目标；释放提交并回收capture/observer | `sidebarFilters.spec.tsx`新增真实SidebarWindow/SelectorRows/MarkSelector/engine组合：Row18起初未挂载，按下后scroll使其挂载，继续移动时正式filter包含row18且真实控件active，row19不误选，释放后结果保留；共享selection suite另证取消、activate交叠、rAF双向自动滚动/边界/停止 | 虚拟行、正式store和控件真实运行，几何/ResizeObserver/pointer capture为显式fixture；原生滚动惯性、触摸合成与浏览器auto-scroll帧序另验。旧用例仅在释放后滚动，不能单独证明持续框选 |

## 地图、导航与控件

| 文件 / 组件 | 职责 | 功能与状态合同 | 自动化覆盖及边界 | 时序、动画与浏览器边界 |
| --- | --- | --- | --- | --- |
| `map/Map.tsx` / Map | 将 MapCore、地图 hook 与运动视觉状态装配 | 地图初始化/ready；move/zoom 合并到帧；overdrag 与 pending；卸载释放帧/事件 | `Map.spec.tsx`：真 Leaflet 事件，业务 hooks 为替身；`useMarker.spec.tsx`、renderer suites 另证内核 | 一帧多事件有证据；实际瓦片/canvas/多指缩放和布局联动需浏览器 |
| `map/MapContextMenu.tsx` / MapContextMenu | 地图菜单、历史和批量操作 | 坐标/共享/地图开关；区域/目标限制；批量完成二次确认；undo/redo；复制后短暂反馈并关闭；Alt 保留原生菜单 | `MapContextMenu.spec.tsx`：真实 Leaflet、ContextMenu、history/store；clipboard 与外部导航为边界 | 2s 确认/900ms 复制退出有 timer 断言；原生右键、top layer 和退出中重开需浏览器 |
| `map/useLink.tsx` / useLink 返回的 link tooltip | 分区地图链接 overlay 与 tooltip | 正式 link store 配置；地区/zoom 过滤；hover 定位；进入 tooltip 取消关闭；切区卸载 overlay | `useLink.spec.tsx`：真 Leaflet overlays、延时离开/重入、region 生命周期；native Popover fixture | 200ms 延时+150ms 退出保留与重开已有证据；真实地图缩放/Popover 锚点需浏览器 |
| `map/usePreview.tsx` / UseProductionPreview、PreviewElement、UsePreview | 点位 hover 图片预览与 DEV 分流 | 等待 hover 再请求批量预览；近邻缓存；授权/来源筛选；无图片/加载/解码失败清理；预览移动/隐藏；DEV record 分支按需加载 | `usePreview.spec.tsx`：真地图事件，UGC transport/图片解码 fixture；旧 requestToken/点位/visible 防护；record 分支由 dev loader 合同承接 | 主站真实图片、canvas 图标命中、桌面 hover→预览与区域切换需浏览器；未把 DEV 工具全功能纳入用户产品验收 |
| `map/behaviorOverlay/SupplementTooltip.tsx` / SupplementTooltip | 地图补充信息 tooltip 内容和锚点 | 目标不存在隐藏；类型说明/位置更新；Esc 和地图变化关闭；与 overlay 内容一致 | `useMapSupplements.spec.ts` 与 behavior scene/layer suites；挂载者控制生命周期，几何/Popover 有替身 | 真实 overlay 叠层、canvas 命中和字体/zoom 后定位需浏览器 |
| `regSwitch/regSwitch.tsx` / RegionContainer、SubregionSwitch | 主地区切换与分区过滤菜单 | 当前区域图标；intent 预加载；只有最新选择可导航；失败回退可再选；子区域切换/清全部/hover highlight；键盘/外点收起 | `regSwitch.spec.tsx`：慢旧请求、新请求胜出、错误重试、正式 region/subregion store 与真实 Leaflet | 切区会清 subregion，目标设置必须在其后；真实 tooltip/图标/菜单动画、网络节流及 zoom highlight 需浏览器 |
| `layerSwitch/layerSwitch.tsx` / LayerSwitch | 楼层选择与本层提示 | 有楼层区域才显示；主按钮回 M；楼层可选项；地区变化关闭；外点/blur/键盘收起 | `layerSwitch.spec.tsx`：Enter/Space、真实 layer store、无嵌套按钮、区域隐藏/返回 | 无网络/加载态；菜单重开、层级与 hover/focus 视觉需浏览器 |
| `scale/scale.tsx` / Scale | 选择响应式缩放控件 | 将同一地图交给 desktop/mobile；布局切换只保留当前控件 | `scale.spec.tsx`：两分支公共入口与地图事件；device fixture | 真实断点变化和手势进行中切换需浏览器 |
| `scale/scale.desktop.tsx` / ScaleDesktop | 桌面 zoom/PiP 控件 | +/- 半级；进度点选；zoom bounds/clamp；map 运动同步；PiP 按平台可用性切换 | `scale.spec.tsx`：真 Leaflet zoom/store、显式几何；PiP 能力/窗口为边界 | rAF 合并和卸载清理已读/测试，真实滚轮/浏览器 PiP 动画需浏览器 |
| `scale/scale.mobile.tsx` / ScaleMobile | 移动触摸缩放条与地图拖动锁 | 连续 zoom/snap；触点结束 flush 最终值；取消；仅恢复自身借用的 dragging 锁 | `scale.spec.tsx`：真 Leaflet，touch 坐标合成；原启用/禁用、cancel、卸载/切布局；旧锁归还缺陷已修 | 多指、滚动与系统触摸事件时序不由 jsdom 证明；真实移动视口实测 |

## 详情、评论与图片

| 文件 / 组件 | 职责 | 功能与状态合同 | 自动化覆盖及边界 | 时序、动画与浏览器边界 |
| --- | --- | --- | --- | --- |
| `detail/detail.tsx` / Detail、CategoryIcon | 点位详情及评论/图片/档案 owner | 选点开关/同点再次点击；图标/收集/撤销；同类批量二次确认；档案读取与安全 HTML；评论摘要→展开/高亮；同点 tab 复用、换点重置 | `detail.spec.tsx`：正式 marker/history、真实 Uploader/Comments/parser；transport/档案 marker fixture；`marker.counts.spec.ts` 承接演示统计 | 300ms 确认/过期、旧档案 Abort、面板退出保留已有证据；完整搜索→详情、字体/滚动/浮层尺寸需浏览器 |
| `detail/comment/Comments.tsx` / Comments、CommentsPanel、CommentItem、CommentAvatar、CommentExcerpt | 点位/账号评论会话和各条交互 | 游客登录；分页/展开/引用/回复/编辑/取消；乐观发送、错误草稿恢复；投票/撤销/回滚；撤回确认；emoji 与复制；翻译/链接高亮 | `Comments.spec.ts`、`Comments.behavior.spec.tsx`、comment action/link/translation suites：真 Lexical/ActionBar/submission store；transport/translation fixture | point+uid+sessionVersion key，旧队列和 ABA 隔离已保护；共享复制 hook 本轮补跨点/卸载；原生 IME/选区/触摸 emoji、完整滚动需浏览器 |
| `detail/comment/commentEditor.tsx` / CommentEditor、CommentEditorBridge | 源 markdown 与 Lexical 受控互通 | 普通/格式/emoji 输入；长度计数与提交上限；粘贴；快捷提交；IME composition；外部 clear→restore 不回声覆盖 | `commentEditor.spec.ts`、`commentEditor.markdown.spec.ts` 与真实编辑失败组合：Lexical 实现真实运行，Selection 为 jsdom | discrete+专用 update tag 保护父子恢复；原生输入法候选、移动软键盘、caret 字形定位待浏览器 |
| `detail/comment/commentEditorEmojiNode.tsx` / CommentEmojiNode | Lexical 自定义原子 emoji 节点 | 合法 token→资源；文本导入/导出；选择/删除原子边界；emoji 计数 | editor emoji/markdown 序列化及 Comments picker 调用组合；共享 asset URL 用正式函数 | 不是独立弹窗或网络 owner；真实图片解码、光标越界视觉需浏览器 |
| `detail/comment/commentEditorOverflow.tsx` / CommentEditorOverflow | 超限 Range/Highlight 标记 | 标记超限而不截断；修正后清除；composition/history 不损坏；卸载释放测量 | editor suite 覆盖粘贴超限、长度及恢复；Range/Highlight 支持为环境边界 | rAF 受 owner 清理；原生 CSS Highlight 着色/字体矩形需浏览器 |
| `detail/comment/commentEditorToolbar.tsx` / CommentEditorToolbar | 选区驱动的浮动格式条 | 保存/恢复实际选区；粗体/斜体/下划线/删除线/spoiler；混合/嵌套格式；Escape | editor/markdown/spoiler suites 和真实 ActionBar；显式 DOMRect | 选区失焦处理有语义证据；跨窗口选区、滚动后锚点、动画中点击需浏览器 |
| `uploader/uploader.tsx` / Uploader | 图片列表、选择、Viewer 与写操作 owner | 游客登录/图片上传/粘贴；空/处理中/失败/已有图片；轮播与元数据；分享；投票/flag debounce 与失败回滚；撤回确认/回滚；同点 tab 复用 | `uploader.spec.tsx`、`useUGCUpload.spec.tsx`、`useUGCPointImages.spec.tsx`：真 Viewer/Carousel/ActionBar 与 store；transport、clipboard、文件识别为边界 | immutable scope+sessionVersion 保护点位/账号 ABA、迟到 recall 不恢复旧快照/重开 Viewer；真实选文件、解码、Viewer 过渡和上传服务另验 |

## 定位、账户相关页面与通知

| 文件 / 组件 | 职责 | 功能与状态合同 | 自动化覆盖及边界 | 时序、动画与浏览器边界 |
| --- | --- | --- | --- | --- |
| `locator/LocatorButton.tsx` / LocatorButton | 按视图/身份/绑定状态选择定位入口 | 游客转登录并记一次待启用意图；off→检查绑定→定位/绑定；tracking→关闭；detached→返回当前位置；桌面 intent 设置菜单；移动展开/外点收起 | `LocatorButton.spec.tsx`、`LocatorFlows.spec.tsx`：真实 UI/store，status/enable 作为边界；本轮改真实 Zustand auth fixture，保护旧账号 status 与旧激活结果不打开新面板；另保护已知绑定在失败后保留、未知失败不误开绑定、pending 点击去重、401 转登录；真实服务cache另由 `services/endfield/backendClient.spec.ts` 验证 | mounted+sessionVersion/status request/activation request 防旧返回；`session.spec.ts` 保护写入、失败重试和 disable/身份/关闭取消，backendClient suite 防3s cache/inFlight跨会话共用；原生定位/权限、多指菜单/PiP 布局需浏览器 |
| `locator/EndfieldBindingHost.tsx` / EndfieldBindingHost | 监听全局绑定意图并按需装配绑定页 | 未请求不加载；请求选项/import-only；成功 onBound 回传；关闭/卸载解除监听与 loader owner | `LocatorFlows.spec.tsx`：真实 host→绑定表单→callback；retry hook 有公共专项；官方服务替身 | 卸载后旧 exchange 不继续 bind 已保护；真实跨页面发起与浮层 owner 需浏览器 |
| `locator/LocationBinding.tsx` / LocationBinding | token/角色绑定流程 | token 字符串/JSON 提取；5s 倒计时；默认/单/多/无角色；失败可改后重试；import-only 不开定位；忙碌期禁止关闭和切 provider | `LocatorFlows.spec.tsx`：真正 Modal/TabView/store；服务 fixture；exchange/bind 的 unmount、relogin/ABA 旧结果不应用 | busy 是用户确认合同；服务器已接收的写无法由本地取消；真实文档/按钮焦点/退出画面需浏览器 |
| `locator/LocationConfig.tsx` / LocationConfig | 当前角色展示、定位偏好与解绑 | cached/加载状态；trackPoints/centerOnPosition/scope；提醒关闭禁用 scope；未实现 heatmap 禁用；换绑/解绑；解绑失败保留操作并重试 | `LocatorFlows.spec.tsx`：正式配置读写、关闭回调、scope 禁用、解绑失败/成功；本轮补旧 session status/unlink 隔离 | status effect 取消、mounted+sessionVersion 保护 unlink；不新增请求期间关闭策略；用户确认读取失败保留已知角色；未知持续加载重试，关闭/卸载/切账号取消，401 转登录；真实官方状态/跨设备持久化另验 |
| `locator/LocationAuth.tsx` / LocationAuth | 定位政策确认 | 当前角色政策同意；忙碌禁用提交与关闭；失败保留并重试；成功后开启定位、清 banner/关闭；取消则关闭定位 | `LocatorFlows.spec.tsx`：真实 Modal/locator prefs；policy 服务 fixture；本轮保护 relogin 以及同批关闭/重开后旧授权不可启用 | mounted+sessionVersion+authOpen episode 保护迟到写；服务器政策记录与真实权限弹窗另验 |
| `locator/LocatorBanner.tsx` / LocatorBanner | 显示绑定/政策提示 | 无 key 隐藏；不同提示 key；outside dismissal；卸载清除监听 | `LocatorFlows.spec.tsx` 与基础 Banner suite 的正式时序；说明文本来自 catalog | Banner 自身退出/重开有基础回归；真实地图与 banner 重叠、触控遮挡需浏览器 |
| `notify/notify.tsx` / NotifyModal、NotificationCard、NotificationMessage、NotificationEmptyState | 身份所属的通知 feed、分组与已读操作 | 游客登录；分类切换；空/失败/重试/分页去重；聚合展开；可见停留后读；全读；live 合并；条目导航；点位名与语言格式化 | `notify.spec.tsx`、`notificationRead.spec.ts`、`notificationMessage.spec.ts`：真 Modal/Feed/auth，service/IO fixture；旧列表/live unread/markAll/ABA 隔离；本轮补 marker lookup 拒绝恢复、关闭停止重试、null mismatch | marker 加载采用公共 retryLoad，拒绝不永久缓存；实际视口 dwell、原生滚动、通知→点位/评论/图片导航整链需浏览器；服务推送不是 fixture 通过即可验收 |

## 设置、存储与引导

| 文件 / 组件 | 职责 | 功能与状态合同 | 自动化覆盖及边界 | 时序、动画与浏览器边界 |
| --- | --- | --- | --- | --- |
| `settings/settings.tsx` / SettingsModal、SettingsSection、ShortcutRow | UI/地图偏好、主题与存储工具装配 | Trigger→正式 prefs；显式 light/dark/system；分组说明与快捷键文本；真实 StorageSection/TreeMap | `settings.spec.tsx`：实际触发器/store/存储页装配；theme apply/system follow 为外部副作用替身 | 偏好改变全站的实际结果/主题过渡、系统主题事件、字体及长语言需完整浏览器 |
| `storage/storage.tsx` / StorageSection | 导入导出和有范围的清除 | 未选择禁用；800ms 后二次确认；过早/外点取消；选中/全部/筛选+进度分离；原始 storage id；导出当前数据；读文件→解析/导入→清 file input | `settings.spec.tsx`：真实 store、FileReader、实际 D3 选中；删除 service/解析 confirm/reload 为边界；storage platform 有下层专项 | 文件读完后的跨账号/卸载导入语义沿用全局本地数据工具，不能据 UI 组件假设云端事务；真实删除/刷新/浏览器下载需浏览器 |
| `storage/treeMap/treeMap.tsx` / TreeMap | 实际存储层级和大小的 D3 浏览 | 空/层级/叶子；显示真实字节而非面积 clamp；路径使用原 id；刷新；点击上下钻 | `settings.spec.tsx`：真 D3 和原始 URL/字节；本轮增加 refresh 新先旧后不能恢复已删旧条目 | effect owner 忽略旧 inventory，卸载/重画中断 D3 transition；jsdom 不实现 SVG transform interpolation，实际缩放动画需浏览器 |
| `userGuide/UserGuide.tsx` / UserGuide | 首次欢迎与手动详细引导 owner | 仅 intro 自动；Help resume；完成状态；force UI 清理；点位演示独立于真实数据；每轮步骤、目标定位及延迟推进 | `UserGuide.spec.tsx`、`guideProgress.spec.tsx` 和真实 marker/count 组合；目标重试、步骤等待/滚动、旧Promise/新步骤、关闭重开及拒绝恢复有回归；另有真实浏览器Joyride | 所有timer/rAF/重试及步骤动作属于可取消GuideTasks，visible/step/轮次关闭会取消；TEST-BROWSER-GUIDE-001桌面实际走到完成/清除、移动走头栏/下一目标与关闭重开，范围及结果见浏览器基线 |
| `userGuide/spotlight/spotlight.tsx` / GuideSpotlight | 高亮当前目标并提供遮罩推进入口 | 当前 rect/viewport→路径；目标消失撤下 box；active 点击推进；inactive 不推进；停用/卸载释放循环 | `UserGuide.spec.tsx`：正式组件、显式目标矩形与目标移除 | rAF 是测量驱动；真实字体/布局、滚动中的 spotlight 跟随、触控命中和动画需浏览器 |
| `userGuide/tooltip/tooltip.tsx` / GuideTooltip、TooltipHeader、RangeIndicator | intro/详细引导的按钮和进度呈现 | intro 单关闭 tip；详细进度由实际 steps 数量派生；首步禁 back；skip/next/back 委托 driver；显示站点/标题 | `UserGuide.spec.tsx`：实际 Tooltip 组件与 driver callback；不把假的第三方 DOM 操作当全 tour | 真实 Joyride 定位、长文本、进度条和 tooltip 进退场见统一浏览器记录 |

## 直接 hook / 状态边界与本轮缺陷保护

以下不是额外 TSX 计数，列出页面功能依赖而不可由文件表遗漏的关键边界。TEST-ID 的要求来源与决定以 [TESTS](TESTS.md) 及用户确认记录为准。

| 边界 / TEST-ID | 实际输入与保护结果 | 证据与范围 |
| --- | --- | --- |
| `reorderContext` / TEST-REORDER-OWNER-001 | 新注册分类后，在 0ms timer 前完成拖动，之后不得回写旧注册顺序；卸载后的旧 owner 不得覆盖新顺序 | 修前拖动 `[a,b,d,c]` 被改回 `[a,b,c,d]`，卸载后 `[new-owner]` 被旧数组覆盖；现同步提交结构变化且 updater 无副作用；`reorder.behavior.spec.tsx` |
| `locator/session.ts` / TEST-LOCATOR-ACTIVATION-001 | status 等待期间同 uid 重登、账号 ABA、disable 或 UI 卸载；旧结果不得缓存到新身份或开启定位 | `session.spec.ts` 使用正式 auth/prefs/locator store；取消返回 `undefined`，当前未绑定返回 `false`，有效启用返回 `true`；读取成功时的最新 scope/center 偏好 |
| `locator/bindingStatus.ts` / TEST-LOCATOR-STATUS-RETRY-001 | 读取失败持续重试，不把未知视作未绑定；取消停止后续尝试；401 保留错误并走登录，不无限请求过期身份 | `bindingStatus.spec.ts`：真实 fetch→requestJson→EFBackendError 链路，503→恢复、网络失败→关闭取消、401→session revalidation 且仅一次请求；UI 结果在 LocatorFlows/LocatorButton suites；真实服务未调用 |
| `locator/useRequestOwner.ts` / TEST-LOCATOR-UI-OWNER-001 | status、unlink、policy、入口 activation 回调只属于当前 mount 与 sessionVersion；政策弹窗的 close→open 另有 episode owner | `LocatorFlows.spec.tsx`、`LocatorButton.spec.tsx`；服务替身；真实 backend 已收到的 unlink/policy 无法“撤销”，仅保证旧结果不污染新会话 |
| `services/endfield/backendClient.ts` / TEST-LOCATOR-SERVICE-CACHE-001 | status的3s缓存与进行中请求只在uid+sessionVersion+binding revision相同才复用；旧status不能回填或清新锁；旧mutation完成不能清新会话/后发mutation的cache | `backendClient.spec.ts`：正式HTTP requestJson、Headers/credentials、真实auth动作，只有fetch响应可控；修前6例失败，暖cache在换账号/同uid重登/ABA返回旧role，pending被跨身份共用，旧mutation清新锁，旧status回填旧cache。不是只修改UI mock使其通过 |
| `share/usePointShareLink.ts` / TEST-SHARE-OWNER-001 | 复制 A 后切 B，A 复制可完成但不得在 B 显示“已复制”；已显示的 toast 随 point/content 换入清理；卸载后不新建 rAF/timer | `usePointShareLink.spec.tsx`：真实路由 URL，clipboard deferred；修前跨点 toast=true、卸载遗留两个计时任务；现 URL owner+request+frame/timer 清理；详情/图片/评论共用 |
| `TreeMap` / TEST-STORAGE-INVENTORY-001 | refresh2 先完成后 refresh1 迟到，不得重现旧删除条目 | `settings.spec.tsx`：真 D3，inventory deferred；修前 CurrentObject 被 DeletedObject 替换；现 effect owner 失效；实际动画仍归浏览器 |
| `notify` / TEST-NOTIFY-MARKER-001 | lookup/shard 临时 reject 后恢复；owner 关闭后停止重试；不存在的 marker=null 不循环重试 | `notify.spec.tsx`：修前拒绝永久缓存且未处理 rejection；现失败缓存淘汰+公共可取消 retry；通知正文保持，不把缺数据当整页失败 |
| `detail/comment` 的队列/翻译/link/submission | 点位/身份拥有自己的 action/debounce/回复/草稿；失败恢复；来源仍合法才能应用结果 | 对应 action/translation/commentLink/Comments suites；局部真实逻辑与 transport fixture，不代表线上写入或原生输入法 |
| `map/useLocator`、`useLabel`、`useMarker`、behavior overlay | 初始化/切区/卸载时停止旧轮询、标签/图片/关系加载；过滤、显示进度及真实记录各有 owner | locatorRecovery/useMarker/visual/behavior suites；渲染数学/状态测试与浏览器视觉结果分开 |
| `sideBar/windowStore`、`measureQueue`、`useDividerDrag` | resize/font/scroll 合并与节点替换；pin/anchor；pointercancel/lost capture；owner 清理 | 各既有专项及实际 SelectionLayer/SidebarWindow 组合；显式几何不证明真实浏览器布局 |

## 验证执行

- 本轮在改生产实现前，对 reorder、定位、分享与 storage 的新回归执行过原形诊断，失败位置及具体差异见上表；不是线上事故声明。reorder 的第一次测试先错误期待“一次帧位移跨两个邻居”，阅读数学合同后改为真实单帧一次交换，再确认失败来自后续注册 timer 的覆盖；没有为消除实现缺陷改变最终保护条件。
- 定位/排序/分享/存储稳定后：`pnpm exec vitest run src/pages/markFilter/reorder.behavior.spec.tsx src/pages/locator/LocatorFlows.spec.tsx src/pages/locator/LocatorButton.spec.tsx src/pages/locator/session.spec.ts src/pages/share/usePointShareLink.spec.tsx src/pages/settings/settings.spec.tsx --reporter=dot`，6 文件 **38 例通过**，退出 0；相关 14 文件 ESLint 退出 0。scope/token 类型已按真实服务接口约束，不扩展 `any`。
- 其中一轮 unlink 回归曾把同 uid 新会话的正常 status 写缓存误算为旧 unlink 的写入；现先等待新会话读取完成、再清记录并释放旧 unlink，以分别断言两类请求，没有弱化旧 unlink 的 cache/disable/close 禁止断言。
- 通知 marker 新回归先观察到两条断言失败及三次未处理拒绝；修复后 `pnpm exec vitest run src/pages/notify/notify.spec.tsx --reporter=dot`，**1 文件 10 例通过**，退出 0；两文件 ESLint 退出 0。原有 NotificationMessage key warning 和本轮故障注入的预期重试诊断保留可见，未屏蔽。取消发生在 `open=false`，不等待退出 DOM 才停止；已加载文字保留供退出画面使用。
- 继续沿定位消费者追踪真实服务发现3s cache/inFlight未分身份，已获root扩展服务边界所有权并补修；`pnpm exec vitest run src/services/endfield/backendClient.spec.ts src/pages/locator/LocatorFlows.spec.tsx src/pages/locator/LocatorButton.spec.tsx src/pages/locator/session.spec.ts --reporter=dot`：4文件33例通过。再补TTL边界后服务单文件8例通过，两服务文件ESLint退出0。诊断最初对多余fetch未提供Response，曾在真正的“多发请求”失败之外制造undefined.ok环境异常；补为每次均有合法Response的默认fixture，保留role、请求次数及Promise归属断言，实际串号/清锁用例仍能检出旧实现。最后typed lint将any型Matcher改成类型化fetch及独立Headers/credentials断言，未删检查。
- 本lane未自行提交/推送；集成提交及全量检查/浏览器证据以TESTS为准，不替其它环境预填“通过”。

- 用户随后确认定位读取失败契约：已知绑定保持显示，未知持续尝试到成功，关闭/切账号停止，401 走登录。最小新 UI 诊断6例修前失败；mobile误开弹窗也触发缺 ResizeObserver 的fixture错误，现使用共享observer fixture。状态加载复用 retryLoad；8个定位变更文件 ESLint退出0，`pnpm exec vitest run src/pages/locator/LocatorFlows.spec.tsx src/pages/locator/LocatorButton.spec.tsx src/pages/locator/session.spec.ts src/pages/locator/bindingStatus.spec.ts src/services/endfield/backendClient.spec.ts --reporter=dot` 5文件47例通过，退出0（含登录关闭后可再次打开）。原两条切会话回归新增“首次请求已开始”准备条件，避免新异步重试入口把旧deferred错配给新会话，旧结果不得写入断言保留。
