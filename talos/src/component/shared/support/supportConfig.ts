/**
 * Support 弹窗自动显示配置
 * 
 * 使用说明：
 * 1. 每次需要显示 Support 弹窗时，修改下面的 SUPPORT_POPUP_VERSION
 * 2. 版本号可以使用日期（如 '2025-02-16'）、语义化版本（如 'v1.0.0'）或其他唯一标识符
 * 3. 用户关闭弹窗后，该版本号会被记录到 localStorage，下次不再显示
 * 4. 发布新的 Support 内容更新时，更新版本号即可重新显示弹窗
 */

export const SUPPORT_CONFIG = {
    // ⚠️ 修改此版本号以在下次发版时显示 Support 弹窗
    version: '20260216',
    
    // 弹窗延迟显示时间（毫秒）
    delayMs: 500,
    
    // localStorage 存储 key
    storageKey: 'support-prefs',
} as const;
