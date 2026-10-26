# 主站页面行为基线核对

范围是 `talos/src/pages/` 的全部 **53 个 TSX 源文件**，不含 spec。逐项阅读实现、直接调用方、状态/hook 和已有 spec 后，补齐有实际回归价值的场景。下表一文件一行；文件存在测试或某条测试通过，不等于全部浏览器表现已经证明。阶段状态见本地忽略的 `docs/roadmap.md`，可提交的整体记录见 [TESTS](TESTS.md)。

## 执行方式与证据边界

- 页面集中入口：`cd talos && pnpm exec vitest run src/pages --exclude 'src/pages/search/**' --exclude 'src/pages/MapPage.spec.tsx' --maxWorkers=1`。`MapPage` 和搜索由根任务单独实施并纳入全量检查；本表包含其当前测试证据，页面子任务的运行数不包含它们。
- 实际执行的组件包括 React、Zustand、Modal、按钮、Trigger、Drawer、ContextMenu、ActionBar、Viewer/Carousel、Lexical、D3 以及下文指定的真实 Leaflet 对象。跨组件用例直接读写正式 store，不能用下游 handler 的调用次数代替状态结果。
- `talos/test-support/pages.ts` 提供无瓦片的真实 Leaflet 地图与可控 deferred Promise。地图具有明确视口/边界，允许小数 zoom；测试退出移除地图并恢复浏览器能力标记。它不下载地图、不执行画布渲染内核。
- `talos/test-support/browser.ts` 的 ResizeObserver、Popover、PointerCapture 和几何输入是浏览器 API fixture。Popover 开关符合调用协议，但无法证明原生 top layer、焦点呈现及 CSS 布局。
- 传输服务、定位官方角色请求、通知实时通道、图片解码和 clipboard、字体区域、设备状态、Joyride 驱动在相应 spec 处模拟。每份 spec 限定自己的边界，不能将模拟下游的 Map/UIOverlay 壳测试称为完整地图或服务端集成。
- 既有有效断言保留。异常注入验证拒绝、空数据、慢响应与账号切换，不代表线上已经发生同一故障。没有性能、线上写入或发布结论。

## 逐文件审查表

下表源文件路径相对 `talos/src/pages/`，测试路径也相对该目录。`已有` 指本轮前的测试，`新增` 指本轮补充。

| 文件 | 设计意图及已有用例审查 | 当前行为证据与补齐点 | 解释边界 |
| --- | --- | --- | --- |
| `MapPage.tsx` | 组织地图、侧栏、引导和全局 UI；已有子模块测试不足以证明装配层 | 根任务新增 `MapPage.spec.tsx`：侧栏仅桌面指定 zoom 平移、区域切换恢复 maxBounds；宽视口/移动不平移；隐藏/快捷键恢复 UI 保留地图；渲染错误隔离；全局 Safari 手势监听释放 | 真实 Leaflet 事件、模拟 Map/SideBar/UIOverlay 子树；不声称全页面端到端 |
| `MetaHelper.tsx` | 根据语言更新根 lang、标题及现有 OG/标准 meta；原无直接 spec | 新增 `domain/domain.spec.tsx`：语言切换同步 head；缺标准 name tag 时补齐且不重复；已有 OG tag 更新 | 无 DOM 输出是有意设计；搜索引擎抓取不在本地证据内 |
| `announcement/announcement.tsx` | 受控打开、最新公告/未读判定、关闭后记录阅读；原无 UI spec | 新增 `announcement.spec.tsx`：latest id/date、闭合不渲染、强制未读/空公告、列表缩短回退；按钮/Escape/遮罩每条实际关闭路径均仅通知一次 | API 公告内容为 fixture；修复重复 `onChange(false)`，见回归表 |
| `detail/detail.tsx` | 随选中点位显示上传/评论/档案，收藏历史和批量同类收集；原仅评论、上传 hook/链接专项 | 新增 `detail.spec.tsx`：选点开关/再次点同点、保持 currentMarker；真实收集/撤销、300ms 同类批量确认；评论摘要→真实评论展开/链接高亮、同点切 tab 不重读/换点重置；旧档案响应 abort、安全 HTML 和资源 URL | marker/网络 fixture；真实 store、Uploader、Comments、HTML parser；正式档案字节不联网读取 |
| `detail/comment/Comments.tsx` | 评论列表/引用/编辑/乐观提交/投票，点位及账号拥有独立暂态；已有 `Comments.spec.ts` 保护游客分享、emoji、关闭栈，但均游客，缺认证写入 | 新增 `Comments.behavior.spec.tsx`：游客调用登录入口；认证发送失败清乐观项/错误；回复父级/深度/引用与取消；编辑失败回滚正文并保留草稿；投票 debounce/快速撤回/失败回滚；账号切换隔离 pending 与投票；同批次重登/ABA清draft和投票队列；根任务按需加载编辑器合同保留 | 实际 Lexical、ActionBar、submission store；transport/翻译为边界；编辑器外部恢复值缺陷已修 |
| `detail/comment/commentEditor.tsx` | 受控 markdown 源与 Lexical 编辑状态同步，IME/长度/快捷提交不能丢输入；已有 `commentEditor.spec.ts` 和 `commentEditor.markdown.spec.ts` 场景有效 | 保留长度/500 提交上限/550 输入界限、格式、快捷键、emoji、粘贴、IME；扩展 external clear→restore 不回声旧输入；上述真实 Comments 编辑失败用例验证父子闭环 | jsdom 模拟 selection；原生输入法候选窗/移动软键盘需要浏览器；没有删弱旧断言 |
| `detail/comment/commentEditorEmojiNode.tsx` | 自定义 emoji 保留 token、合法资源和原子选择/计数 | 既有编辑器 emoji 插入/序列化、markdown emoji 与自定义 emoji 长度 2 的用例复用；`Comments.spec.ts` 实际 picker 38 项选择/重复插入覆盖调用方 | 未对 Lexical 私有节点布局作快照；图片网络不加载 |
| `detail/comment/commentEditorOverflow.tsx` | 通过 Range/Highlight 标识超限且保持 IME/history，不截断文档 | 既有编辑器 spec 验证粘贴超限、count、修正后状态、源格式长度与 emoji 边界，保留；controlled restore 新例同时覆盖更新后的标记 | CSS Highlight 的实际着色、浏览器 Range 字形矩形属于视觉边界 |
| `detail/comment/commentEditorToolbar.tsx` | 基于真实选区提供浮动格式操作，toolbar 获焦不丢已存选区，Esc 可关闭 | 既有 editor/markdown/spoiler spec 验证选区保存、toolbar 应用格式、Esc、underline/strike/spoiler、嵌套格式，复用；ActionBar 公共组件另有 dismiss/禁用合同 | 工具栏定位使用显式 DOMRect；不等于跨窗口原生选区实测 |
| `domain/domain.tsx` | 引导及公告后按地域建议站点，完成退出后保存有限期 dismissal | 新增 `domain.spec.tsx`：等待 guide/announcement、国内/国外建议、匹配站点/离线/未知地域不显示、有效 dismissal/过期、Banner 200ms 退出后才写偏好 | geo transport 与 location fixture；未发起导航 |
| `favPOI/favPOI.tsx` | 当前明确只返回空 fragment，没有收藏页面实现 | 新增 `domain.spec.tsx` 验证无内容；阅读调用方确认未凭文件名假造交互 | 仅记录占位状态，不据此宣称收藏功能完成 |
| `filterList/filterList.desktop.tsx` | 桌面条展示已选普通类型，移除筛选，横向 wheel 与渐隐反馈；原无直接 spec | 新增 `sideBar/filters.integration.spec.tsx`：真实 Selector/Binder 写 store 后条同步；排除 files；点击移除；wheel 防默认、左右边缘、ResizeObserver 清理 | 布局尺寸显式设定；字体/滚轮设备惯性不由 jsdom 证明 |
| `filterList/filterList.mobile.tsx` | 移动横向已选条，内容宽度向 Drawer 布局报告 | 同一 integration spec 参数化真实移动组件：files 排除、点击移除、内容宽度 callback、scroll 左右边缘和 observer 清理 | 实际触摸惯性属于浏览器边界 |
| `layerSwitch/layerSwitch.tsx` | 仅有楼层地区展示；主按钮回 M、菜单选择楼层、区域变更关闭 | 已有 `layerSwitch.spec.tsx` 两例已含 Enter/Space、楼层实际 store 更新、按钮不嵌套、外点/blur、地区无楼层隐藏并返回时不误开，断言保留 | 没有为固定楼层常量重复堆断言；原生 hover/focus 的视觉过渡未测 |
| `locator/EndfieldBindingHost.tsx` | 响应全局绑定意图并延迟加载绑定界面 | 新增 `LocatorFlows.spec.tsx` 从真实全局 request 进入实际绑定选项；根任务统一 retry hook，关闭取消加载 | 模拟官方服务；共享动态加载重试专项证明失败重试，不把成功导入例称为失败注入 |
| `locator/LocationAuth.tsx` | 对持续定位先展示政策，同意失败可重试，成功才启用定位 | 新增 `LocatorFlows.spec.tsx`：政策失败保持弹窗/提示，重试成功启用真实 locator 偏好；真实 Modal | 协议接口模拟；不连接官方定位 |
| `locator/LocationBinding.tsx` | 解析 token、选择角色；导入与持续定位按入口不同；请求期保持操作一致 | 新增同 suite：空/token JSON、倒计时、多个/默认/单角色、无角色错误后重试、import-only 不启 tracker；请求期 Escape/遮罩/关闭/模式切换全禁用，异常恢复后可切换关闭，成功正常退出；host卸载后不继续bind，已发bind遇卸载/同uid重登/ABA不应用旧结果 | 禁止请求期间关闭/切换是用户确认的产品规则；TabView disabled 由基础控件实现；服务器已收到的请求无法由本地epoch取消 |
| `locator/LocationConfig.tsx` | 已绑定信息、定位/区域/追踪偏好及解绑 | 新增同 suite：trackPoints/centerOnPosition 保存到配置、提醒未启用时 scope 禁用、解绑失败不清现态、重试成功完成退出 | backend/auth applyRole/disable 是边界；未验证官方服务持久化及已启用时所有scope组合 |
| `locator/LocatorBanner.tsx` | 绑定后提示可由外点关闭、解除监听 | 新增同 suite：显示条件、outside dismissal、卸载清理 | Banner 动画由公共控件专项另证 |
| `locator/LocatorButton.tsx` | 定位入口依会话/绑定状态转入登录、绑定或配置；tooltip 独立于按需 modal | 既有 `LocatorButton.spec.tsx` 覆盖 tooltip 锚点等；新增 flows 的 host/策略/配置路径承接入口后的真实界面；UIOverlay 验证入口装配 | root 改为按需 retry；外部 geolocation 权限弹窗未实测 |
| `map/Map.tsx` | 组织地图初始化/图层 hooks 和运动视觉状态，不在 React 高频重绘 | 新增 `Map.spec.tsx`：真实 Leaflet 事件上 coalesce frame、ready callback、overdrag/pending 在 moveend/zoomend/卸载清理；已有 `useMarker.spec.tsx` 验证真实 MapCore 分区集合过滤 | Map 的各业务 hook 在壳例中模拟；`useMap`/renderer 另有专项，未改渲染内核 |
| `map/MapContextMenu.tsx` | 地图操作入口受坐标/历史/区域限制，批量修改需确认 | 新增 `MapContextMenu.spec.tsx`：真实 Leaflet+ContextMenu；Alt 原生菜单、范围外 share/无历史 undo 禁用、地图移动即退出 inert；坐标/zoom 分享与900ms反馈；二次 bulk 确认及 retarget 重置；scope/supplement prefs、监听释放 | 地图 bulk service、clipboard 模拟；各次 store 结果真实断言 |
| `map/behaviorOverlay/SupplementTooltip.tsx` | 在区域 supplement 目标显示提示，退出保持锚点直到动画结束 | 新增 `usePreview.spec.tsx` 直接挂载真实 Tooltip 验证锚点与 retained exit；既有 supplements/behaviorScene/canvas spec 保护 scope、scene 和清理 | Popover API fixture，不验证 top layer/CSS实际位置 |
| `map/useLink.tsx` | 共享点位链接在区域加载后呈现，旧链接清理 | 已有 `useLink.spec.tsx` 使用真实 Leaflet，覆盖跨区 deferred link 创建与卸载；保留；Detail 评论链接入口另有真实 DOM 证据 | fixture marker/region readiness；未访问外链服务器 |
| `map/usePreview.tsx` | hover 稳定后批量查图、优先缓存、图片 decode 完成才显示；小 PiP 不干扰 | 新增 `usePreview.spec.tsx`：最高票/同票旧图、load+decode、80ms debounce、近期 batch、旧响应忽略、区域改变/卸载取消、图片失败、小 PiP 无预览 | Image 解码是显式成功/失败 fixture；DEV 按需内容由 root retry 改动，不以生产 hover 例声称 DEV editor 已集成 |
| `markBinder/markBinder.tsx` | 多个 marker type 绑定展示，子项点击不得误触整组，位置重新测量 | 已有 `markBinder.spec.tsx` 只覆盖 reflow remeasure，保留；新增 filters/sidebarFilters integration 执行真实 Binder/Selector，验证子项与整组不同 store 更新 | 几何重测来自 fixture；Motion 实际连续 drag 不在该例 |
| `markFilter/markFilter.tsx` | 分类展开/自动折叠，短期保持离场内容，参与全局重排 | 新增 `filters.integration.spec.tsx`：空列表自动折叠、手动展开后再次变空、500ms退出；`sidebarFilters.spec.tsx` 真实分类和候选集 | 无 screenshot；触摸拖拽驱动的浏览器部分保留边界 |
| `markFilter/reorderContext.tsx` | 维护当前视觉 order，手势完成才保存最终顺序 | 原 `reorderContext.spec.ts` 实际只有纯 reorderMath 场景，不能算 provider 覆盖；新增 `reorder.behavior.spec.tsx` 真实 provider 注册/连续跨两邻居/最终 prefs 持久化，foreign id/缺测量忽略 | 明确布局值，直接驱动公开 drag context；Motion 指针到 context 的驱动不在该例 |
| `markFilter/reorderCore.tsx` | provider context/hook 的合同入口 | 同一 provider spec 经正式 hook 读取拖拽状态/order；没有为仅转发 context 的代码单独重复断言 | provider 外默认行为不是用户主流程 |
| `markSelector/markSelector.tsx` | 展示 type 计数/状态，选择行为兼容 Binder 与窗口化 | 原 `measureQueue.spec.ts` 只覆盖 coalesce/隐藏文本测量；新增 filters/sidebarFilters integration 真实点击、显示计数、重复出现同 type 同步、虚拟行挂载后与 SelectionLayer 互通 | 实际浏览器字体溢出/字宽由显式布局替代，无视觉结论 |
| `notify/notify.tsx` | 弹窗按会话载入两 feed、实时项合并、阅读/批量已读、导航 | 原 read spec 已有 IO dwell/可见性/批量序列，message spec 已有语言/类别语法；新增 `notify.spec.tsx` 补游客入口、首次载入/分页去重/tab、旧 list 不覆盖实时消息、阅读导航/一次关闭、失败≠空/重开恢复、切账号旧list/markAll隔离，同批次重登/ABA重新加载和解除旧忙态 | transport/marker lookup/实时通道模拟；真实 feed/card/Modal/read batcher；旧账号锁修复见下表 |
| `regSwitch/regSwitch.tsx` | 用户意图预热目标资源，导航必须等待目标准备，地区/子地区菜单独立 | 既有 `regSwitch.spec.tsx` 已覆盖 keyboard/padding、touch/outside、guide force、退出 inert、目标数据/font 预热、较新请求胜出、失败重试、跨地区子请求 prepare；有效保留 | 模拟数据下载与字体，不把资源预热 call 视为实际网络完成 |
| `scale/scale.desktop.tsx` | 桌面 +/-、区域名称、比例/PiP 控制受地图边界约束 | 新增 `scale.spec.tsx` 使用真实 Leaflet 验证 zoom 上下限/区域事件/PiP 回调，比例条坐标钳制 | PiP 系统窗口 API 模拟；真实系统窗口另需浏览器 |
| `scale/scale.mobile.tsx` | 滑动连续 zoom，结束应用最后触点并 snap，暂借地图 dragging | 同 suite：最终触点 flush/snap、cancel/响应式卸载恢复借用的 dragging 状态；原先已 disabled 不得启用 | 触摸坐标合成；相同cleanup依赖map的实现已阅读，但未单独执行换map；修复原拖动锁丢失，不改变缩放手势意图 |
| `scale/scale.tsx` | 根据响应式设备选择尺度控件 | 同 suite 实际 desktop/mobile 两种公共入口，参数/地图事件送达正确组件 | 设备 hook fixture；断点测量有 platform 专项 |
| `scopeIndicator/ScopeIndicator.tsx` | 显示当前子区域过滤提示，恢复全部区域不更改 marker type | 新增 filters integration：status 文字、点击清 scope、类型 filter 原样、无 scope 隐藏 | 地区数据使用正式索引；布局未做视觉比较 |
| `search/search.desktop.tsx` | 桌面受控搜索入口接正式查询 store | 根任务新增 `search.spec.tsx`：真实搜索引擎、类型组 toggle、唯一点导航、大小写/空白、Enter 阻止 form submit 保留 query/filter | marker/search index 为小 fixture；实际导航 service 模拟 |
| `search/search.mobile.tsx` | 移动搜索共享同 query 和结果模型，承接显式宽度 | 同 suite：移动/桌面切换共享 query、档案高亮、地区计数、宽度；SideBar mobile 测试验证 query 使 Drawer 从收起到 level1 且不压低 level2 | 侧栏例模拟 search 子树；query→drawer 使用正式 store |
| `search/search.shared.tsx` | debounced 搜索结果、来源回退、滚动渐隐；旧请求不越过新 query | 同 suite：marker fallback 保留 Wuling 地区归属、fallback 失败持续重试/停止、query 变化窗口旧响应不发布、空白关闭、0结果、边缘 mask | 根任务实施；本子任务的集中命令明确排除 search，结果由根任务汇总 |
| `settings/settings.tsx` | 真实 UI/地图偏好和主题入口，存储区及短键说明装配 | 新增 `settings.spec.tsx`：Trigger 更新正式 prefs/aria-pressed；显式 theme/system follow；挂载真实 StorageSection/TreeMap | theme apply/system subscription 外部副作用模拟；快捷键行为沿用 platform 专项 |
| `sideBar/selectionLayer.tsx` | 在虚拟列表上跨行框选，scroll 后新增行仍参加 | 原 useDividerDrag/windowStore 不能证明 selection 互通；新增 `sidebarFilters.spec.tsx` 真 SidebarWindow/SelectorRows/SelectionLayer/useBoxSelection：显式网格选择前行，scroll 后选择第19行，observer 释放 | PointerCapture/几何 fixture；浏览器 auto-scroll 惯性未测 |
| `sideBar/sideBar.desktop.tsx` | 用户意图准备内容、开合通知一次；宽度拖动和列数受边界约束 | 原 `sideBar.spec.tsx` 仅字体区域监听；新增 `layout.behavior.spec.tsx`：真实 desktop/Trigger/windowStore、intent→open、onToggle一次、宽度clamp/columns、捕获释放 | 侧栏内容和账户子树模拟；不重复 shared frame 的全路径 |
| `sideBar/sideBar.mobile.tsx` | Drawer 承接 store level；搜索抬起收起态，不降级已展开态，隐藏不交互 | 新增同 suite 真 Drawer：query 将 level0→1(440px)，level2(680px)保留、divider隐藏、hidden inert；hydration fixture 明确 ready | 真 Motion 使用真实 timer；合成触摸不证明系统多指顺序 |
| `sideBar/sideBar.tsx` | 只渲染当前响应式侧栏，保持共享 store | 同 suite 验证桌面/移动互斥，原 font-region 监听跨 document swap/coalesce/cleanup 保留 | device fixture，只验证分支合同 |
| `sideBar/sidebarFilters.tsx` | 由 region/search/admission 生成分类、绑定、新类型与档案候选 | 既有 `model.spec.ts` 保护模型；新增 `sidebarFilters.spec.tsx` 真数据模型/计数/store/分类/SelectorRows：prepared 才入场、version-new/normal 同 type 状态一致、archive Hub安全链接、binder 子项隔离、region/query 隐藏保留 filter | 小型类型/点位/diff fixture；不将 fixture 数量认作线上总数 |
| `sideBar/sidebarWindow.tsx` | 虚拟窗口订阅 scroll/尺寸，仅渲染可见行并允许框选层读取 | 原 windowStore spec 已有几何/锚点/pinning；新增真实 SidebarWindow+SelectionLayer 集成验证初始行、scroll 后行与选择/observer 清理 | react-window 使用正式实现，滚动指标显式输入 |
| `storage/storage.tsx` | 高风险清除需800ms后再确认；选中/全部/marker范围独立，导入导出正式store | 新增 `settings.spec.tsx`：未选中禁用；过早点击不删除、外点取消、延迟确认；marker-filter/points-storage 次序与精确 key；叶节点原始id清除；导出实时store；FileReader文件/空选择、导入回调更新真实进度/筛选/selected并清input | storage destructive service 与 parser/confirm 为边界；刻意阻止 `location.reload`，不声称浏览器实际删除或刷新已测 |
| `storage/treeMap/treeMap.tsx` | D3 层级浏览，显示实际字节，删除必须用原id而非格式化显示名 | 同 suite 执行真 D3：flat leaf 选择传 StorageSection；nested group→URL leaf 原路径、MiB/B 真实量而非面积clamp后的值 | jsdom缺SVG transform interpolation；只中断视觉transition后清fixture，不声称缩放动画/真实浏览器存储读取已验证 |
| `uiOverlay/UIOverlay.tsx` | 统一页内浮层、引导/公告顺序、UI隐藏和账户通道生命周期 | 新增 `UIOverlay.spec.tsx`：真实 HeadBar/controller/prefs/auth，intent面板、隐藏清空、compact显示UI、guide ready后未读仅auto一次、share link抑制但手动仍开、PiP/移动限制、账号监听清理/旧回调忽略 | 下游面板/geo/announcement/live API模拟；各真实面板由自身suite覆盖；retry用正式hook |
| `uploader/uploader.tsx` | 图片列表/Viewer/Carousel共享选中状态，写操作仅属于当前点和账号 | 既有 pointImages/upload hook 验证按需、同点tab复用、会话/点位旧返回与上传生命周期；新增 `uploader.spec.tsx` 真Viewer/Carousel/ActionBar：游客/paste入口、轮播分享、vote debounce/rollback/quickoff、recall延迟确认/回滚、账号切换取消队列/旧返回忽略、点位ABA/同uid重登旧recall隔离 | transport/clipboard/paste文件识别边界模拟；浏览器文件选择和远端图片不下载；root加强scope身份/sessionVersion |
| `userGuide/UserGuide.tsx` | 自动仅intro；详细Help从未完成处继续；force UI状态生命周期明确 | 新增 `UserGuide.spec.tsx`：桌面/移动intro、intro不误完成详细steps、Help resume、UI隐藏暂停、详细skip清强制侧栏/HeadBar、ready通知 | 仅Joyride第三方driver模拟，实际step控制/store运行；真实tour定位在浏览器验证 |
| `userGuide/spotlight/spotlight.tsx` | spotlight绑定当前target，目标消失移除box，点击遮罩推进，inactive不得误推进 | 同 suite 直接挂真实 GuideSpotlight：显式目标rect、目标删除、active点击推进/inactive点击不推进 | 几何fixture；视觉光圈与自动滚动不由DOM测试证明 |
| `userGuide/tooltip/tooltip.tsx` | intro和详细引导工具按钮与进度对应，委托Joyride回调 | 同 suite 直接挂真实 GuideTooltip，验证intro/详细按钮、步骤进度与callback | driver callback为fixture；不模拟用户点击不存在的第三方DOM |

## 已有 spec 的边界审查

- 评论保留 `Comments.spec.ts`、editor/markdown/spoiler、commentContext、commentLink 和 translation suites。它们原来能保护格式、分享、链接、emoji、翻译并发和 IME，不能替代认证提交/编辑失败回滚/账号换入换出的验证，因此新增真实父子链路，而非复制格式断言。
- 通知的 `notificationRead.spec.ts` 已有 IO dwell 阈值、visibility/cancel、batch 去重/序列/flush；`notificationMessage.spec.ts` 覆盖类别和语言复数语法。新增 Modal/feed/API竞争测试承接这些基础合同。
- `regSwitch` 的慢请求/新请求胜出/失败重试、`layerSwitch` 的键盘/外点/地区隐藏既有断言直接有效，保留，不为全文件列表再写浅 smoke。
- `reorderContext.spec.ts` 虽名为 context，实测的是 reorderMath；`markBinder.spec.tsx` 只有 remeasure；`measureQueue.spec.ts` 只有测量调度。新 provider 与真实 selector/binder/window selection 集成分别填补这三个缺口。
- 侧栏原 `model`、`windowStore`、`useDividerDrag`、`sidebarIconPrefetch` 分别保护候选/窗口/拖动取消/预热限流，本轮仍运行。新外层开合、移动Drawer和实际可见行框选没有把这些底层模拟成始终成功。
- 地图原 `visual`、`useMarker`、`useLink`、`behaviorScene`、`cubicSpline`、`BehaviorCanvasLayer`、`useMapSupplements`、`locatorRecovery` 保留；新增壳、context menu和preview测试只填用户交互/资源时序缺口，不改变渲染内核。

## 缺陷与产品确认到回归证据

| TEST-ID | 触发与修前证据 | 最小修复/当前保护 |
| --- | --- | --- |
| TEST-ANNOUNCE-CLOSE-001 | 按钮/Escape/遮罩真实关闭路径分别调用 `onChange(false)` 两次，3个诊断均失败 | 移除关闭handler中重复通知，由Modal唯一委托；三路径均断言一次 |
| TEST-SCALE-LOCK-001 | 连续zoom后卸载未恢复原已启用的地图dragging；取消手势反而启用原本disabled地图，2例失败 | 手势开始记录原状态，只归还自身借用的锁；end/cancel/响应式unmount回归保护；map依赖复用同一cleanup |
| TEST-LOCATOR-PENDING-001 | 绑定未返回时原实现仍可Escape/遮罩关闭或切provider，可能丢失操作上下文 | 用户明确请求期间禁止关闭和切换；Modal入口、handler和TabView原生disabled共同约束；失败/完成恢复，并验证成功能正常onClose |
| TEST-NOTIFY-ACCOUNT-001 | A的markAll待返回，切B后旧忙态阻止B操作，旧响应可改B状态；同批次重登/ABA最终uid相同，初版uid-only effect未重置，追加2例实际失败 | 以会话revision+正式store的sessionVersion校验入口、flush后与响应；version变化重建feed/batcher并解除旧锁，卸载使revision失效；旧finally不得覆盖新会话 |
| TEST-GUIDE-STATE-001 | 移动Help详细流程skip后 `forceHeadbarExpanded` 残留true，用例失败 | finish/skip时清除详细guide借用的全部force UI状态；auto intro流程保持 |
| TEST-UPLOADER-SCOPE-001 | 旧点/旧账号的debounce或recall/vote返回可回写当前images；仅字符串scope不能阻止A→B→A | task清理、scope identity + auth sessionVersion共同检查；根任务最新两例在旧实现都实际失败：旧recall恢复旧snapshot、或重新打开viewer。修前日志 `/tmp/atlos-recall-before.log`；集中suite包含这两例 |
| TEST-COMMENT-OWNER-001 | 评论组件只按point管理本地action/乐观snapshot，换账号同point可继承旧pending或投票任务；初版point+uid key在同批次重登/ABA保留旧draft，追加2例实际失败 | CommentsPanel按point+uid+sessionVersion拥有生命周期，pending按publicUid筛选，submission error附ownerUid；旧action任务Map清空后返回不能重排任务；真实账号切换及重登/ABA用例验证 |
| TEST-COMMENT-RESTORE-001 | 编辑API立即拒绝，父组件恢复的draft被延迟的Lexical clear OnChange覆盖；真实Comments集成稳定失败 | controlled同步使用专用update tag及discrete更新，不回声外部值；编辑器专项clear→restore和真实编辑失败回滚同时保护，保留正常user/IME更新 |
| TEST-LOCATOR-EPOCH-001 | host卸载后旧exchange仍发bind；bind已发后卸载、同uid重登、ABA仍会cache/applyRole/onBound，4例修前失败 | 请求持有mounted lifetime+request id+正式sessionVersion；每个await边界检查，旧exchange不继续写、旧bind结果不影响当前定位或回调；session/open变化重置本地表单 |

根任务负责的搜索Enter、搜索旧响应/回退、动态加载持续重试等变更与用户确认记录在 [TESTS](TESTS.md)。上表没有将故障注入误写为线上事件。当前没有尚待用户决定的页面产品取舍；真实浏览器边界作为验证限制保留，不能写成已测通过。

## 验证记录

- 前一轮页面集中运行 50 文件、242 例通过，exit0；当时搜索 exclude 未加引号被 shell 展开，实际包含搜索suite，因此不把该数字作为最终排除范围的数量。其后新增 provider/滚动渐隐/存储嵌套与导入，以及root的两条上传ABA回归。
- 一致性诊断：`pnpm exec vitest run src/pages/detail/comment/Comments.behavior.spec.tsx src/pages/notify/notify.spec.tsx src/pages/locator/LocatorFlows.spec.tsx -t 'batched|host unmounts|pending bind completion' --maxWorkers=1`，修前3文件8例全部失败，日志 `/tmp/atlos-pages-epoch-before.log`；保留同一批测试进入最终集中验证。
- 最终页面集中运行：`pnpm exec vitest run src/pages --exclude 'src/pages/search/**' --exclude 'src/pages/MapPage.spec.tsx' --maxWorkers=1`，**50文件250例通过**，exit0，29.32s；日志 `/tmp/atlos-pages-final.log`。含原失败8条epoch用例、上传2条ABA、存储路径/导入、provider/滚动边缘；无跳过用例。一次既有 NotificationMessage React key warning 保留可见，未屏蔽。
- Typed ESLint：从 `git ls-files --modified --others --exclude-standard -- src/pages test-support/pages.ts` 选取 `.ts/.tsx`，排除 `src/pages/search/`、`MapPage.tsx` 及其spec，对34个新增/修改文件执行 `pnpm exec eslint <这些文件> --quiet`，exit0，无错误。全站type-check由根任务统一执行，本页面子任务不将其未完成结果写为通过。
- 根任务首次 `pnpm check` 停在主站 TypeScript：新增spec有 HTMLElement.disabled 类型缺失、模拟SessionUser缺nickname和一条未用type import。修复为明确 `getByRole<HTMLButtonElement>` 泛型与完整用户fixture，保留所有断言；随后 `pnpm exec tsc --noEmit --project .` exit0，受影响6份spec再执行typed ESLint exit0。首次check不记为通过，完整pipeline结果由根任务回填。
- 本子任务没有提交或推送。根任务在完整验证后按目的组织本地提交；性能基线尚未执行。
