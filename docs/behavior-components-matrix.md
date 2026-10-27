# 共享组件职责、功能与行为证据

范围是 `talos/src/component/` 的 **36 个生产 TSX**，同时列出文件内对外导出的子组件与直接依赖的生命周期 hook。状态 owner 及跨组件写入关系见 [状态映射](behavior-state-map.md)，主站页面和独立 app 各有自己的职责矩阵。组件测试不能替代完整入口的交互验证。

## 阅读方式

- **职责**：组件对用户负责的结果，不把样式文件或“调用了某函数”当成职责。
- **功能/状态/事件**：当前实现需要保留的行为集合；忙碌、空、禁用、关闭与退出阶段只在适用的组件中列出。
- **副作用/时序**：读写的 owner、异步和动画打断规则、资源释放要求。
- **自动化证据**：已检查的 spec 与有意义的输出断言。`已覆盖` 仅指该单元格列出的行为，不能推导未列出的任意输入/浏览器组合。
- **浏览器边界**：本文件的组件/DOM验证运行于 jsdom；真实入口与 Chromium 的结果由 [TESTS](TESTS.md) 统一记录。存在真实视觉或原生交互时，不以 jsdom 里的属性值宣称浏览器表现已验收。

以下路径相对 `talos/src/component/`；`../` 指 `talos/src/` 中对应的其它模块。没有为纯展示 wrapper 构造重复测试，也没有把 inactive 组件改为默认激活。

## 基础交互与浮层（19 个文件）

| 编号 / 组件文件 | 职责 | 功能、状态与事件 | 副作用与时序 | 有效自动化证据 | 浏览器/剩余边界 |
| --- | --- | --- | --- | --- | --- |
| C01 `button/button.tsx`：Button | 提供统一视觉的原生按钮 | normal/icon/square；next/prev/close/confirm外观；light/dark、装饰、数字/字符串尺寸；原生 disabled/type/ref/aria 和 owner click | 无自有异步状态；默认 type=button；显式原生属性可覆盖默认 | `button/button.spec.tsx`：ref、可访问名称、type/disabled、尺寸与变体；Modal/确认/支持入口使用真实按钮 | 原生键盘激活与实际命中区域在浏览器验证；视觉图标/CSS不是 DOM断言的结论 |
| C02 `button/IconButton.tsx`：IconButton | 为图标动作保留按钮语义 | label、可选 pressed、icon/children；原生 ref/type/disabled 透传 | 无独立状态；操作、权限与异步 pending 由调用方控制 | `button/button.spec.tsx`；`actionBar/behavior.spec.tsx`、`viewer/viewer.spec.tsx` 断言禁用阻止实际动作、pressed 与显示状态一致 | 无独立动画 owner；浮层中的焦点和触控在完整浏览器链路验证 |
| C03 `button/EntryButton.tsx`：EntryButton | 呈现带平台/目的地标识的入口 | label、可选平台图标、children、原生属性；默认非提交 | 不发网络请求、不自持账户状态 | 基础 button suite +真实 OAuth/冲突/账户组件组合；点击、禁用与对应结果关系 | 外部导航/真实 OAuth 不由入口按钮单测证明 |
| C04 `trigger/trigger.tsx`：Trigger / TriggerBar | 呈现并请求 owner 切换布尔选项 | controlled isActive、无 handler、label、disabled；button click 请求反值，阻止父卡片点击和表单默认行为；Bar 负责组合布局 | 不乐观更改 owner 值；无 timer/订阅；onToggle 是否成功由 owner 决定 | `trigger/trigger.spec.tsx`：受控状态、冒泡/提交隔离、无回调/禁用、组合；设置与地图筛选组合使用真实 store | 动画/布局仅 CSS；真浏览器键盘与点击穿透仍按入口路径验收 |
| C05 `searchInput/SearchInput.tsx`：SearchInput | 为独立搜索提供受控输入与结果提示 | 原始 value/onChange；空/全空白不显示计数；ICU复数与locale数字；desktop/mobile/width；Enter 表单不提交 | 不发查询、不改地图/store；owner 负责 debounce/结果；不能代表另一个主站 Search 组件 | `searchInput/SearchInput.spec.tsx`：原始输入、空白/计数、locale、submit.defaultPrevented；Intel App组合验证真实筛选 | 真实浏览器默认导航、IME与移动键盘另验；主站搜索证据见 pages 矩阵 |
| C06 `tabView/TabView.tsx`：TabView | 请求切换选项并标识当前页签 | items 空/当前key缺失/有效key；active描述、fill；禁用→恢复；原生按钮事件由 owner 改 activeKey | 测量 active tab；rAF/ResizeObserver/resize/scroll 驱动指示器，卸载解绑；不自行改变 activeKey | `tabView/TabView.spec.tsx`：受控回调、尺寸/滚动/字体变化和清理、禁用；绑定 busy→可操作组合 | 真字体重排、缩放、CSS指示器动画需浏览器；不存在自动推导的方向键切tab契约 |
| C07 `shortcut/shortcut.tsx`：Shortcut / KeyCap | 展示 owner 已定义的快捷键组合 | 键序、重复文字、mouse chip、1u/2u/3u、mac/non-mac modifier尺寸、scale | 不注册热键、不生成按键名称；纯展示，无任务生命周期 | `shortcut/shortcut.spec.tsx`：顺序/重复标签/平台尺寸/缩放 | 热键是否生效由设置/useShortcuts验证；字形与键帽视觉在浏览器检查 |
| C08 `loading/Loading.tsx`：Loading | 在准备门槛内推进进度并通知完成 | 30ms tick 到 maxProgress；仅100%进入完成序列；desktop/mobile方向；完成回调可更新 | 一个330ms暂停+450ms结束序列；完成只通知一次；卸载/离开100%取消；interval受maxProgress控制 | `loading/Loading.spec.tsx`：上限、持续挂载只回调一次、两个完成阶段卸载均无晚到通知 | 真实CSS结束画面及启动 gate 接线在入口/browser记录；不是首屏性能测量 |
| C09 `feed/Feed.tsx`：Feed | 为长列表提供滚动容器与底部遮罩 | 空/短/长内容；末端容差1px；listRef变更；resetKey改变回顶；子项/尺寸变化重新判断底部 | 监听实际list scroll/transitionend/ResizeObserver与首帧；替换或卸载清理；底部fade由AdaptiveBlur执行 | `feed/Feed.spec.tsx`：滚动边界、复位、尺寸/children/ref变化和释放；notify/hub贡献列表组合 | 真实overflow/字体/滚动条、分页与observer实际视口需浏览器 |
| C10 `carousel/Carousel.tsx`：Carousel | 提供受控循环选择逻辑 | 空→item=null/index=-1；单图；未知/缺selectedKey回首图；两端循环 previous/next；getKey与children render状态 | 无DOM或异步owner；仅通知新key；不下载图片、不确认图片已解码 | `carousel/Carousel.spec.tsx`：空/单/未知key、循环与受控；Viewer套件验证图片、元数据和动作随选图同步 | 解码、图片尺寸与轮播触控属于Viewer/浏览器，不给纯逻辑组件重复视觉结论 |
| C11 `modal/modal.tsx`：Modal / ModalTabs | 承载受控对话框、关闭策略与页签操作 | closed→entering→open→exiting；可保留退出DOM；close/mask/Escape策略、IME Escape不消费；标题/quickAction/disabled tabs；横向滑动tab、竖向/取消不切换 | usePresence双帧进入/延迟退出；受控onClose/onChange；顶层浮层优先、focus trap/恢复、滚动锁；portal换document迁移owner；tabs用局部像素测量 | `modal/modal.spec.tsx`、`modal/overlays.spec.tsx`；`../lib/dom/{overlay,useOverlayLayer,usePresence}.spec.*`：退出重开同节点、仅通知一次、stack、焦点循环、锁和跨文档；定位绑定组合测试busy策略 | 当前duration需与真实CSS对齐；原生inert导致焦点变化、top layer、手势中断与真实布局必须由浏览器证明，不能只数两帧/325ms |
| C12 `viewer/viewer.tsx`：Viewer | 展示当前图片及其来源与可操作动作 | URL未就绪不入场；单图/多图与轮播命中区域；load skeleton；作者/时间/票数/状态；游客/own/pending/recallOnly、busy、分享/追加上传；关闭中重开 | selectedImageId受owner控制；ImageUrl改变复位loaded；图片动作委托owner；独立modal浮层/300ms退出；退出不卸载下层modal，不提前解scroll lock | `viewer/viewer.spec.tsx`、overlays与uploader组合：选图与元数据/权限同步，禁止动作不会触发，退出重开/堆叠focus；真实上传失败scope回滚另见pages | 主任务五project的 `TEST-BROWSER-OVERLAY-001`已验证真实图片/切图、Escape仅关顶层、保留下层滚动锁并恢复两个opener焦点；cleanup前短暂BODY不是最终焦点失败。具体引擎/视口与真机边界见浏览器基线，不外推任意平台 |
| C13 `popover/popover.tsx`：PopoverTooltip | 在原生Popover层展示上下文提示 | 无内容/禁用直接返回children；hover/keyboard focus开启；touch不触发hover；激活先关闭但保留原handler；受控visible；四向/first-line定位；child ref与aria合并 | rAF位置与ownerWindow resize/scroll；tooltip/anchor ResizeObserver及所属fontregionchange重新限制位置；120ms退出；关闭重开取消旧退出；overlay/font owner取消与停止；children ref清空也释放注册 | `popover/popover.spec.tsx`、`popover/behavior.spec.tsx` + Modal组合：原事件/ref、边缘clamp、disabled/empty/unmount、显式受控与重开、Esc优先级 | 原生Popover API/样式/焦点呈现是浏览器边界；不据mock open状态声称top layer真实通过 |
| C14 `popover/OverflowPopoverText.tsx`：OverflowPopoverText | 仅在文本实际溢出时提供完整文本 | span/div；scrollWidth > clientWidth+1才启用；文本/尺寸/字体变化重测；宽度恢复后撤提示 | ResizeObserver或resize后备；FontFaceSet.ready与fontregionchange；清理后忽略字体晚到 | OverflowPopoverText suite +真实Popover组合验证阈值、复位、字体区域事件与解绑 | 真字体、缩放、换行和节点在不同document的尺寸依赖浏览器 |
| C15 `contextMenu/ContextMenu.tsx`：ContextMenu | 呈现有分组/紧凑行的上下文动作 | disabled/danger/keep-open；空菜单；方向/Home/End跳过禁用循环；Tab/外点/Escape/resize关闭；native API失败fallback；reduced motion分支 | ownerDocument portal与focus恢复；Motion存在阶段退出仍inert；viewport clamp与transform origin；自己不执行业务写入 | `contextMenu/ContextMenu.spec.ts`、overlays、MapContextMenu组合：动作结果、导航、fallback、外点、退出；业务批量/确认另见pages | 真实popover/native focus/Motion中间帧与屏幕边缘命中需browser；reduced motion非UI性能偏好同义词 |
| C16 `actionBar/ActionBar.tsx`：ActionBar | 把一组短动作接入卡片或当前选区 | separate/grouped/floating；disabled/pressed/confirming；受控anchorRect或hover/focus/touch-pinned；激活不触发卡片；浮动动作保留编辑焦点；outside/blur/hidden关闭 | 120ms退出、rAF位置；ownerDocument迁移；选区重开取消退出；**旧blur延迟不能关闭新受控浮层，卸载清其延迟**；modal取得所有权先退出不相关浮层 | ActionBar lifecycle/behavior +overlays：真实控件与焦点；本轮新增old-root-blur→controlled选择及focus任务卸载回归，修前失败 | 实际native top layer与跨document portal、真实选择/编辑器的完整路径由browser/Comments补证；固定非空anchorRect是持续打开请求 |
| C17 `drawer/drawer.tsx`：Drawer | 将抽屉尺寸命令和触摸拖动统一到snap | 四方向、px/rem、无序/重复snap归一；handle循环；imperative snap、原尺寸更新保持已打开状态；内容滚动/控件/ignore区优先；禁用；实际progress/snap通知 | Motion拥有snap动画，**接受拖动时停止旧动画**；中途disabled释放gesture状态并恢复原touchAction/overscroll；释放后归snap；卸载stop动画；rAF/rem observer清理 | drawer suite +共享/主站mobile sidebar组合；本轮两例修前失败：disabled后drag标记残留、持指时旧snap动画把约196px改回100px；现验证拖动/禁用/下一手势及真实Motion尺寸 | 原生touch合成/滚动惯性/横竖屏仍需browser或真机；data-snap是0.5px邻近通知，不能当作动画已结束 |
| C18 `banner/banner.tsx`：Banner | 显示可关闭提示并区分用户关闭与owner隐藏 | open/content受控；用户dismiss后退出；prop关闭保留旧内容完成退出；新open/content重置dismiss，取消过期关闭通知 | usePresence 200ms退出；只在用户请求关闭完成后onClose；无业务写入 | `banner/banner.spec.tsx` +定位/Domain组合：关闭中重开、旧内容保留、props关闭不伪装用户关闭 | 真实进出过渡与内容高度跳变需browser；onClose不是点击当帧通知 |
| C19 `effects/AdaptiveLinearBlur.tsx`：AdaptiveLinearBlur | 按模式为滚动viewport提供两端渐隐 | normal渐进模糊；性能/Firefox mask；top/bottom合成；visible、strength/falloff；真实fade高度变化 | mask CSS变量与ResizeObserver；250ms WAAPI；结束后按两端值移除mask；**替换/卸载解除旧onfinish并cancel，迟到完成只能处理本动画** | blur suite：双边数值、尺寸、normal切回、关闭后保留到完成；本轮替换动画的迟到onfinish原使卸载cancel丢失，回归现保护新动画cleanup | WAAPI为可控边界，迟到通知是故障注入；浏览器实际合成/自定义属性动画、Firefox能力和像素效果仍需对应浏览器 |

## 账户、站点外壳、同步与内容（17 个文件）

| 编号 / 组件文件 | 职责 | 功能、状态与事件 | 副作用与时序 | 有效自动化证据 | 浏览器/剩余边界 |
| --- | --- | --- | --- | --- | --- |
| C20 `shared/ErrorBoundary.tsx`：ErrorBoundary | 隔离单个渲染子树失败 | 正常children；失败fallback/null；onError或console；resetKeys逐值Object.is变化才恢复 | React同步渲染边界；不捕获事件/网络回调错误；相邻工具继续存在 | ErrorBoundary suite：子树隔离、fallback/onError、相等新数组/NaN/数量变化 | 无自有浏览器/动画状态；完整入口验证实际边界装配，不把Promise错误交给它处理 |
| C21 `shared/account/access/access.tsx`：Access | 提供登录、注册、密码恢复的输入与反馈UI | 邮箱/密码/重复密码/OTP校验与sanitize；首次/延迟hint；IME Enter不提交、合法Enter一次提交；OTP格式/冷却；自动提交去重；reset link/token；OAuth忙态；关闭/切mode | 表单controller拥有传输；Access拥有校验/auto-submit/OTP计时，关闭/卸载清相应任务；用户确认允许请求中关闭，认证可后台完成 | Access suite +实际IDCard/controller：DOM事件、输入边界、submit去重、冷却失败/恢复、关闭取消auto-submit；本轮controller补UI owner | 密码管理器、浏览器自动填充、真实输入法与OAuth重定向另验；表单与后端状态机不是同一owner |
| C22 `shared/account/idcard.tsx`：IDCard | 主站账户入口与认证/个人资料装配 | authReady前无动作；游客按onceLogin选登录/注册；已登录头像先开原Profile；资料编辑/头像/退出；卡片hover入口 | 真实auth controller/Access/Profile组合；card自身hover角度rAF，跨零度/多圈后离开及重入均取最短角差，卸载取消；外部OEM auth/account事件监听 | idcard/controller suite：真实入口、事件、保存清洗、卡片同步；auth UI owner；`useIdCardHoverAngle.spec.ts`真实hook鼠标事件复现并保护多圈后重入260°错误与卸载rAF取消 | 头像→Profile→`/me/`链路须保留；真实字体/倾斜光效/连续转向视觉与外部Location导航不由角度数值断言证明 |
| C23 `shared/account/idcardView.tsx`：IdCardView | 只展示/编辑传入的账户卡模型 | 昵称/id/publicUid/头像/karma/年龄显示开关；受控昵称输入、15字符/字符集提示；ref与avatar回调 | 不读取会话、不发保存请求；用户名输入清洗由controller；无自有异步owner | idcardView suite：展示/隐藏项、头像序号/ref/点击、受控输入约束；Profile组合 | CSS头像资源、字形、缩放/hover外观需browser；本组件不承担云端写入 |
| C24 `shared/account/profile/profile.tsx`：ProfileModal | 个人资料、同步状态和官方导入操作面板 | 修改昵称/头像、保存/关闭保存、退出；同步已完成/dirty/checking/offline/error；忙态禁用；移动full；官方导入同值直接/有差异三选择/未绑定接力/失败重试；头像导航/me | 资料controller与真实progress store；同步提示interval；先关Profile再呈现冲突；官方请求pending去重，未确认前不写数据；头像hover资源 | profile suite +sync/progress.integration：数据与显示结果、忙态、三选择、绑定回调、API失败保留、unresolved静默、selector隔离 | 真绑定/API和云端幂等、真实退出动画接力/卡片光效、`window.location`导航由外部/browser验证 |
| C25 `shared/comments/CommentContent.tsx`：CommentContent / Spoiler | 把评论源安全呈现为格式/emoji/链接 | 普通文本/多种格式/code；安全外链；emoji图像；spoiler各自隐藏/揭示；键盘揭示；隐藏链接第一次仅揭示、揭示后正常激活；content变化重建揭示状态 | 不执行源HTML；spoiler隐藏子树inert；hover/focus的Popover；不执行编辑/发送 | emoji suite、pages spoiler/Comments组合：XSS文本、link rel、独立spoiler、多行、keyboard、嵌套editor不干扰 | 原生inert/长内容换行/first-line tooltip、链接真实导航与字体emoji效果需browser |
| C26 `shared/language/language.tsx`：LanguageModal | 事务式切换主站及app语言 | 所有支持语言radio；active行点击无操作；intent预热不提交；新选择覆盖旧请求；失败保持旧语言可重试；可选prepare/commit/font回调更新 | 同步主站字体/catalog与app目录；400ms当前语言文字冻结；只胜出的选择onSelected；卸载清freeze timer；可选预热拒绝不影响选择 | language suite +三个locale/startup/目录校验：并发、旧响应、失败、更新props、当前语言no-op；各app Header接线另验 | 真实字体加载/闪烁、布局重排、离线恢复与跨tab语言传播需browser；组件静态/动态入口遵循原装配，不擅自默认加载 |
| C27 `shared/siteShell/sideBar.frame.tsx`：SideBarFrame / DesktopFrame / MobileFrame / AccountCard / SidebarFooter | 共享站点侧栏、账户入口与底部工具容器 | desktop开关/宽度/lockedOpen/fixedWidth；contentRef与bottomTools；hidden inert；mobile Drawer；Footer社交/Support；AccountCard按需模块恢复 | width预览不逐帧持久化，释放才commit；cancel/lost capture/unmount回滚；mobile命令↔snap回写；AccountCard retry按生命周期；Footer Modal | sideBar.frame suite：真实桌面store和pointercapture、上限、取消后可再拖、锁定app模式；真实Drawer→store；Footer Support真实进出与安全链接 | 真实响应式布局、窗口/字体缩放、手势竞争和PiP迁移需browser；共享shell单测不等于app完整装配 |
| C28 `shared/siteShell/headBar/headBar.tsx`：HeadBar / HeadItem | 响应式头栏装配与单个动作入口 | desktop/mobile分支；compact只留显示UI入口；HeadItem label/active/disabled/badge；工具动作委托 | 读取device/forceHeadbar；Popover锚点；不拥有各业务弹窗数据 | headBar原suite +behavior：分支、compact可达、disabled/active/badge与tooltip锚点 | 设备识别/实际viewport和命中区域、浮层与主站隐藏UI整链须browser |
| C29 `shared/siteShell/headBar/headBar.desktop.tsx`：HeadBarDesktop | 桌面玻璃渲染并保留操作 | normal LiquidGlass /性能fallback；compact padding/children | 无独立业务状态或任务；模式变化改变渲染子树 | headBar.behavior执行两个分支的相同可达/禁用合同 | LiquidGlass测试为边界替身；真实GPU/玻璃视觉与padding动画需browser，不能据JS分支断言画面相同 |
| C30 `shared/siteShell/headBar/headBar.desktop.fallback.tsx`：HeadBarDesktopFallback | 性能模式桌面容器 | children、compact、稳定guide锚点 | 无自有计时/网络；样式过渡由CSS | 上述behavior真实fallback参与，按钮保留且disabled生效 | 样式/尺寸与切模式连续性需browser；无独立业务状态机 |
| C31 `shared/siteShell/headBar/headBar.mobile.tsx`：HeadBarMobile | 可展开的移动头栏 | 内部expand；forceExpanded true/false/null；compact覆盖展开；内点不收、外部mousedown/touchstart收；normal/性能fallback | 外部关闭监听仅展开且非force时注册；卸载解绑；切fallback由fallback维护自身状态 | 参数化headBar.behavior覆盖双分支、内外点、force、compact与监听释放 | 真多点触控/键盘/安全区和模式切换中的实际展开外观需browser |
| C32 `shared/siteShell/headBar/headBar.mobile.fallback.tsx`：HeadBarMobileFallback | 性能模式保留移动操作合同 | 内部/强制/compact展开与关闭入口；只展示可用children | 与normal相同的外点监听生命周期，无网络 | 同一参数化移动场景执行真实fallback；禁用force toggle | 真实高宽动画/触控与normal视觉差异需browser；不声称两分支共享一个内部state实例 |
| C33 `shared/support/support.tsx`：SupportModal | 展示支持说明并导航目的地 | 受控open；按钮/Escape/遮罩委托关闭；三目的地；说明来自locale | 原生window.open `_blank`+noopener/noreferrer；Modal完成退出；不记录“已看版本” | support suite与Footer组合：真实Modal关闭和每个目的地参数 | 不访问或提交外站；真实弹窗拦截/外部页面不属于本地验证 |
| C34 `shared/support/SupportAutoPopup.tsx`：SupportAutoPopup | 按支持提示版本及guide状态决定延迟展示 | 未看版本延迟；guide中等待；取消/重启等待；用户关闭记录版本；损坏JSON/错误形状按未看恢复 | localStorage容错；只保存字符串版本；卸载清timer；主站当前未启用该入口 | support suite：延迟、取消、重挂载不重复、坏偏好、关闭保存、卸载 | inactive入口不伪称完整页面已走过，也不因补测试重新启用；SupportModal视觉仍需browser |
| C35 `shared/sync/ProgressSyncHost.tsx`：ProgressSyncHost | 协调真实点位进度与当前账号云端 | 游客/离线；启动检查、dirty批量同步、same-owner baseline、跨账号差异/空边冲突；local/cloud/merge；legacy/unknown保留；manifest/409/幂等mutation恢复 | uid+正式sessionVersion+mounted lifetime作用于每个await边界；锁有独立owner；旧finally不解新锁；本地应用抑制回声；dirty/visibility/pagehide/online任务卸载清理 | Host suite、progress.integration、store/progressSync与Profile组合：真实store/Modal/选择/payload、ABA/同uid重登/卸载/重试边界，不只看API被调 | 服务替身不证明服务器幂等或cookie；真实跨tab/后台恢复/会话变更和完整shell装配需browser/接口环境 |
| C36 `shared/sync/conflict.tsx`：SyncConflictModal / RegionCountTable | 对比两来源进度并请求用户决策 | point/archive不同namespace；空来源；locale日期/分区；local/cloud/merge由owner提交；纯archive不加载地图；分区加载中与有效空结果不同 | open且需要地图时按需加载；失败持续retry；关闭/卸载停止；不匹配point/type静默忽略；所有来源总数基于已知ID不等待分区明细 | conflict suite +Profile/真实Host三选择组合：namespace、空、统计恢复、取消/重开、最终写入选择关系 | 真数据分布/长地区名布局、native modal/退出接力需browser；自己不保存/上传任何进度 |

## 非 TSX 交互 hook 的边界

这些文件不是额外的视觉组件，但它们实际拥有交互状态和资源，因此不能只清点 TSX 后略过。

| 文件 / 职责 | 合同与有效证据 | 原生边界 |
| --- | --- | --- |
| `selection/useBoxSelectionEngine.ts` / `selection/useScopedBoxSelection.ts` / `selection/useSelectionVisibility.ts` | 框选在合法空白/primary pointer超过阈值后开始；仅可见目标、初始集合toggle、activate优先、帧合并/批量提交；释放/cancel flush，unmount/迁移不提交旧待办，回收capture/文本和滚动策略/rAF。`selection.spec.tsx`验证原有阈值/可见项/取消/迁移，新增activate与toggle交叠仍保留已选及框外项、同一手势回调不含临时错误状态；受控rAF与有界scrollTop验证双向边缘滚动、离屏目标选中、上下限停止和取消后不再滚动。250ms框淡出有计时断言 | capture、几何与浏览器scrollTop钳位为显式fixture，未镜像速度常数；实际滚动速度/惯性、原生PiP与触摸合成仍需浏览器。持续按下穿越真实虚拟行的组合结果见SelectionLayer行 |
| `shared/account/useIdCardAuthController.ts` | 认证服务与会话确认、OAuth callback去重、OTP/密码恢复、资料保存/退出、外部事件；正式sessionVersion防身份过期，独立UI owner防关闭重开/切mode后旧回调及3333ms wipe操作新面板。controller与真实IDCard/Access/Profile组合suite验证canonical session和UI最终结果，不只assert调用 | 后端cookie/真实OAuth不由服务替身证明；页面跳转/原生输入自动填充属完整入口 |
| `shared/account/useIdCardHoverAngle.ts` | 连续指针旋转、120ms进入和150ms离开缓动；当前动画替换/卸载取消；连续角度正规模后按最短转向。hover suite用真实hook+鼠标事件和fake rAF验证两圈后离开/重入及卸载清理 | CSS光效、显示帧平滑度及真实指针采样率不由数值断言证明 |
| `shared/account/useIdCardScale.ts` | shell/card两方尺寸改变后按`min(1,shell/card)`缩放；未测得card宽度暂保留；ResizeObserver与resize后备均解绑。`shared/account/presentation.spec.tsx`验证0.5→1、宽度暂为0和两方observer清理/resize后备 | 使用明确测量fixture；真实字体/侧栏宽度改变的画面连续性需浏览器 |
| `shared/account/useIdCardProfileViewModel.ts` | 等待已知账号时loading；游客GID及旧登录提示；未完成资料显示待分配UID；正式账号群组/日期/karma安全展示。presentation suite走pending→guest→setup→confirmed及未知日期/非有限karma；时间格式化规则另由format/time suite保护 | UA派生GID不是正式身份；不宣称每一个UA哈希值、注册时长随时间自动更新或语言画面的像素结果 |

## 横切生命周期与新回归

| TEST-ID | 输入、输出关系与本轮修前证据 | 修复/证据 |
| --- | --- | --- |
| TEST-DRAWER-INTERRUPT-001 | 触摸持指期间旧snap动画仍把约196px改回100px；dragDisabled后touchend早退保留drag标记/滚动策略，两个新用例修前失败 | 接受手势时stop旧Motion动画；中途禁用释放手势并恢复caller原touchAction/overscroll；相同组件可接受下一手势。原snap策略未改 |
| TEST-BLUR-OWNER-001 | 可控WAAPI边界给已取消动画投递迟到完成回调，使current animation引用被误清，卸载未cancel替换动画；新用例修前失败 | onfinish仅处理匹配动画；替换/卸载先解除handler并清引用再cancel；不把此故障注入写成真实浏览器已观察到的WAAPI事件 |
| TEST-AUTH-UI-OWNER-001 | 用户确认允许关闭并后台完成认证，旧流程不能操作新面板。修前重开/切mode后旧wipe关新面板、旧701写入新表单（4例失败） | UI AbortSignal只取消旧hint/wipe/close/setup及OTP/reset/OAuth准备的UI收尾；login/register仍确认真实session；same-batch close→reopen、unmount立即清wipe、old logout不能清新session；选当前tab不取消有效成功过渡 |
| TEST-ACTIONBAR-FOCUS-001 | root blur的0ms检查晚于新受控选区到来，关闭新toolbar；原卸载也未清自己安排的focus任务，两例最初失败 | 将focus check纳入与close/rAF相同的owner清理；新选区/show与unmount撤销旧任务。全局timer断言使用明确focus事件fixture，避免把jsdom自身selectionchange任务当组件泄漏 |
| TEST-IDCARD-HOVER-001 | 指针连续逆时针转两圈后离开，重新进入350°时扫过260°；新真实hook/鼠标事件测试修前失败260>180 | 连续角度可能小于-360，使用正规模归一到[0,360)，保持已有shortestDelta约束；离开、重入与卸载取消rAF均验证 |
| TEST-SELECTION-OWNER-001 | 把已挂载React根adopt到另一document后，在新window发pointermove仍不进入选择；修前新测试失败false≠true | appDocument变化重绑engine；按container.ownerDocument的window拥有pointer监听/rAF，body拥有文本选择锁；迁移取消旧手势不提交，释放capture/旧body后可在新document正常拖选 |

`usePresence` 的6条既有场景覆盖双帧、退出重开、卸载与跨document帧迁移；`overlay` 的8条既有场景覆盖堆叠关闭、焦点/锁、非顺序卸载和迁移。它们保护的是明确生命周期规则，不能据此推导native inert、原生popover或所有CSS动画都已通过。主任务另执行清洁Chromium的真实浮层焦点链路；临时诊断已全部删除，未因cleanup前的中间采样改变overlay实现。

## 本工作单元的实际验证

- 状态映射与36组件矩阵为源码/调用方/测试断言核对；没有运行生产服务或修改任何线上数据。
- 初次新回归最小复现：Drawer 2例、WAAPI 1例、Auth UI 4例、ActionBar focus 2例、hover连续转向1例、selection document迁移1例失败；逐项追踪后修复，未放宽行为期望、跳过case或更新snapshot。
- 最终组件与DOM集中验证：`pnpm exec vitest run src/component src/lib/dom --reporter=dot`，**43文件252例通过**；涵盖36生产TSX及非TSX交互hook。本lane修改的13个源码/spec文件 **focused eslint通过**。全范围与浏览器结果由主任务在TESTS统一记录。
- 第一次Drawer验证还揭出本测试将手势阈值后的约196px误按应吸附300px处理，已将输入移到大于200px并保留最终300px断言；触摸策略恢复也改用caller的明确pan-y/auto前置状态。不是把旧动画回到100px改成通过。
- 新WAAPI fixture的解绑方法与Auth mock Promise返回曾触发lint错误，改用箭头函数和显式Promise；hover fixture同步act回调改成显式void返回，未加suppression。

所有 browser 列中的原生/视觉边界须与主任务的真实浏览器结果一起阅读；此文档不以每个文件已有一条测试作为整体验收标准。

收口浏览器补充：移动tooltip在真实390px视口右缘达到394.48px，窗口未变而晚到字体改变宽度；补tooltip/anchor尺寸与所属字体区域监听，关闭断开。`popover/behavior.spec.tsx`修前1100>1020、修后位置和清理均通过；真实Chromium移动原例转绿。共享store外部进度与MapPage owner见浏览器基线，最终全范围检查以TESTS为准。

完整check补充：上述43文件在集中入口中共256例通过（此前focused252例后补Drawer交还滚动1例、selection两例、tooltip字体重排1例）；真实虚拟行持续拖选也有正式MarkSelector/筛选store结果断言。五project浮层/指示器/滚动遮罩及三条可信touch的结果见浏览器基线。
