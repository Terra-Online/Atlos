# Intel 任务来源审计

源数据：AKEData `8560ddab96da464c1375052370d611986fd56850`。扫描范围：535 archives、559 missions、5526 levelScripts、1160 levelFiles。

任务中的“已解锁/已阅读”检查是收集条件，不是发放动作；阅读脚本中的任务状态也可能只是前置条件。
下表列出全部中枢档案及醒时钟检修日志的任务线索。剧情中提到同名概念或明确别名仅用于人工排查，不能据此填写获取方式；无候选也不等于自动或主线解锁。
已逐个扫描所有任务中的档案检查、阅读动作及脚本引用，并检查场景中的任务脚本上下文和 Baker 档案引用。百科的引用不作为任务发放证据。
完整的直接引用、脚本路径、文本键和台词样例见 [JSON 审计记录](intel-mission-audit.json)。

## 隐藏解锁任务

- `hidden47_prtsv1d2unlock_q#1` 检查 `e4m1d5_q#3`（四方会议）为 `Completed`。
- `hidden47_prtsv1d2unlock_q#2` 检查 `e6m3_q#2`（穆如清风）为 `Completed`。
- `hidden47_prtsv1d2unlock_q#3` 检查 `sm2l3m3`（泉中客·其三）为 `Completed`。
- `hidden47_prtsv1d2unlock_q#4` 检查 `e6m1_q#8`（惊鸿一瞥）为 `Completed`。

该控制器的客户端 actionMapRaw 为空，缺少其到具体档案的服务端发放边；不能按顺序把四个条件分配给十二个 v1d2 档案。
“祖泉”结合用户核对的泉中客来源，关联 `sm2l3m3`；不虚构任务阶段或地图点位。

## 中枢档案及未确认来源

| 档案 | 直接任务/脚本线索 | 全部同名剧情候选（不是解锁结论） |
| --- | --- | --- |
| 醒时钟检修日志<br>`nar_digital_map02_research11_12_1` | `gm02m27d5` 钟鸣人归·余音（archive_check_not_grant） | 未找到同名任务文本 |
| 泰拉<br>`nar_document_v0d8_1_1` | 未找到发放外键 | `a1m14` 遗失之界<br>`a1m4` 影拓丰碑<br>`e11m1` 长风破浪<br>`e11m6` 拨云见日<br>`e11m8` 余晖未却<br>`e12m1` 入丹青<br>`e12m4` 洞我执<br>`e12m5` 着新墨<br>`e1m5` 庇护之所<br>`e1m9` 开拓前路<br>`e8m1` 水火不容<br>`e8m2` 致命邀约<br>`e8m3` 片缕幻影<br>`e8m4` 静候光临<br>`gm01m11` 漏网之虫<br>`gm02m15` 古崖论剑<br>`sm2l1m4` 虫不语·尾声<br>`sm2l3m4` 夺宝奇兵·其一<br>`sm2l6m1` 藏剑于谷<br>`sm2l8m1` 月往日来 |
| 源石<br>`nar_document_v0d8_2_1` | 未找到发放外键 | `a1m13` 奇境守卫<br>`a1m14` 遗失之界<br>`a1m16d3` 龙泡泡游记·其三<br>`a1m5` 开拓节与特色美食<br>`a1m6d5` 环卫标兵·其五<br>`a1m8d1` 掌中救星·其一<br>`c13m2` 三件小事<br>`c16m1` 追忆之痕<br>`c16m2` 迷失之影<br>`c16m3` 前尘之魇<br>`c16m4` 记忆之灰<br>`c17m1` 迟来的色彩刚刚好<br>`c17m2` 获得的伙伴在身边<br>`c17m3` 笑容连续迭代<br>`c28m2` 公爵与宝物<br>`c33m1` 血色的叩问<br>`c33m2` 必将复还<br>`c34m1` 迷雾藏起松林<br>`c34m2` 噩梦潜入雪地<br>`c35m1` 晨星降临<br>`c35m3` 孤注邀请<br>`db01m1` 蚀像寻遗<br>`e0m2` 进程·复苏<br>`e11m1` 长风破浪<br>`e11m4` 物非人是<br>`e11m5` 异乡归人<br>`e11m6` 拨云见日<br>`e11m8` 余晖未却<br>`e12m1` 入丹青<br>`e12m4` 洞我执<br>`e12m5` 着新墨<br>`e1m2` 谷地重启<br>`e1m3` 重整旗鼓<br>`e1m5` 庇护之所<br>`e1m6` 建立据点<br>`e1m7` 踏破雾火<br>`e1m9` 开拓前路<br>`e2m1` 再度启程<br>`e2m2` 穿越研究园<br>`e2m3` 推开园门<br>`e2m4` 园区穿行<br>`e2m5` 诡楼寻踪<br>`e2m6` 矿脉断章<br>`e2m7` 踏足矿脉<br>`e2m8` 世代摇篮<br>`e3m1` 初入终局<br>`e3m2` 酝酿反击<br>`e3m3` 烙铁灼痕<br>`e4m1` 神秘信号<br>`e4m1d5` 四方会议<br>`e5m0d5` 准备工作<br>`e5m3` 前往武陵城<br>`e6m1` 惊鸿一瞥<br>`e6m2` 东风就绪<br>`e6m3` 穆如清风<br>`e6m4` 潮涌汹汹<br>`e8m1` 水火不容<br>`e8m3` 片缕幻影<br>`e9m4` 当时携手处<br>`f1m18d2` 据点建设·天王坪援建点·二<br>`f1m19d1` 据点建设·心脏修缮站·一<br>`f1m19d3` 据点建设·心脏修缮站·三<br>`f1m29d2` 据点建设·盈天台建设站·一<br>`f1m7d4` 据点建设·重建指挥部·其三<br>`f1m9d3` 据点建设·基建前站·其二<br>`gm01m1` 职责所在<br>`gm01m11` 漏网之虫<br>`gm01m12` 风雨欲来·终<br>`gm01m17` 维修总动员<br>`gm01m22` 尘封旧档<br>`gm01m23` gm01m23<br>`gm02m21` 有家难奔<br>`gm02m26` 后目的地<br>`gm02m27d3` 钟鸣人归·寻“震”<br>`gm02m29` 悬崖下的靶场<br>`m1m27` 拍摄一群蓄水源石虫<br>`m1m34` 拍摄充满活力的蓄水源石虫<br>`sm1l1m1` 无色印记·发现<br>`sm1l1m8` 使命虽小<br>`sm1l2m1` 希望与代价·其一<br>`sm1l2m2` 希望与代价·其二<br>`sm1l6m3` 晚安，大树·其一<br>`sm1l6m4` 晚安，大树·其二<br>`sm1l7m1` 内部敌人<br>`sm1l7m2` 机器人之梦<br>`sm2l10m1` 无终之恋<br>`sm2l3m4` 夺宝奇兵·其一<br>`sm2l3m5` 夺宝奇兵·其二<br>`sm2l3m6` 夺宝奇兵·其三<br>`sm2l4m1` 同袍·无名<br>`sm2l4m2` 同袍·追忆<br>`sm2l5m1` 再引春来·其一<br>`sm2l7m1` 悲伤总无声 |
| 源石技艺和源石技术<br>`nar_document_v0d8_3_1` | 未找到发放外键 | `a1m13` 奇境守卫<br>`a1m14` 遗失之界<br>`c16m4` 记忆之灰<br>`c17m2` 获得的伙伴在身边<br>`c33m1` 血色的叩问<br>`c33m2` 必将复还<br>`c34m1` 迷雾藏起松林<br>`c34m2` 噩梦潜入雪地<br>`c35m1` 晨星降临<br>`c35m3` 孤注邀请<br>`e0m2` 进程·复苏<br>`e11m1` 长风破浪<br>`e11m5` 异乡归人<br>`e12m1` 入丹青<br>`e12m5` 着新墨<br>`e1m3` 重整旗鼓<br>`e2m5` 诡楼寻踪<br>`e2m6` 矿脉断章<br>`e5m0d5` 准备工作<br>`e5m3` 前往武陵城<br>`e6m1` 惊鸿一瞥<br>`e6m3` 穆如清风<br>`e8m1` 水火不容<br>`e9m4` 当时携手处<br>`f1m7d4` 据点建设·重建指挥部·其三<br>`gm02m26` 后目的地<br>`gm02m29` 悬崖下的靶场<br>`sm1l2m1` 希望与代价·其一<br>`sm1l7m1` 内部敌人<br>`sm2l10m1` 无终之恋<br>`sm2l3m4` 夺宝奇兵·其一<br>`sm2l3m5` 夺宝奇兵·其二<br>`sm2l3m6` 夺宝奇兵·其三<br>`sm2l5m1` 再引春来·其一 |
| 种族<br>`nar_document_v0d8_4_1` | 未找到发放外键 | `sm1l5m1` 环带来客·其一 |
| 星门<br>`nar_document_v0d8_5_1` | 未找到发放外键 | `e8m4` 静候光临 |
| 第一次天使战争<br>`nar_document_v0d8_6_1` | 未找到发放外键 | `a1m11` 炽燃！竞技大会！<br>`c34m1` 迷雾藏起松林<br>`e11m1` 长风破浪<br>`e11m8` 余晖未却 |
| 文明环带<br>`nar_document_v0d8_7_1` | 未找到发放外键 | `a1m6d3` 环卫标兵·其三<br>`c16m3` 前尘之魇<br>`c33m2` 必将复还<br>`db01m1` 蚀像寻遗<br>`e0m2` 进程·复苏<br>`e11m4` 物非人是<br>`e12m1` 入丹青<br>`e12m4` 洞我执<br>`e12m5` 着新墨<br>`e1m10` 修缮进展<br>`e3m6` 余波暂平<br>`e4m1` 神秘信号<br>`e4m1d5` 四方会议<br>`e7m2` 深入迷局<br>`e7m4` 旧泉涸处新潮生<br>`e8m1` 水火不容<br>`e9m2` 阵外潮起声犹震<br>`f1m4d3` 据点建设·难民暂居处·其三<br>`gm02m11` 粉丝见面会<br>`gm02m12` 致后来人<br>`sm1l1m4` 商路难走<br>`sm1l1m6` 好人难寻<br>`sm1l7m1` 内部敌人 |
| 超域<br>`nar_document_v0d8_8_1` | 未找到发放外键 | `a1m14` 遗失之界<br>`a1m16d3` 龙泡泡游记·其三<br>`a1m6d2` 环卫标兵·其二<br>`c13m2` 三件小事<br>`c13m3` 穿过记忆的薄雾<br>`c16m4` 记忆之灰<br>`c17m2` 获得的伙伴在身边<br>`c17m3` 笑容连续迭代<br>`db01m1` 蚀像寻遗<br>`db01m3` 蚀像寻遗<br>`e10m1` 墙崩因隙<br>`e10m3` 终则有始<br>`e10m4` 志同道合<br>`e11m1` 长风破浪<br>`e11m2` 归途之始<br>`e11m3` 谈剑问迹<br>`e11m4` 物非人是<br>`e11m5` 异乡归人<br>`e11m6` 拨云见日<br>`e11m7` “归途”<br>`e11m8` 余晖未却<br>`e12m1` 入丹青<br>`e12m2` 知兴衰<br>`e12m4` 洞我执<br>`e12m5` 着新墨<br>`e1m10` 修缮进展<br>`e1m3` 重整旗鼓<br>`e1m5` 庇护之所<br>`e1m7` 踏破雾火<br>`e1m9` 开拓前路<br>`e2m1` 再度启程<br>`e2m2` 穿越研究园<br>`e2m5` 诡楼寻踪<br>`e2m5d5` 山道下行<br>`e2m6` 矿脉断章<br>`e3m1` 初入终局<br>`e3m2` 酝酿反击<br>`e3m3` 烙铁灼痕<br>`e3m4` 前线奔袭<br>`e3m5` 未熄火种<br>`e3m6` 余波暂平<br>`e4m1` 神秘信号<br>`e4m1d5` 四方会议<br>`e5m0d5` 准备工作<br>`e5m1` 初探武陵<br>`e6m1` 惊鸿一瞥<br>`e7m2` 深入迷局<br>`e8m1` 水火不容<br>`e8m2` 致命邀约<br>`e8m3` 片缕幻影<br>`e8m4` 静候光临<br>`e9m2` 阵外潮起声犹震<br>`e9m4` 当时携手处<br>`f1m24` 仓储节点·其一<br>`f1m25` 送货任务<br>`f1m7d1` 据点部署·重建指挥部<br>`f1m7d3` 据点建设·重建指挥部·其二<br>`gm01m11` 漏网之虫<br>`gm01m15` 风雨欲来·供能高地<br>`m1m72` 拍摄悬浮的“表象”<br>`sm2l8m1` 月往日来 |
| 零号委托<br>`nar_document_v0d8_9_1` | 未找到发放外键 | `e0m2` 进程·复苏<br>`e11m8` 余晖未却<br>`e12m4` 洞我执<br>`e12m5` 着新墨<br>`e1m10` 修缮进展<br>`e3m6` 余波暂平<br>`e4m1d5` 四方会议 |
| 枢纽区基地<br>`nar_document_v0d8_10_1` | 未找到发放外键 | `a1m14` 遗失之界<br>`a1m4` 影拓丰碑<br>`c13m1` 谷地佳音<br>`c16m3` 前尘之魇<br>`c17m1` 迟来的色彩刚刚好<br>`c17m2` 获得的伙伴在身边<br>`e1m1` 基地解围<br>`e1m10` 修缮进展<br>`e1m2` 谷地重启<br>`e1m3` 重整旗鼓<br>`e1m6` 建立据点<br>`e2m1` 再度启程<br>`e2m2` 穿越研究园<br>`e2m5d5` 山道下行<br>`e2m6` 矿脉断章<br>`e3m6` 余波暂平<br>`f1m3` 重启地区物资调度·其一<br>`f1m4d1` 据点建设·难民暂居处·其一<br>`f1m4d2` 据点建设·难民暂居处·其二<br>`f1m4d3` 据点建设·难民暂居处·其三<br>`f1m9d1` 据点部署·基建前站<br>`gm01m12` 风雨欲来·终<br>`gm01m13` 风雨欲来·阿伯莉采石场<br>`gm01m14` 风雨欲来·矿脉源区<br>`gm01m15` 风雨欲来·供能高地<br>`sm1l1m1` 无色印记·发现<br>`sm1l1m10` 流言蜚语<br>`sm1l1m11` 再访基地·终<br>`sm1l1m2` 无色印记·探寻<br>`sm1l1m4` 商路难走<br>`sm1l1m6` 好人难寻<br>`sm1l1m7` 再访基地<br>`sm1l5m2` 环带来客·其二 |
| 巢雕<br>`nar_document_v0d8_11_1` | 未找到发放外键 | `c6m1` 离群之狼<br>`e1m5` 庇护之所<br>`e1m6` 建立据点<br>`e1m7` 踏破雾火<br>`e3m3` 烙铁灼痕<br>`e3m4` 前线奔袭<br>`e5m2` 误入清波寨<br>`e7m2` 深入迷局<br>`sm1l1m1` 无色印记·发现<br>`sm1l1m2` 无色印记·探寻 |
| 英雄阿伯莉<br>`nar_document_v0d8_12_1` | 未找到发放外键 | `gm01m13` 风雨欲来·阿伯莉采石场<br>`sm1l3m1` 驰援采石场<br>`sm1l3m2` 修复大型起重机<br>`sm1l3m3` 深层管理区救援 |
| 联盟工团安全局<br>`nar_document_v0d8_13_1` | 未找到发放外键 | `e2m2` 穿越研究园 |
| 世代摇篮<br>`nar_document_v0d8_14_1` | 未找到发放外键 | `c16m2` 迷失之影<br>`c17m2` 获得的伙伴在身边<br>`e2m6` 矿脉断章<br>`e2m7` 踏足矿脉<br>`e2m8` 世代摇篮<br>`e5m0d5` 准备工作<br>`sm1l6m3` 晚安，大树·其一<br>`sm1l6m4` 晚安，大树·其二 |
| 超域试验场<br>`nar_document_v0d8_15_1` | 未找到发放外键 | `c13m2` 三件小事<br>`c17m2` 获得的伙伴在身边<br>`e1m3` 重整旗鼓<br>`e2m1` 再度启程<br>`e2m2` 穿越研究园<br>`e2m5d5` 山道下行<br>`e3m1` 初入终局<br>`e3m3` 烙铁灼痕<br>`e3m4` 前线奔袭<br>`e3m5` 未熄火种<br>`e3m6` 余波暂平<br>`e4m1` 神秘信号<br>`e5m0d5` 准备工作<br>`f1m25` 送货任务<br>`f1m7d3` 据点建设·重建指挥部·其二 |
| 烙铁指令<br>`nar_document_v0d8_16_1` | 未找到发放外键 | `e3m3` 烙铁灼痕<br>`e3m6` 余波暂平<br>`e5m0d5` 准备工作<br>`f1m7d4` 据点建设·重建指挥部·其三 |
| 迷踪林与竹林虫<br>`nar_document_v0d8_17_1` | 未找到发放外键 | `c31m1` 疑云<br>`sm2l1m1` 虫不语·开篇<br>`sm2l1m2` 虫不语·摘菱屿<br>`sm2l1m3` 虫不语·南山<br>`sm2l1m4` 虫不语·尾声<br>`sm2l2m2` 街角的商店·其一 |
| 天师桩<br>`nar_document_v0d8_18_1` | 未找到发放外键 | `a1m6d5` 环卫标兵·其五<br>`e10m1` 墙崩因隙<br>`e10m4` 志同道合<br>`e11m2` 归途之始<br>`e11m3` 谈剑问迹<br>`e11m6` 拨云见日<br>`e11m8` 余晖未却<br>`e6m1` 惊鸿一瞥<br>`e6m2` 东风就绪<br>`e6m3` 穆如清风<br>`e6m4` 潮涌汹汹<br>`e8m1` 水火不容<br>`e8m2` 致命邀约<br>`e9m2` 阵外潮起声犹震<br>`f1m19d1` 据点建设·心脏修缮站·一<br>`f1m19d2` 据点建设·心脏修缮站·二<br>`gm02m23` 往日珍瑰<br>`gm02m27` 钟鸣人归<br>`gm02m27d1` 钟鸣人归·觅“巽”<br>`gm02m4` 安“桩”不易<br>`gm02m5` 检修无小事<br>`m1m31` 拍摄倒塌的天师桩<br>`m1m68` 拍摄安思园的天师桩<br>`sm2l10m1` 无终之恋<br>`sm2l2m2` 街角的商店·其一<br>`sm2l4m2` 同袍·追忆<br>`sm2l4m4` 同袍·明天<br>`sm2l5m1` 再引春来·其一<br>`sm2l5m2` 再引春来·其二<br>`sm2l5m3` 再引春来·其三 |
| 武陵城<br>`nar_document_v0d8_19_1` | 未找到发放外键 | `a1m18` 童心速绘·游记<br>`a1m6d1` 环卫标兵·其一<br>`a1m6d6` 环卫标兵·其六<br>`a1m7` 童心速绘·寻旅<br>`a1m8d1` 掌中救星·其一<br>`a1m8d2` 掌中救星·其二<br>`a1m8d3` 掌中救星·其三<br>`a1m9` 武陵特厨<br>`c27m1` 风平水不静<br>`c27m2` 又是一波起<br>`c27m5` 共饮一江水<br>`c31m1` 疑云<br>`c31m2` 挑战<br>`c31m3` 拳心<br>`c34m3` 长箭划破梦境<br>`e10m1` 墙崩因隙<br>`e10m3` 终则有始<br>`e10m4` 志同道合<br>`e11m1` 长风破浪<br>`e11m2` 归途之始<br>`e11m4` 物非人是<br>`e11m8` 余晖未却<br>`e12m1` 入丹青<br>`e12m3` 见纵横<br>`e12m5` 着新墨<br>`e4m1d5` 四方会议<br>`e5m1` 初探武陵<br>`e5m2` 误入清波寨<br>`e5m3` 前往武陵城<br>`e6m1` 惊鸿一瞥<br>`e6m2` 东风就绪<br>`e6m3` 穆如清风<br>`e6m4` 潮涌汹汹<br>`e6m5` 无患之患<br>`e7m1` 意外来袭<br>`e7m2` 深入迷局<br>`e7m3` 分道扬镳<br>`e7m4` 旧泉涸处新潮生<br>`e8m1` 水火不容<br>`e8m2` 致命邀约<br>`e8m5` 自由意志<br>`e9m2` 阵外潮起声犹震<br>`e9m4` 当时携手处<br>`f1m18d1` 据点建设·天王坪援建点·一<br>`f1m18d2` 据点建设·天王坪援建点·二<br>`f1m18d3` 据点建设·天王坪援建点·三<br>`f1m19d1` 据点建设·心脏修缮站·一<br>`f1m19d2` 据点建设·心脏修缮站·二<br>`f1m19d3` 据点建设·心脏修缮站·三<br>`f1m29d2` 据点建设·盈天台建设站·一<br>`f1m29d4` 据点建设·盈天台建设站·三<br>`gm02m11` 粉丝见面会<br>`gm02m27` 钟鸣人归<br>`gm02m5` 检修无小事<br>`gm02m8` 钟鸣三到<br>`m1m73` 日常·涤垢洗瑕<br>`m1m76` 农植自动化改造<br>`sm2l10m1` 无终之恋<br>`sm2l10m2` 前缘再续<br>`sm2l1m5` 追逐的脚步<br>`sm2l2m1` 驮兽与我<br>`sm2l2m2` 街角的商店·其一<br>`sm2l2m3` 老人与潮·其一<br>`sm2l2m7` 街角的商店·其三<br>`sm2l3m6` 夺宝奇兵·其三<br>`sm2l4m1` 同袍·无名<br>`sm2l4m5` 重逢故人·其一<br>`sm2l4m6` 重逢故人·其二<br>`sm2l6m1` 藏剑于谷<br>`sm2l7m1` 悲伤总无声<br>`sm2l8m1` 月往日来 |
| 武陵甚大裂隙<br>`nar_document_v0d8_21_1` | 未找到发放外键 | `a1m16d3` 龙泡泡游记·其三<br>`e11m1` 长风破浪<br>`e11m2` 归途之始<br>`e11m3` 谈剑问迹<br>`e11m4` 物非人是<br>`e11m5` 异乡归人<br>`e11m6` 拨云见日<br>`e11m7` “归途”<br>`e11m8` 余晖未却<br>`e12m1` 入丹青<br>`e12m5` 着新墨<br>`e4m1d5` 四方会议<br>`e5m0d5` 准备工作<br>`e7m4` 旧泉涸处新潮生<br>`e8m1` 水火不容<br>`e8m2` 致命邀约<br>`e8m3` 片缕幻影<br>`e8m4` 静候光临<br>`e9m4` 当时携手处<br>`f1m32` 填隙柱地<br>`gm02m23` 往日珍瑰<br>`sm2l8m1` 月往日来 |
| 武陵地区<br>`nar_document_v0d8_23_1` | 未找到发放外键 | `a1m8d1` 掌中救星·其一<br>`e4m1d5` 四方会议<br>`f1m19d2` 据点建设·心脏修缮站·二<br>`f1m29d4` 据点建设·盈天台建设站·三 |
| 息壤<br>`nar_document_v0d8_24_1` | 未找到发放外键 | `a1m16d1` 龙泡泡游记·其一<br>`a1m16d2` 龙泡泡游记·其二<br>`a1m16d3` 龙泡泡游记·其三<br>`a1m6d2` 环卫标兵·其二<br>`a1m6d3` 环卫标兵·其三<br>`a1m6d6` 环卫标兵·其六<br>`a1m6d7` 环卫标兵·其七<br>`a1m8d1` 掌中救星·其一<br>`a1m8d2` 掌中救星·其二<br>`a1m8d3` 掌中救星·其三<br>`e10m1` 墙崩因隙<br>`e10m2` 大器晚成<br>`e10m3` 终则有始<br>`e10m4` 志同道合<br>`e11m1` 长风破浪<br>`e11m4` 物非人是<br>`e11m5` 异乡归人<br>`e11m8` 余晖未却<br>`e4m1d5` 四方会议<br>`e5m2` 误入清波寨<br>`e6m1` 惊鸿一瞥<br>`e6m2` 东风就绪<br>`e6m3` 穆如清风<br>`e6m4` 潮涌汹汹<br>`e7m4` 旧泉涸处新潮生<br>`e8m1` 水火不容<br>`e8m3` 片缕幻影<br>`e8m5` 自由意志<br>`e9m2` 阵外潮起声犹震<br>`e9m4` 当时携手处<br>`f1m18d1` 据点建设·天王坪援建点·一<br>`f1m19d2` 据点建设·心脏修缮站·二<br>`f1m29d1` 据点部署·盈天台建设站<br>`f1m29d2` 据点建设·盈天台建设站·一<br>`f1m29d3` 据点建设·盈天台建设站·二<br>`f1m29d4` 据点建设·盈天台建设站·三<br>`f1m32` 填隙柱地<br>`gm02m11` 粉丝见面会<br>`gm02m21` 有家难奔<br>`gm02m4` 安“桩”不易<br>`gm02m5` 检修无小事<br>`gm02m8` 钟鸣三到<br>`sm2l2m3` 老人与潮·其一<br>`sm2l2m4` 老人与潮·其二<br>`sm2l3m2` 泉中客·其二<br>`sm2l4m1` 同袍·无名<br>`sm2l4m2` 同袍·追忆<br>`sm2l5m1` 再引春来·其一<br>`sm2l8m1` 月往日来 |
| 塔卫二<br>`nar_document_v0d8_25_1` | 未找到发放外键 | `a1m11` 炽燃！竞技大会！<br>`a1m16d2` 龙泡泡游记·其二<br>`a1m16d3` 龙泡泡游记·其三<br>`a1m3` 童心速绘<br>`a1m6d2` 环卫标兵·其二<br>`a1m6d4` 环卫标兵·其四<br>`c13m3` 穿过记忆的薄雾<br>`c16m3` 前尘之魇<br>`c16m4` 记忆之灰<br>`c33m1` 血色的叩问<br>`c34m1` 迷雾藏起松林<br>`c35m1` 晨星降临<br>`c35m4` 曳空流星<br>`db01m1` 蚀像寻遗<br>`db01m10` 战争回响<br>`e0m2` 进程·复苏<br>`e10m5` 自由开拓<br>`e11m1` 长风破浪<br>`e11m3` 谈剑问迹<br>`e11m4` 物非人是<br>`e11m5` 异乡归人<br>`e11m8` 余晖未却<br>`e11m8d5` 自由开拓<br>`e12m1` 入丹青<br>`e12m4` 洞我执<br>`e12m5` 着新墨<br>`e12m6` 自由开拓<br>`e1m10` 修缮进展<br>`e1m3` 重整旗鼓<br>`e1m5` 庇护之所<br>`e2m1` 再度启程<br>`e2m6` 矿脉断章<br>`e3m6` 余波暂平<br>`e4m1d5` 四方会议<br>`e6m2` 东风就绪<br>`e6m4` 潮涌汹汹<br>`e6m5d5` 自由开拓<br>`e7m4d5` 自由开拓<br>`f1m10` 稼穑不易<br>`f1m29d4` 据点建设·盈天台建设站·三<br>`f1m7d4` 据点建设·重建指挥部·其三<br>`gm01m11` 漏网之虫<br>`gm02m15` 古崖论剑<br>`gm02m16` 选剑演武<br>`sm1l1m5` 生意难做<br>`sm1l1m6` 好人难寻<br>`sm1l1m8` 使命虽小<br>`sm1l5m2` 环带来客·其二<br>`sm1l7m1` 内部敌人<br>`sm2l1m4` 虫不语·尾声<br>`sm2l1m5` 追逐的脚步<br>`sm2l3m4` 夺宝奇兵·其一<br>`sm2l3m6` 夺宝奇兵·其三<br>`sm2l6m1` 藏剑于谷 |
| 终末地工业<br>`nar_document_v0d8_26_1` | 未找到发放外键 | `a1m16d3` 龙泡泡游记·其三<br>`c17m2` 获得的伙伴在身边<br>`c33m2` 必将复还<br>`c35m4` 曳空流星<br>`e0m2` 进程·复苏<br>`e1m10` 修缮进展<br>`e1m5` 庇护之所<br>`e1m6` 建立据点<br>`e1m9` 开拓前路<br>`e2m2` 穿越研究园<br>`e4m1d5` 四方会议<br>`e6m1` 惊鸿一瞥<br>`e6m2` 东风就绪<br>`f1m18d1` 据点建设·天王坪援建点·一<br>`f1m20` 装备精锻<br>`f1m3` 重启地区物资调度·其一<br>`gm02m7` 出师三剑<br>`sm1l1m10` 流言蜚语<br>`sm1l1m4` 商路难走<br>`sm1l1m6` 好人难寻<br>`sm2l3m1` 泉中客·其一<br>`sm2l6m1` 藏剑于谷 |
| 联盟工团<br>`nar_document_v0d8_27_1` | 未找到发放外键 | `a1m13` 奇境守卫<br>`c33m2` 必将复还<br>`e1m3` 重整旗鼓<br>`e2m1` 再度启程<br>`e2m2` 穿越研究园<br>`e2m3` 推开园门<br>`e3m2` 酝酿反击<br>`e3m6` 余波暂平<br>`e4m1d5` 四方会议<br>`f1m7d4` 据点建设·重建指挥部·其三<br>`sm1l1m1` 无色印记·发现<br>`sm1l2m3` 帮人帮到底<br>`sm1l7m1` 内部敌人 |
| 宏山科学院<br>`nar_document_v0d8_28_1` | 未找到发放外键 | `e4m1d5` 四方会议<br>`m1m56` 拍摄缩进壳中的小壳兽<br>`sm2l6m1` 藏剑于谷 |
| 环塔商会<br>`nar_document_v0d8_29_1` | 未找到发放外键 | `c17m2` 获得的伙伴在身边<br>`c35m1` 晨星降临<br>`e3m6` 余波暂平<br>`e4m1d5` 四方会议<br>`sm1l1m4` 商路难走<br>`sm1l1m5` 生意难做<br>`sm1l1m6` 好人难寻<br>`sm1l5m1` 环带来客·其一<br>`sm1l5m2` 环带来客·其二<br>`sm2l2m2` 街角的商店·其一<br>`sm2l6m1` 藏剑于谷 |
| 帝江号<br>`nar_document_v0d8_30_1` | 未找到发放外键 | `a1m10` 镌宇铭星·留影<br>`a1m19` 百趣演武<br>`c16m1` 追忆之痕<br>`c16m4` 记忆之灰<br>`c35m4` 曳空流星<br>`db01m1` 蚀像寻遗<br>`e0m2` 进程·复苏<br>`e11m1` 长风破浪<br>`e11m8` 余晖未却<br>`e12m1` 入丹青<br>`e12m2` 知兴衰<br>`e12m4` 洞我执<br>`e12m5` 着新墨<br>`e1m1` 基地解围<br>`e1m10` 修缮进展<br>`e1m3` 重整旗鼓<br>`e4m1` 神秘信号<br>`e4m1d5` 四方会议<br>`e5m1` 初探武陵<br>`e5m3` 前往武陵城<br>`e6m2` 东风就绪<br>`e8m5` 自由意志<br>`e9m2` 阵外潮起声犹震<br>`f1m22` 帝江号升级维护·二<br>`f1m6` 帝江号升级维护·一<br>`gm02m24` 奇闻满地跑<br>`sm2l2m2` 街角的商店·其一 |
| 源石在塔卫二<br>`nar_document_v0d8_31_1` | 未找到发放外键 | 未找到同名任务文本 |
| 协议源石<br>`nar_document_v0d8_32_1` | 未找到发放外键 | `a1m8d1` 掌中救星·其一<br>`db01m1` 蚀像寻遗<br>`e0m2` 进程·复苏<br>`e11m1` 长风破浪<br>`e11m4` 物非人是<br>`e11m5` 异乡归人<br>`e11m6` 拨云见日<br>`e11m8` 余晖未却<br>`e12m5` 着新墨<br>`e4m1` 神秘信号<br>`e4m1d5` 四方会议<br>`e6m1` 惊鸿一瞥<br>`e6m4` 潮涌汹汹<br>`e8m1` 水火不容<br>`f1m19d1` 据点建设·心脏修缮站·一<br>`f1m19d3` 据点建设·心脏修缮站·三<br>`gm02m26` 后目的地 |
| 集成工业系统（AIC）<br>`nar_document_v0d8_33_1` | 未找到发放外键 | `a1m16d1` 龙泡泡游记·其一<br>`a1m8d1` 掌中救星·其一<br>`e10m1` 墙崩因隙<br>`e11m8` 余晖未却<br>`e1m1` 基地解围<br>`e1m2` 谷地重启<br>`e1m3` 重整旗鼓<br>`e1m6` 建立据点<br>`e1m9` 开拓前路<br>`e2m1` 再度启程<br>`e2m5` 诡楼寻踪<br>`e3m6` 余波暂平<br>`e4m1d5` 四方会议<br>`e6m1` 惊鸿一瞥<br>`e6m2` 东风就绪<br>`e6m4` 潮涌汹汹<br>`e6m5` 无患之患<br>`e8m5` 自由意志<br>`e9m2` 阵外潮起声犹震<br>`e9m4` 当时携手处<br>`f1m10` 稼穑不易<br>`f1m24` 仓储节点·其一<br>`f1m29d1` 据点部署·盈天台建设站<br>`f1m29d2` 据点建设·盈天台建设站·一<br>`f1m29d4` 据点建设·盈天台建设站·三<br>`f1m32` 填隙柱地<br>`f1m4d1` 据点建设·难民暂居处·其一<br>`f1m7d1` 据点部署·重建指挥部<br>`f1m7d2` 据点建设·重建指挥部·其一<br>`f1m9d1` 据点部署·基建前站<br>`f1m9d3` 据点建设·基建前站·其二<br>`gm02m8` 钟鸣三到<br>`m1m24` 生产工业爆炸物 |
| 四号谷地<br>`nar_document_v0d8_34_1` | 未找到发放外键 | `a1m13` 奇境守卫<br>`a1m14` 遗失之界<br>`a1m18` 童心速绘·游记<br>`a1m2` 迟到的特训<br>`a1m3` 童心速绘<br>`a1m5` 开拓节与特色美食<br>`a1m7` 童心速绘·寻旅<br>`c13m1` 谷地佳音<br>`c13m3` 穿过记忆的薄雾<br>`c16m1` 追忆之痕<br>`c16m2` 迷失之影<br>`c16m3` 前尘之魇<br>`c16m4` 记忆之灰<br>`c17m2` 获得的伙伴在身边<br>`c17m3` 笑容连续迭代<br>`c33m1` 血色的叩问<br>`c33m2` 必将复还<br>`c34m1` 迷雾藏起松林<br>`c35m1` 晨星降临<br>`c35m3` 孤注邀请<br>`c35m4` 曳空流星<br>`db01m1` 蚀像寻遗<br>`db01m10` 战争回响<br>`e0m2` 进程·复苏<br>`e11m6` 拨云见日<br>`e12m2` 知兴衰<br>`e12m3` 见纵横<br>`e1m1` 基地解围<br>`e1m10` 修缮进展<br>`e1m3` 重整旗鼓<br>`e1m4` 西行入谷<br>`e1m5` 庇护之所<br>`e1m6` 建立据点<br>`e1m7` 踏破雾火<br>`e1m9` 开拓前路<br>`e2m1` 再度启程<br>`e2m2` 穿越研究园<br>`e2m3` 推开园门<br>`e2m5` 诡楼寻踪<br>`e2m6` 矿脉断章<br>`e3m1` 初入终局<br>`e3m2` 酝酿反击<br>`e3m3` 烙铁灼痕<br>`e3m4` 前线奔袭<br>`e3m6` 余波暂平<br>`e4m1` 神秘信号<br>`e4m1d5` 四方会议<br>`e5m0d5` 准备工作<br>`e5m1` 初探武陵<br>`e5m2` 误入清波寨<br>`e8m1` 水火不容<br>`e9m4` 当时携手处<br>`f1m10` 稼穑不易<br>`f1m10d1` 科学兴农<br>`f1m25` 送货任务<br>`f1m3` 重启地区物资调度·其一<br>`f1m3d1` 重启地区物资调度·其二<br>`f1m4d1` 据点建设·难民暂居处·其一<br>`f1m4d2` 据点建设·难民暂居处·其二<br>`f1m4d3` 据点建设·难民暂居处·其三<br>`f1m7d1` 据点部署·重建指挥部<br>`f1m7d2` 据点建设·重建指挥部·其一<br>`f1m7d4` 据点建设·重建指挥部·其三<br>`f1m9d1` 据点部署·基建前站<br>`f1m9d3` 据点建设·基建前站·其二<br>`f1m9d4` 据点建设·基建前站·其三<br>`gm01m12` 风雨欲来·终<br>`gm01m13` 风雨欲来·阿伯莉采石场<br>`gm01m14` 风雨欲来·矿脉源区<br>`gm01m15` 风雨欲来·供能高地<br>`gm01m7` 风雨欲来·枢纽区<br>`gm01m8` 机械救星<br>`gm02m21` 有家难奔<br>`sm1l1m11` 再访基地·终<br>`sm1l1m2` 无色印记·探寻<br>`sm1l1m4` 商路难走<br>`sm1l1m5` 生意难做<br>`sm1l1m6` 好人难寻<br>`sm1l1m7` 再访基地<br>`sm1l2m2` 希望与代价·其二<br>`sm1l2m3` 帮人帮到底<br>`sm1l5m1` 环带来客·其一<br>`sm1l5m2` 环带来客·其二<br>`sm1l6m3` 晚安，大树·其一<br>`sm1l6m4` 晚安，大树·其二<br>`sm1l7m1` 内部敌人 |
| 侵蚀<br>`nar_document_v0d8_35_1` | 未找到发放外键 | `a1m16d1` 龙泡泡游记·其一<br>`a1m16d2` 龙泡泡游记·其二<br>`a1m16d3` 龙泡泡游记·其三<br>`a1m8d1` 掌中救星·其一<br>`a1m8d2` 掌中救星·其二<br>`a1m8d3` 掌中救星·其三<br>`a1m9` 武陵特厨<br>`c13m1` 谷地佳音<br>`c13m2` 三件小事<br>`c13m3` 穿过记忆的薄雾<br>`c17m1` 迟来的色彩刚刚好<br>`c17m3` 笑容连续迭代<br>`c28m1` 跟着红色的影子<br>`db01m1` 蚀像寻遗<br>`e10m1` 墙崩因隙<br>`e10m2` 大器晚成<br>`e10m3` 终则有始<br>`e11m1` 长风破浪<br>`e11m2` 归途之始<br>`e11m3` 谈剑问迹<br>`e11m4` 物非人是<br>`e11m5` 异乡归人<br>`e11m6` 拨云见日<br>`e11m7` “归途”<br>`e11m8` 余晖未却<br>`e12m2` 知兴衰<br>`e1m5` 庇护之所<br>`e1m7` 踏破雾火<br>`e2m1` 再度启程<br>`e2m2` 穿越研究园<br>`e2m3` 推开园门<br>`e2m4` 园区穿行<br>`e2m5` 诡楼寻踪<br>`e2m5d5` 山道下行<br>`e2m6` 矿脉断章<br>`e3m6` 余波暂平<br>`e4m1` 神秘信号<br>`e5m1` 初探武陵<br>`e6m1` 惊鸿一瞥<br>`e6m2` 东风就绪<br>`e6m3` 穆如清风<br>`e6m4` 潮涌汹汹<br>`e6m5` 无患之患<br>`e7m1` 意外来袭<br>`e7m2` 深入迷局<br>`e7m3` 分道扬镳<br>`e8m1` 水火不容<br>`e8m3` 片缕幻影<br>`e9m2` 阵外潮起声犹震<br>`e9m4` 当时携手处<br>`f1m10` 稼穑不易<br>`f1m10d1` 科学兴农<br>`f1m18d1` 据点建设·天王坪援建点·一<br>`f1m29d1` 据点部署·盈天台建设站<br>`f1m29d2` 据点建设·盈天台建设站·一<br>`f1m29d3` 据点建设·盈天台建设站·二<br>`f1m29d4` 据点建设·盈天台建设站·三<br>`f1m32` 填隙柱地<br>`f1m7d1` 据点部署·重建指挥部<br>`f1m7d2` 据点建设·重建指挥部·其一<br>`f1m9d1` 据点部署·基建前站<br>`f1m9d4` 据点建设·基建前站·其三<br>`gm01m11` 漏网之虫<br>`gm01m14` 风雨欲来·矿脉源区<br>`gm01m15` 风雨欲来·供能高地<br>`gm01m16` 幻觉<br>`gm01m17` 维修总动员<br>`gm01m23` gm01m23<br>`gm01m6` 高空救援<br>`gm02m11` 粉丝见面会<br>`gm02m13` 侵蚀中的呼救<br>`gm02m14` 分忧解难<br>`gm02m16` 选剑演武<br>`gm02m17` 刀剑无名·其一<br>`gm02m20` 观蚀影记<br>`gm02m23` 往日珍瑰<br>`gm02m26` 后目的地<br>`gm02m27` 钟鸣人归<br>`gm02m27d4` 钟鸣人归·得“乾”<br>`gm02m27d6` 譬如朝露<br>`gm02m8` 钟鸣三到<br>`m1m26` 拍摄侵蚀潮中损坏的信标<br>`sm1l1m8` 使命虽小<br>`sm1l2m2` 希望与代价·其二<br>`sm1l5m1` 环带来客·其一<br>`sm1l6m2` 紧急救助<br>`sm2l1m1` 虫不语·开篇<br>`sm2l1m3` 虫不语·南山<br>`sm2l2m1` 驮兽与我<br>`sm2l2m3` 老人与潮·其一<br>`sm2l2m4` 老人与潮·其二<br>`sm2l3m2` 泉中客·其二<br>`sm2l4m1` 同袍·无名<br>`sm2l4m5` 重逢故人·其一<br>`sm2l5m1` 再引春来·其一<br>`sm2l5m3` 再引春来·其三<br>`sm2l6m1` 藏剑于谷<br>`sm2l7m1` 悲伤总无声<br>`sm2l8m1` 月往日来 |
| 天使<br>`nar_document_v0d8_37_1` | 未找到发放外键 | `a1m11` 炽燃！竞技大会！<br>`a1m16d2` 龙泡泡游记·其二<br>`a1m5` 开拓节与特色美食<br>`a1m6d5` 环卫标兵·其五<br>`a1m8d2` 掌中救星·其二<br>`a1m8d3` 掌中救星·其三<br>`a1m9` 武陵特厨<br>`c16m1` 追忆之痕<br>`c16m3` 前尘之魇<br>`c17m2` 获得的伙伴在身边<br>`c17m3` 笑容连续迭代<br>`c34m1` 迷雾藏起松林<br>`c35m2` 筹划序曲<br>`c6m1` 离群之狼<br>`e10m1` 墙崩因隙<br>`e10m4` 志同道合<br>`e11m1` 长风破浪<br>`e11m8` 余晖未却<br>`e12m1` 入丹青<br>`e1m1` 基地解围<br>`e1m10` 修缮进展<br>`e1m2` 谷地重启<br>`e2m2` 穿越研究园<br>`e2m5d5` 山道下行<br>`e2m6` 矿脉断章<br>`e2m7` 踏足矿脉<br>`e2m8` 世代摇篮<br>`e3m3` 烙铁灼痕<br>`e3m6` 余波暂平<br>`e4m1` 神秘信号<br>`e4m1d5` 四方会议<br>`e5m0d5` 准备工作<br>`e5m1` 初探武陵<br>`e5m2` 误入清波寨<br>`e5m3` 前往武陵城<br>`e6m1` 惊鸿一瞥<br>`e6m2` 东风就绪<br>`e6m4` 潮涌汹汹<br>`e7m1` 意外来袭<br>`e7m2` 深入迷局<br>`e8m1` 水火不容<br>`e8m3` 片缕幻影<br>`e9m4` 当时携手处<br>`f1m18d2` 据点建设·天王坪援建点·二<br>`f1m19d1` 据点建设·心脏修缮站·一<br>`f1m19d3` 据点建设·心脏修缮站·三<br>`f1m29d2` 据点建设·盈天台建设站·一<br>`f1m29d3` 据点建设·盈天台建设站·二<br>`f1m29d4` 据点建设·盈天台建设站·三<br>`f1m7d3` 据点建设·重建指挥部·其二<br>`gm01m6` 高空救援<br>`gm02m12` 致后来人<br>`sm1l1m10` 流言蜚语<br>`sm1l1m8` 使命虽小<br>`sm1l2m2` 希望与代价·其二<br>`sm1l3m2` 修复大型起重机<br>`sm1l3m3` 深层管理区救援<br>`sm1l6m3` 晚安，大树·其一<br>`sm1l6m4` 晚安，大树·其二<br>`sm1l7m2` 机器人之梦<br>`sm2l1m1` 虫不语·开篇<br>`sm2l1m5` 追逐的脚步<br>`sm2l2m3` 老人与潮·其一<br>`sm2l4m1` 同袍·无名<br>`sm2l4m2` 同袍·追忆<br>`sm2l6m1` 藏剑于谷 |
| 裂地者<br>`nar_document_v0d8_38_1` | 未找到发放外键 | `a1m11` 炽燃！竞技大会！<br>`a1m5` 开拓节与特色美食<br>`a1m6d2` 环卫标兵·其二<br>`a1m7` 童心速绘·寻旅<br>`c13m2` 三件小事<br>`c16m3` 前尘之魇<br>`c16m4` 记忆之灰<br>`c17m3` 笑容连续迭代<br>`c27m1` 风平水不静<br>`c27m4` 水清顽石现<br>`c27m5` 共饮一江水<br>`c28m1` 跟着红色的影子<br>`c28m3` 国王与骑士<br>`c33m1` 血色的叩问<br>`c33m2` 必将复还<br>`c34m1` 迷雾藏起松林<br>`c35m4` 曳空流星<br>`c6m1` 离群之狼<br>`db01m3` 蚀像寻遗<br>`e11m8` 余晖未却<br>`e12m5` 着新墨<br>`e1m1` 基地解围<br>`e1m2` 谷地重启<br>`e1m3` 重整旗鼓<br>`e1m4` 西行入谷<br>`e1m5` 庇护之所<br>`e1m6` 建立据点<br>`e1m7` 踏破雾火<br>`e1m8` 要塞决战<br>`e1m9` 开拓前路<br>`e2m1` 再度启程<br>`e2m2` 穿越研究园<br>`e2m3` 推开园门<br>`e2m4` 园区穿行<br>`e2m5` 诡楼寻踪<br>`e2m5d5` 山道下行<br>`e2m6` 矿脉断章<br>`e3m1` 初入终局<br>`e3m2` 酝酿反击<br>`e3m3` 烙铁灼痕<br>`e3m6` 余波暂平<br>`e4m1` 神秘信号<br>`e5m2` 误入清波寨<br>`e7m1` 意外来袭<br>`e7m2` 深入迷局<br>`e7m3` 分道扬镳<br>`e7m4` 旧泉涸处新潮生<br>`e9m2` 阵外潮起声犹震<br>`e9m4` 当时携手处<br>`f1m10` 稼穑不易<br>`f1m10d1` 科学兴农<br>`f1m24` 仓储节点·其一<br>`f1m4d1` 据点建设·难民暂居处·其一<br>`f1m4d2` 据点建设·难民暂居处·其二<br>`f1m5` 据点防御建设<br>`f1m9d1` 据点部署·基建前站<br>`f1m9d2` 据点建设·基建前站·其一<br>`f1m9d3` 据点建设·基建前站·其二<br>`f1m9d4` 据点建设·基建前站·其三<br>`gm01m1` 职责所在<br>`gm01m10` 消失的爱人<br>`gm01m12` 风雨欲来·终<br>`gm01m13` 风雨欲来·阿伯莉采石场<br>`gm01m14` 风雨欲来·矿脉源区<br>`gm01m15` 风雨欲来·供能高地<br>`gm01m16` 幻觉<br>`gm01m22` 尘封旧档<br>`gm01m6` 高空救援<br>`gm01m7` 风雨欲来·枢纽区<br>`gm01m8` 机械救星<br>`gm02m12` 致后来人<br>`sm1l1m1` 无色印记·发现<br>`sm1l1m2` 无色印记·探寻<br>`sm1l1m4` 商路难走<br>`sm1l1m6` 好人难寻<br>`sm1l2m1` 希望与代价·其一<br>`sm1l2m2` 希望与代价·其二<br>`sm1l2m3` 帮人帮到底<br>`sm1l2m4` 无色印记·揭示<br>`sm1l5m2` 环带来客·其二<br>`sm1l6m1` 紧急救助<br>`sm1l6m2` 紧急救助<br>`sm1l6m3` 晚安，大树·其一<br>`sm1l7m1` 内部敌人<br>`sm2l3m1` 泉中客·其一<br>`sm2l3m2` 泉中客·其二 |
| 塔卫二的极光<br>`nar_document_v0d8_39_1` | 未找到发放外键 | `e2m6` 矿脉断章 |
| 再旅者<br>`nar_document_v0d8_40_1` | 未找到发放外键 | `c16m3` 前尘之魇<br>`c16m4` 记忆之灰<br>`c34m1` 迷雾藏起松林 |
| 清波寨<br>`nar_document_v1d1_1_1` | 未找到发放外键 | `a1m15` 跑者盛会<br>`a1m7` 童心速绘·寻旅<br>`a1m8d1` 掌中救星·其一<br>`a1m8d2` 掌中救星·其二<br>`a1m8d3` 掌中救星·其三<br>`c27m1` 风平水不静<br>`c27m2` 又是一波起<br>`c27m4` 水清顽石现<br>`c27m5` 共饮一江水<br>`c31m1` 疑云<br>`c31m2` 挑战<br>`c31m3` 拳心<br>`e10m1` 墙崩因隙<br>`e11m2` 归途之始<br>`e11m8` 余晖未却<br>`e5m1` 初探武陵<br>`e5m2` 误入清波寨<br>`e5m3` 前往武陵城<br>`e6m4` 潮涌汹汹<br>`e6m5` 无患之患<br>`e7m1` 意外来袭<br>`e7m2` 深入迷局<br>`e7m3` 分道扬镳<br>`e7m4` 旧泉涸处新潮生<br>`e7m4d5` 自由开拓<br>`e8m1` 水火不容<br>`e8m2` 致命邀约<br>`e8m5` 自由意志<br>`e9m2` 阵外潮起声犹震<br>`e9m4` 当时携手处<br>`f1m18d1` 据点建设·天王坪援建点·一<br>`f1m18d2` 据点建设·天王坪援建点·二<br>`f1m18d3` 据点建设·天王坪援建点·三<br>`f1m32` 填隙柱地<br>`m1m40` 拍摄码头水车<br>`m1m41` 日常·疗伤良药<br>`m1m58` 拍摄水竹铃<br>`sm2l10m2` 前缘再续<br>`sm2l1m1` 虫不语·开篇<br>`sm2l1m2` 虫不语·摘菱屿<br>`sm2l1m4` 虫不语·尾声<br>`sm2l1m5` 追逐的脚步<br>`sm2l3m1` 泉中客·其一<br>`sm2l3m2` 泉中客·其二<br>`sm2l3m3` 泉中客·其三<br>`sm2l3m4` 夺宝奇兵·其一<br>`sm2l3m5` 夺宝奇兵·其二<br>`sm2l3m6` 夺宝奇兵·其三<br>`sm2l4m1` 同袍·无名<br>`sm2l6m1` 藏剑于谷 |
| 应龙特勤队<br>`nar_document_v1d2_1_1` | 未找到发放外键 | `a1m16d1` 龙泡泡游记·其一<br>`c31m3` 拳心<br>`e11m1` 长风破浪<br>`e11m2` 归途之始<br>`e11m3` 谈剑问迹<br>`e11m4` 物非人是<br>`e11m8` 余晖未却<br>`e6m4` 潮涌汹汹<br>`e7m2` 深入迷局<br>`e8m1` 水火不容<br>`e8m2` 致命邀约<br>`e8m5` 自由意志<br>`e9m4` 当时携手处<br>`f1m29d1` 据点部署·盈天台建设站<br>`gm02m17` 刀剑无名·其一<br>`sm2l7m1` 悲伤总无声<br>`sm2l8m1` 月往日来 |
| 众生长地<br>`nar_document_v1d2_2_1` | 未找到发放外键 | `sm1l2m1` 希望与代价·其一<br>`sm1l2m2` 希望与代价·其二<br>`sm2l7m1` 悲伤总无声 |
| 塞什卡<br>`nar_document_v1d2_3_1` | 未找到发放外键 | `c33m1` 血色的叩问<br>`c33m2` 必将复还<br>`c35m3` 孤注邀请<br>`e12m1` 入丹青<br>`e12m5` 着新墨<br>`e5m1` 初探武陵 |
| 寂语修会<br>`nar_document_v1d2_4_1` | 未找到发放外键 | `e1m10` 修缮进展 |
| 铁誓军<br>`nar_document_v1d2_5_1` | 未找到发放外键 | `a1m9` 武陵特厨<br>`c34m1` 迷雾藏起松林<br>`c34m2` 噩梦潜入雪地<br>`db01m1` 蚀像寻遗<br>`e11m1` 长风破浪<br>`e2m4` 园区穿行<br>`e4m1d5` 四方会议<br>`sm1l2m3` 帮人帮到底 |
| 炎国<br>`nar_document_v1d2_6_1` | 未找到发放外键 | `c31m2` 挑战<br>`e11m8` 余晖未却<br>`e12m1` 入丹青<br>`e12m3` 见纵横<br>`e12m4` 洞我执<br>`e5m1` 初探武陵<br>`e7m2` 深入迷局<br>`gm02m15` 古崖论剑<br>`gm02m8` 钟鸣三到<br>`sm2l10m3` 纪念日<br>`sm2l3m2` 泉中客·其二<br>`sm2l3m4` 夺宝奇兵·其一<br>`sm2l3m6` 夺宝奇兵·其三<br>`sm2l6m1` 藏剑于谷 |
| 天师府学院<br>`nar_document_v1d2_7_1` | 未找到发放外键 | `a1m16d3` 龙泡泡游记·其三<br>`a1m6d5` 环卫标兵·其五<br>`a1m8d1` 掌中救星·其一<br>`e6m3` 穆如清风<br>`f1m19d1` 据点建设·心脏修缮站·一<br>`f1m29d3` 据点建设·盈天台建设站·二<br>`f1m36` 开画大吉<br>`gm02m16` 选剑演武<br>`gm02m23` 往日珍瑰<br>`gm02m6` 水中诡事<br>`m1m26` 拍摄侵蚀潮中损坏的信标<br>`m1m27` 拍摄一群蓄水源石虫<br>`m1m28` 拍摄水中的七彩鳞<br>`m1m29` 拍摄室内培育的作物<br>`m1m34` 拍摄充满活力的蓄水源石虫<br>`m1m35` 拍摄肚子鼓气后发光的吐虫长股兽<br>`m1m36` 拍摄农田中东张西望的黑腹雉羽兽<br>`m1m37` 拍摄储备站周围的生态环境<br>`m1m38` 拍摄水灯虫<br>`m1m39` 拍摄枢壤仪<br>`m1m57` 拍摄祖泉周边的环形瀑布<br>`m1m74` 日常·表象研究<br>`m1m77` 日常·表象研究<br>`m1m78` 日常·表象研究<br>`m1m79` 日常·表象研究<br>`sm2l2m3` 老人与潮·其一<br>`sm2l2m4` 老人与潮·其二<br>`sm2l6m1` 藏剑于谷 |
| 祖泉<br>`nar_document_v1d2_8_1` | 未找到发放外键 | `c27m3` 逐波向水中<br>`c27m4` 水清顽石现<br>`e5m2` 误入清波寨<br>`e6m5` 无患之患<br>`e7m3` 分道扬镳<br>`e7m4` 旧泉涸处新潮生<br>`f1m18d3` 据点建设·天王坪援建点·三<br>`gm02m13` 侵蚀中的呼救<br>`m1m57` 拍摄祖泉周边的环形瀑布<br>`m1m59` 拍摄祖泉周边的枯枝<br>`sm2l3m1` 泉中客·其一<br>`sm2l3m2` 泉中客·其二<br>`sm2l3m3` 泉中客·其三 |
| 首墩<br>`nar_document_v1d2_9_1` | 未找到发放外键 | `a1m6d4` 环卫标兵·其四<br>`e11m1` 长风破浪<br>`e12m1` 入丹青<br>`e6m4` 潮涌汹汹<br>`e8m1` 水火不容<br>`e8m2` 致命邀约<br>`e8m3` 片缕幻影<br>`e8m5` 自由意志<br>`e9m2` 阵外潮起声犹震<br>`e9m4` 当时携手处<br>`f1m19d1` 据点建设·心脏修缮站·一<br>`f1m19d3` 据点建设·心脏修缮站·三<br>`m1m71` 拍摄巨兽心脏<br>`m1m72` 拍摄悬浮的“表象”<br>`m1m74` 日常·表象研究<br>`m1m77` 日常·表象研究<br>`m1m78` 日常·表象研究<br>`m1m79` 日常·表象研究<br>`sm2l4m4` 同袍·明天<br>`sm2l4m5` 重逢故人·其一<br>`sm2l4m6` 重逢故人·其二<br>`sm2l5m2` 再引春来·其二 |
| 宏山选剑局<br>`nar_document_v1d2_10_1` | 未找到发放外键 | `c27m2` 又是一波起<br>`e10m2` 大器晚成<br>`e10m3` 终则有始<br>`e6m1` 惊鸿一瞥<br>`e6m2` 东风就绪<br>`e9m4` 当时携手处<br>`f1m20` 装备精锻<br>`gm02m15` 古崖论剑<br>`gm02m6` 水中诡事<br>`gm02m7` 出师三剑<br>`sm2l10m1` 无终之恋<br>`sm2l6m1` 藏剑于谷<br>`sm2l8m1` 月往日来 |
| 岁兽<br>`nar_document_v1d2_11_1` | 未找到发放外键 | 未找到同名任务文本 |
| 枢壤仪<br>`nar_document_v1d2_12_1` | 未找到发放外键 | `e10m1` 墙崩因隙<br>`e10m2` 大器晚成<br>`e10m3` 终则有始<br>`e10m4` 志同道合<br>`e11m1` 长风破浪<br>`e11m2` 归途之始<br>`e11m3` 谈剑问迹<br>`e11m4` 物非人是<br>`e11m5` 异乡归人<br>`e11m7` “归途”<br>`f1m32` 填隙柱地<br>`m1m39` 拍摄枢壤仪 |
| 清波豪杰<br>`nar_document_v1d3_1_1` | 未找到发放外键 | `c31m2` 挑战<br>`c31m3` 拳心<br>`e5m1` 初探武陵 |
| 藏剑谷<br>`nar_document_v1d3_2_1` | 未找到发放外键 | `m1m75` 日常·失落机器人<br>`sm2l6m1` 藏剑于谷 |
| 北部禁区<br>`nar_document_v1d4_5_1` | 未找到发放外键 | `a1m16d1` 龙泡泡游记·其一<br>`a1m16d3` 龙泡泡游记·其三<br>`c31m2` 挑战<br>`e10m3` 终则有始<br>`e11m1` 长风破浪<br>`e11m2` 归途之始<br>`e11m3` 谈剑问迹<br>`e11m6` 拨云见日<br>`e11m8` 余晖未却<br>`e12m1` 入丹青<br>`e6m4` 潮涌汹汹<br>`e7m4` 旧泉涸处新潮生<br>`e8m1` 水火不容<br>`e9m4` 当时携手处<br>`f1m29d2` 据点建设·盈天台建设站·一<br>`f1m32` 填隙柱地<br>`gm02m20` 观蚀影记<br>`gm02m21` 有家难奔<br>`m1m61` 拍摄“旧庭树”<br>`sm2l4m5` 重逢故人·其一<br>`sm2l4m6` 重逢故人·其二<br>`sm2l7m1` 悲伤总无声<br>`sm2l8m1` 月往日来 |
| 应龙关<br>`nar_document_v1d4_2_1` | 未找到发放外键 | `c34m1` 迷雾藏起松林<br>`e11m1` 长风破浪<br>`e11m2` 归途之始<br>`e12m1` 入丹青<br>`e12m2` 知兴衰<br>`e12m5` 着新墨<br>`f1m29d1` 据点部署·盈天台建设站<br>`f1m29d2` 据点建设·盈天台建设站·一<br>`f1m29d3` 据点建设·盈天台建设站·二<br>`f1m29d4` 据点建设·盈天台建设站·三<br>`gm02m21` 有家难奔<br>`sm2l10m3` 纪念日 |
| 蚀影<br>`nar_document_v1d4_3_1` | 未找到发放外键 | `e11m1` 长风破浪<br>`e11m2` 归途之始<br>`e11m3` 谈剑问迹<br>`e11m4` 物非人是<br>`e11m5` 异乡归人<br>`e11m6` 拨云见日<br>`e11m8` 余晖未却<br>`e2m4` 园区穿行<br>`e2m5d5` 山道下行<br>`f1m29d1` 据点部署·盈天台建设站<br>`gm02m20` 观蚀影记<br>`gm02m23` 往日珍瑰<br>`sm2l3m2` 泉中客·其二<br>`sm2l4m1` 同袍·无名<br>`sm2l7m1` 悲伤总无声<br>`sm2l8m1` 月往日来 |
| 基石<br>`nar_document_v1d4_4_1` | 未找到发放外键 | `e11m1` 长风破浪<br>`e11m6` 拨云见日<br>`e11m8` 余晖未却<br>`e12m1` 入丹青<br>`e12m4` 洞我执<br>`e12m5` 着新墨<br>`e8m4` 静候光临 |
| 萨米维格<br>`nar_document_v1d5_1_1` | 未找到发放外键 | `c34m3` 长箭划破梦境<br>`e12m1` 入丹青<br>`e12m5` 着新墨<br>`sm2l9m1` 终其一生 |
| 巨兽<br>`nar_document_v1d5_2_1` | 未找到发放外键 | `c34m1` 迷雾藏起松林<br>`c34m2` 噩梦潜入雪地<br>`c34m3` 长箭划破梦境<br>`e11m1` 长风破浪<br>`e12m1` 入丹青<br>`e12m5` 着新墨<br>`e8m1` 水火不容<br>`e8m3` 片缕幻影<br>`e8m4` 静候光临<br>`e8m5` 自由意志<br>`e9m2` 阵外潮起声犹震<br>`f1m19d1` 据点建设·心脏修缮站·一<br>`f1m19d2` 据点建设·心脏修缮站·二<br>`f1m19d3` 据点建设·心脏修缮站·三<br>`f1m29d2` 据点建设·盈天台建设站·一<br>`m1m71` 拍摄巨兽心脏<br>`sm2l4m5` 重逢故人·其一<br>`sm2l4m6` 重逢故人·其二 |
| 兽主<br>`nar_document_v1d5_3_1` | 未找到发放外键 | `c34m1` 迷雾藏起松林 |
| 祀的画<br>`nar_document_v1d6_1_1` | 未找到发放外键 | `e12m1` 入丹青<br>`e12m2` 知兴衰<br>`e12m4` 洞我执 |
| 化物<br>`nar_document_v1d6_2_1` | 未找到发放外键 | `e12m1` 入丹青 |

## 全部隐藏任务复核

以下列出全部 missionType=Hide 任务的条件类型及任务依赖；没有具体档案发放字段的条目不能被当作档案解锁结论。完整信息保留在 JSON 的 hiddenMissions 中。

| 隐藏任务 | 条件类型 | 任务依赖 |
| --- | --- | --- |
| `dm01m3` | CheckUnlockTechLayer | 无公开任务依赖 |
| `dm01m4` | CheckUnlockTechLayer | 无公开任务依赖 |
| `dm01m5` | CheckUnlockTechLayer | 无公开任务依赖 |
| `dm01m7` | CheckUnlockTechLayer | 无公开任务依赖 |
| `dm01m8` | CheckUnlockTechLayer | 无公开任务依赖 |
| `e1m9d5` | CheckAdventureLevel, CheckMissionState, CheckPlayerInMap, CheckQuestState, CombineCondition, JumpToUITrackingInfo | `e1m9`<br>`e1m9d5_q#2` |
| `e5m0d5` | CheckAdventureLevel, CheckQuestState, JumpToUITrackingInfo | `e5m0d5_q#1` |
| `e9m3` | GameConditionServerPlaceHolder | 无公开任务依赖 |
| `gm01m23` | CheckQuestState, CheckTalkOptionFinish, GameConditionServerPlaceHolder, MissionAreaTrackingInfo, PlayRadio, ReachDestination | `gm01m23_q#9` |
| `gm02m27d5` | CheckPRTSUnlocked, CombineCondition, EntityTrackingInfo, GameConditionServerPlaceHolder, JumpToUITrackingInfo, MissionAreaTrackingInfo, PlayRadio, ReachDestination | 无公开任务依赖 |
| `gm02m27d6` | CheckTalkOptionFinish, NpcProxyTrackingInfo | 无公开任务依赖 |
| `hidden1` | 无客户端条件 | 无公开任务依赖 |
| `hidden10` | CheckPlayerInMap | 无公开任务依赖 |
| `hidden11` | CheckAdventureLevel, CheckMissionState, CheckQuestState, CheckUnlockTech, CheckWorldLevel, CombineCondition, FacBuildingCountInScene, OnFacPlaceBuilding, PlayerHasItem, ShowLimitedGuide | `a1m1_q#1`<br>`a1m4_q#1`<br>`e1m1`<br>`e1m1_q#14`<br>`e1m2_q#7`<br>`e1m3`<br>`e1m4_q#22`<br>`e1m6_q#5d1`<br>`e1m8`<br>`e1m9`<br>`e1m9_q#25`<br>`e1m9_q#3`<br>`e3m3`<br>`e5m1`<br>`e6m2_q#10`<br>`e6m4_q#45`<br>`e6m4_q#8`<br>`f1m25`<br>`m0m2` |
| `hidden12` | CheckQuestState, CheckUnlockTech, ManuallyStartGuideGroup, OnUIPanelClose, ShowLimitedGuide | `e1m9_q#6` |
| `hidden13` | CheckUnlockTech, ManuallyStartGuideGroup, OnUIPanelClose, ShowLimitedGuide | 无公开任务依赖 |
| `hidden14` | CheckUnlockTech, ManuallyStartGuideGroup, OnUIPanelClose, ShowLimitedGuide | 无公开任务依赖 |
| `hidden15` | CheckTalkOptionFinish, GameConditionServerPlaceHolder | 无公开任务依赖 |
| `hidden17` | CheckDomainDevelopmentLevel, CheckMissionChapterEarlyAccept, CheckMissionState, CheckQuestState, CheckSettlementLevel, CheckWorldLevel, CombineCondition, ManuallyAcceptClientGuideGroup, OnMailHasLostItem | `e1m9`<br>`e5m1_q#6`<br>`e6m2_q#12`<br>`e6m2_q#6`<br>`f1m5` |
| `hidden18` | CheckAdventureLevel | 无公开任务依赖 |
| `hidden20` | CheckDomainDevelopmentLevel, CheckMissionState, CheckQuestState, CombineCondition | `e1m1`<br>`e1m1_q#34`<br>`e1m3`<br>`e1m3_q#11`<br>`e1m3_q#57`<br>`e1m3_q#72`<br>`e1m4_q#9`<br>`e1m9_q#14`<br>`e1m9_q#2`<br>`e1m9_q#20`<br>`e1m9_q#25`<br>`e5m1_q#4`<br>`e5m2_q#12`<br>`e5m3_q#15`<br>`e6m2_q#10`<br>`e6m2_q#6`<br>`e6m2_q#8`<br>`e6m3_q#16`<br>`e6m4_q#8`<br>`gm01m6_q#4`<br>`m1m24`<br>`m1m9_q#1` |
| `hidden21` | CheckQuestState | `e2m4_q#12` |
| `hidden22` | CheckBuildingStateInArea, CheckMissionState, CheckQuestState, CombineCondition, FacProducePowerReach, FacStatisticItemGen, GameConditionServerPlaceHolder, ManuallyAcceptClientGuideGroup, ShowLimitedGuide | `f1m18d1_q#11`<br>`f1m4d1_q#3`<br>`f1m4d2_q#3`<br>`f1m4d3_q#5`<br>`f1m7d2_q#12`<br>`f1m7d3_q#11`<br>`f1m7d4_q#16`<br>`f1m9d1`<br>`f1m9d2_q#6`<br>`f1m9d3_q#1`<br>`f1m9d4_q#1`<br>`m1m24` |
| `hidden23` | 无客户端条件 | 无公开任务依赖 |
| `hidden24` | GameConditionServerPlaceHolder | 无公开任务依赖 |
| `hidden25` | CheckQuestState | `e6m4_q#6` |
| `hidden26` | CheckQuestState | `e6m2_q#8` |
| `hidden27` | CheckPlayerInMap, GameConditionServerPlaceHolder | 无公开任务依赖 |
| `hidden28` | CheckClientGlobalVar | 无公开任务依赖 |
| `hidden29` | CheckUnlockTech, ManuallyStartGuideGroup, OnUIPanelClose, ShowLimitedGuide | 无公开任务依赖 |
| `hidden30` | CheckAdventureLevel | 无公开任务依赖 |
| `hidden31` | CheckAdventureLevel, CheckMissionState, CombineCondition | `c27m5`<br>`e2m5` |
| `hidden32` | CheckAdventureLevel, CheckMissionState, CombineCondition | `e2m5`<br>`e6m5` |
| `hidden33` | 无客户端条件 | 无公开任务依赖 |
| `hidden34` | CheckAdventureLevel | 无公开任务依赖 |
| `hidden35` | CheckClientGlobalVar, CheckMissionState, CheckTalkOptionFinish, CombineCondition | `e7m4` |
| `hidden36` | GameConditionServerPlaceHolder | 无公开任务依赖 |
| `hidden37` | GameConditionServerPlaceHolder | 无公开任务依赖 |
| `hidden38` | GameConditionServerPlaceHolder | 无公开任务依赖 |
| `hidden39` | CheckMissionState, CheckQuestState, CheckSceneCollectionNum, OnFacZeroPower, ShowLimitedGuide | `e1m1`<br>`e1m4_q#1`<br>`e1m9_q#13`<br>`e7m1_q#18`<br>`e7m2_q#6` |
| `hidden40` | CheckUnlockTech, ManuallyStartGuideGroup, OnUIPanelClose, ShowLimitedGuide | 无公开任务依赖 |
| `hidden41` | CheckPlayerInMap, CombineCondition | 无公开任务依赖 |
| `hidden42_a1m9ending` | GameConditionServerPlaceHolder | 无公开任务依赖 |
| `hidden43` | GameConditionServerPlaceHolder | 无公开任务依赖 |
| `hidden44` | CheckMissionState, GameConditionServerPlaceHolder | `a1m6d6`<br>`a1m6d7` |
| `hidden45` | GameConditionServerPlaceHolder | 无公开任务依赖 |
| `hidden46` | CheckClientGlobalVar, CheckMissionState, CheckTalkOptionFinish, CombineCondition | `e7m4` |
| `hidden47_prtsv1d2unlock` | CheckMissionState, CheckQuestState | `e4m1d5_q#3`<br>`e6m1_q#8`<br>`e6m3_q#2`<br>`sm2l3m3` |
| `hidden48_gm02m16ending` | GameConditionServerPlaceHolder | 无公开任务依赖 |
| `hidden49` | CheckMissionState, CheckPlayerInMap, CheckQuestState, CheckSceneCollectionNum, CheckSettlementLevel, CombineCondition, ShowLimitedGuide | `e10m4`<br>`e1m6_q#2d1`<br>`e3m6`<br>`e8m1_q#1`<br>`sm2l5m3` |
| `hidden50_sm2l6m1box` | GameConditionServerPlaceHolder | 无公开任务依赖 |
| `hidden52` | GameConditionServerPlaceHolder | 无公开任务依赖 |
| `hidden53` | GameConditionServerPlaceHolder | 无公开任务依赖 |
| `hidden54_m0m2unlock` | CheckAdventureLevel, CheckMissionState, CombineCondition | `c27m5`<br>`e2m8` |
| `hidden55_m0m3unlock` | CheckAdventureLevel, CheckMissionState, CombineCondition | `c27m5`<br>`e3m6` |
| `hidden56_m0m4unlock` | CheckAdventureLevel, CheckMissionState, CombineCondition | `c27m5`<br>`e4m1d5`<br>`e5m3` |
| `hidden57_m0m5unlock` | CheckAdventureLevel, CheckMissionState, CombineCondition | `c27m5`<br>`e4m1d5`<br>`e6m5` |
| `hidden58` | CheckMissionChapterEarlyAccept, CheckMissionState, CheckQuestState, CheckUnlockWorldLevel, CombineCondition, ShowLimitedGuide | `c27m5`<br>`e5m1_q#4`<br>`e5m3`<br>`e6m2_q#19` |
| `hidden59` | CheckQuestState, CheckUnlockTech, ManuallyAcceptClientGuideGroup, OnUIPanelClose, ShowLimitedGuide | `e11m2_q#11`<br>`e11m3_q#10` |
| `hidden60` | CheckMissionChapterEarlyAccept, CheckQuestState | `e5m1_q#4` |
| `hidden61` | CheckQuestState, CheckWorldLevel, GameConditionServerPlaceHolder, OnFacShowBackupPower, OnFacStartBackupPower, ShowLimitedGuide | `e1m3_q#34`<br>`e1m6_q#9` |
| `hidden62` | CheckDomainShopChannelLevel, CheckGuideGroupComplete, CheckMissionChapterEarlyAccept, CheckMissionState, CheckQuestState, CheckSceneCollectionNum, CheckSeasonTowerLevelAchieveCount, CheckUnlockTech, CheckWorldLevel, CombineCondition, OnUIPanelClose, PlayerHasItem, ShowLimitedGuide | `db01m10_q#2`<br>`e1m10`<br>`e5m1_q#4`<br>`e5m1_q#6`<br>`e5m3`<br>`e6m2_q#19`<br>`e6m4_q#2`<br>`e6m5`<br>`f1m3d1_q#20` |
| `hidden63` | CheckMissionState, CheckUnrepeatableRewardIdGot, CombineCondition | `e10m4`<br>`e11m8`<br>`e2m8`<br>`e3m6`<br>`e4m1d5`<br>`e6m5`<br>`e9m3` |
| `hidden64` | GameConditionServerPlaceHolder | 无公开任务依赖 |
| `hidden65_sm2l2m7formula` | GameConditionServerPlaceHolder | 无公开任务依赖 |
| `hidden66` | GameConditionServerPlaceHolder | 无公开任务依赖 |
| `hidden67` | GameConditionServerPlaceHolder | 无公开任务依赖 |
| `hidden68_m1m80` | PlayerHasItem | 无公开任务依赖 |
| `hidden69` | CheckMissionState, CheckQuestState, CheckSpaceshipRoomLevel, CheckUnlockWorldLevel, OnFoodBoxPicked, ShowLimitedGuide | `e1m9`<br>`f1m36_q#15`<br>`f1m36_q#8` |
| `hidden7` | CheckAdventureLevel | 无公开任务依赖 |
| `hidden70` | CheckQuestState, CheckUnlockTech, CheckUnlockWorldLevel | `e6m4_q#1` |
| `hidden72_c34m` | CheckLevelScriptPropertyBool, GameConditionServerPlaceHolder | 无公开任务依赖 |
| `hidden73` | CheckMapVar, CheckTalkOptionFinish, GameConditionServerPlaceHolder | 无公开任务依赖 |
| `hidden74_a1m15` | GameConditionServerPlaceHolder | 无公开任务依赖 |
| `hidden76` | CheckPassedSpecifiedShootingRangeSimulationLevelIds | 无公开任务依赖 |
| `hidden79_a1m19` | GameConditionServerPlaceHolder | 无公开任务依赖 |
| `hidden8` | CheckAdventureLevel, CheckSNSDialogComplete, CombineCondition | 无公开任务依赖 |
| `hidden82_a1m19` | GameConditionServerPlaceHolder | 无公开任务依赖 |
| `hidden9` | CheckIsLimitedGuideShowing, CombineCondition, OnBattleBuffAdded, ShowLimitedGuide | 无公开任务依赖 |
| `m0m1` | CheckBuildingConnected | 无公开任务依赖 |

## 重新生成

在 Atlos 根目录运行；审计脚本读取 AKEData，不修改源数据。

```sh
python3 ../endfield-bots/intels/audit_archive_missions.py --source /path/to/AKEData --contract talos/apps/intel/src/data/generated/archive_contract.json --output docs
```
