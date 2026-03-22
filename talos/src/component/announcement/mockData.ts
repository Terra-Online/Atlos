// TODO: remove
export interface AnnouncementItem {
    id: string;
    title: string;
    description: string;
    content: string; // Markdown body
}

/**
 * Mock announcement data.
 * In the future, this will be fetched from a network API returning markdown files
 * with YAML frontmatter (title, description) followed by the markdown body.
 */
export const MOCK_ANNOUNCEMENTS: AnnouncementItem[] = [
    {
        id: 'v1.1',
        title: '版本更新公告',
        description: '1.1版本更新说明：档案标记点与新增功能介绍',
        content: `# Major Update for 1.1

## Omnipresent, Efficient, Meticulous.

各位用户，欢迎查收本期更新公告，感谢各位在前段时间的使用与支持。我们为各位带来了如下的最新功能：

1. **新增标记点。**
2. **交互行为：**

我们新增了批量选择功能，允许用户通过框选操作同时选中多个标记点，大幅提升了批量管理的效率。

## 改进列表

- 优化了地图瓦片加载速度
- 修复了在部分设备上标记点位置偏移的问题
- 改进了移动端手势操作体验

## 后续计划

我们将持续迭代更新，为大家带来更多实用功能，敬请期待！
`,
    },
    {
        id: 'v1.0-cookie',
        title: '版本更新公告2',
        description: 'Open Endfield Map Cookie 与本地数据同步政策。',
        content: `## Cookie 与本地存储技术概述

为了提供流畅、个性化且安全的地图交互体验，我们需要在您的设备上存储少量数据。我们主要依赖以下两种技术：

1. **Cookie**：是由网站发送并存储在您浏览器中的小型文本文件。它们通常用于识别您的设备、维持登录会话状态、提升安全性或记录您的基础访问偏好。
2. **本地存储（LocalStorage / IndexedDB）**：这是现代浏览器提供的数据存储机制，允许我们在您的设备上保存比 Cookie 更大、结构更复杂的数据（如您在地图上标注的点位、图层筛选状态等）。

## 我们为何使用这些技术

我们使用 Cookie 及相关存储技术的目的分为以下四大类：

1. **维持网站核心功能（必要性操作）**
2. **提升性能与用户体验（功能性操作）**
3. **安全与合规保障**
4. **分析与服务改进（分析性操作）**
`,
    },
    {
        id: 'v1.0-notice',
        title: '版本更新公告3',
        description: '地图数据与标记点同步更新说明。',
        content: `## 数据更新说明

本次更新同步了最新游戏版本的地图数据，修复了若干已知标记点位置问题。

- 新增 Valley_4 区域标记点数据
- 修复了 Wuling 子区域边界显示异常
- 优化了数据加载性能
`,
    },
];
