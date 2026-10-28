# 中枢档案第二轮复核

本轮未新增可确认的任务解锁关联。保留“祖泉 → 泉中客·其三”及“醒时钟检修日志 → 钟鸣人归·余音”的任务指引。

其余 60 条中枢档案按要求恢复显示“推进主线以解锁”，并使用原有的自动解锁分类标签。底层 `unknown` 继续保留未定位来源的事实，便于以后补充资料；该显示默认值不作为主线发放已确认的证据。

## 本轮新增检查

- 将剩余 60 条档案的档案 ID、`firstLvId`、`contentId` 交叉检索于 AKEData/Json、EndfieldData-main/Json 和全部 634 个 PUB1.6 解码场景，未找到实际发放关联。
- 进一步解析 AKEData 中 54 个包含 PRTS 的 JSON 文件：只有 43 个 `CheckPRTSUnlocked` 和 1 个调查阅读检查；404 个 `prtsId` 值均为字符串，未发现通过数值档案 ID 绕过字符串检索的关联。
- 解析 32 个包含 PRTS 的原始场景文件，368 个 `prts/prts_id` 属性使用字符串绑定。看似数字档案 ID 的 `1033/1029` 属于属性编号映射。
- 补查 `hidden20`、`hidden21`、`hidden25`、`hidden26` 和 `hidden47_prtsv1d2unlock`：客户端动作表和属性表均为空；任务完成检查本身没有包含档案发放对象。
- `WikiEntryDataTable` 的 52 个档案引用指向“天使”“裂地者”“清波寨”三条中枢档案，但引用关系本身没有提供解锁任务。

代表性结构证据：

- [CheckPRTSUnlocked 的参数是字符串列表](</Users/canvas/_Code/Preview Repos/AKEData/src/Gameplay.Beyond/Beyond/Gameplay/CheckPRTSUnlocked.cs:30>)。
- [PRTSSystem 的解锁入口接受字符串 ID](</Users/canvas/_Code/Preview Repos/AKEData/src/Gameplay.Beyond/Beyond/Gameplay/PRTSSystem.cs:63>)。
- [prts_id 的属性编号映射](</Users/canvas/_Code/Preview Repos/AKEData/Json/Interactive/InteractiveData/data_int_narrative_unlockreward.json:1021>)。
- [原始场景中的 valueString 绑定](</Users/canvas/_Code/Item Repos/endfield-bots/scene/input/origin/PUB1.6_decoded/map01_lv007/map01_lv007_lv_data_sub_env.json:97>)。

## 外部资料复核

[全档案收集视频](https://www.bilibili.com/video/BV1TMcAzBEbY/)的搜索索引有一个 11 秒的“迷踪林与竹林虫”片段。页面、API 和浏览器访问失败，尚未核对画面中的解锁提示，因此仅保留为待核验线索。

[虫不语·尾声](https://warfarin.wiki/cn/missions/sm2l1m4)提供竹林虫和迷踪林的剧情关联；[迷踪林与竹林虫](https://warfarin.wiki/cn/lore/nar_document_v0d8_17_1)、[藏剑谷](https://warfarin.wiki/cn/lore/nar_document_v1d3_2_1)、[兽主](https://warfarin.wiki/cn/lore/nar_document_v1d5_3_1)、[众生长地](https://warfarin.wiki/cn/lore/nar_document_v1d2_2_1)的正文资料均未提供可确认的获取任务。这些剧情关联未写入任务绑定。

第一轮的完整候选及文本键见 [任务来源审计](intel-mission-audit.md)和 [JSON 记录](intel-mission-audit.json)。
