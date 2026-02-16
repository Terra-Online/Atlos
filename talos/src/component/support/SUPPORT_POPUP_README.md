# Support 弹窗自动显示功能

## 功能说明

该功能允许在网站加载时自动显示 Support（支持我们）弹窗，用于提醒用户支持项目。

## 主要特性

- ✅ **无周期限制**：用户关闭后，当前版本的弹窗不会再次显示
- ✅ **版本控制**：通过修改版本号，可以在新发版时重新显示弹窗
- ✅ **智能显示**：不会在用户引导（User Guide）进行时显示
- ✅ **延迟加载**：延迟 1 秒显示，避免与其他初始化弹窗冲突
- ✅ **持久化记录**：使用 localStorage 记录用户已查看的版本

## 文件结构

```
src/component/support/
├── support.tsx              # Support 弹窗 UI 组件（已存在）
├── SupportAutoPopup.tsx     # 自动弹出逻辑组件（新增）
└── supportConfig.ts         # 弹窗配置文件（新增）
```

## 使用方法

### 1. 启用自动弹窗（已默认启用）

弹窗组件已集成到 `App.tsx` 中，无需额外配置即可使用。

### 2. 控制弹窗显示

**当需要在新版本中显示 Support 弹窗时**，编辑 `supportConfig.ts` 文件：

```typescript
export const SUPPORT_CONFIG = {
    // ⚠️ 修改此版本号以在下次发版时显示 Support 弹窗
    version: '2025-02-17',  // 👈 修改这里的版本号
    
    delayMs: 1000,
    storageKey: 'support-popup-viewed',
} as const;
```

**版本号格式建议**：
- 日期格式：`'2025-02-16'`
- 语义化版本：`'v1.0.0'`, `'v1.1.0'`
- 自定义标识：`'support-update-q1'`, `'2025-spring'`

### 3. 测试弹窗

开发环境测试方法：

1. **清除已查看记录**：
   ```javascript
   // 在浏览器控制台执行
   localStorage.removeItem('support-popup-viewed');
   ```

2. **刷新页面**：重新加载页面即可看到弹窗

3. **验证记录**：
   ```javascript
   // 在浏览器控制台查看已查看版本
   JSON.parse(localStorage.getItem('support-popup-viewed'));
   // 输出: { viewedVersions: ['2025-02-16'] }
   ```

### 4. 配置选项

在 `supportConfig.ts` 中可以调整：

```typescript
export const SUPPORT_CONFIG = {
    version: '2025-02-16',     // 当前弹窗版本
    delayMs: 1000,             // 延迟显示时间（毫秒）
    storageKey: '...',         // localStorage 存储键名
} as const;
```

## 工作原理

1. **页面加载**：`SupportAutoPopup` 组件加载
2. **检查条件**：
   - 用户引导是否进行中？（是 → 不显示）
   - 当前版本是否已查看？（是 → 不显示）
3. **显示弹窗**：延迟 1 秒后显示
4. **记录版本**：用户关闭后，记录当前版本号到 localStorage

## 数据存储

**localStorage key**: `support-popup-viewed`

**数据结构**:
```json
{
  "viewedVersions": ["2025-02-16", "v1.0.0", "v1.1.0"]
}
```

## 与 DomainBanner 的区别

| 特性 | DomainBanner | SupportAutoPopup |
|------|--------------|------------------|
| 显示条件 | 基于用户地理位置 | 基于版本号 |
| 周期限制 | 30 天后重新显示 | 无周期，版本控制 |
| 关闭后 | 30 天内不再显示 | 当前版本永久不显示 |
| 重新显示 | 等待过期时间 | 修改版本号 |

## 常见问题

**Q: 如何让所有用户重新看到弹窗？**  
A: 修改 `supportConfig.ts` 中的 `version` 为新值。

**Q: 弹窗会每次打开网站都显示吗？**  
A: 不会。用户关闭后，该版本的弹窗不会再次显示。

**Q: 如何临时禁用弹窗？**  
A: 注释掉 `App.tsx` 中的 `<SupportAutoPopup />` 组件。

**Q: 弹窗显示时机可以调整吗？**  
A: 可以。修改 `supportConfig.ts` 中的 `delayMs` 值。

## 开发日志

- 2025-02-16: 初始版本，实现基于版本号的自动弹窗功能
