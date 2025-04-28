import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 获取当前文件的目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 将字符串转换为仅包含小写字母、数字和下划线的格式
 * @param {string} str 原始字符串
 * @returns {string} 格式化后的字符串
 */
function formatKey(str) {
    // 转换为小写
    let formatted = str.toLowerCase();
    
    // 替换希腊字母
    formatted = formatted
        .replace(/α/g, 'a')
        .replace(/β/g, 'b')
        .replace(/γ/g, 'g')
        .replace(/δ/g, 'd')
        .replace(/ε/g, 'e')
        .replace(/ζ/g, 'z')
        .replace(/η/g, 'e')
        .replace(/θ/g, 'th')
        .replace(/ι/g, 'i')
        .replace(/κ/g, 'k')
        .replace(/λ/g, 'l')
        .replace(/μ/g, 'm')
        .replace(/ν/g, 'n')
        .replace(/ξ/g, 'x')
        .replace(/ο/g, 'o')
        .replace(/π/g, 'p')
        .replace(/ρ/g, 'r')
        .replace(/σ/g, 's')
        .replace(/τ/g, 't')
        .replace(/υ/g, 'y')
        .replace(/φ/g, 'f')
        .replace(/χ/g, 'ch')
        .replace(/ψ/g, 'ps')
        .replace(/ω/g, 'o');
    
    // 替换空格和其他分隔符为下划线
    formatted = formatted.replace(/[\s\-\.]+/g, '_');
    
    // 移除其他非字母数字字符
    formatted = formatted.replace(/[^a-z0-9_]/g, '');
    
    // 移除连续的下划线
    formatted = formatted.replace(/_+/g, '_');
    
    // 移除开头和结尾的下划线
    formatted = formatted.replace(/^_+|_+$/g, '');

    return formatted;
}

/**
 * 读取并解析 types.json 文件
 * @returns {Object} 解析后的类型数据对象
 */
export function loadTypeData() {
    try {
        // 使用相对于脚本文件的路径
        const filePath = path.join(__dirname, '..', '..', 'src', 'data', 'types.json');
        console.log('Reading file from:', filePath);
        const rawData = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(rawData);
        console.log('Data loaded successfully');
        return data;
    } catch (error) {
        console.error('读取 types.json 文件失败:', error);
        return {};
    }
}

/**
 * 将三级结构转换为以第三级key为键的字典
 * @returns {Object} 转换后的字典对象
 */
export function convertToKeyDict() {
    const typeData = loadTypeData();
    const result = {};

    // 遍历主类型
    for (const mainType in typeData) {
        console.log('Processing mainType:', mainType);
        // 遍历子类型
        for (const subType in typeData[mainType]) {
            console.log('Processing subType:', subType);
            // 遍历具体类型
            for (const keyType in typeData[mainType][subType]) {
                console.log('Processing keyType:', keyType);
                // 跳过空的 key
                if (!keyType) {
                    console.log('Skipping empty key');
                    continue;
                }
                
                // 格式化 key
                const formattedKey = formatKey(keyType);
                if (!formattedKey) {
                    console.log('Skipping empty formatted key');
                    continue;
                }
                
                console.log('Adding key:', formattedKey);
                // 创建新的对象结构
                result[formattedKey] = {
                    key: formattedKey,
                    name: keyType, // 使用原始名称
                    category: {
                        main: mainType,
                        sub: subType
                    }
                };
            }
        }
    }

    return result;
}

/**
 * 获取指定类型的完整路径
 * @param {string} mainType 主要类型
 * @param {string} subType 子类型
 * @param {string} keyType 具体类型
 * @returns {string} 完整的类型路径
 */
export function getTypePath(mainType, subType, keyType) {
    return `${mainType}.${subType}.${keyType}`;
}

/**
 * 获取指定类型的层级信息
 * @param {string} mainType 主要类型
 * @param {string} subType 子类型
 * @param {string} keyType 具体类型
 * @returns {string|null} 层级信息，如果不存在则返回 null
 */
export function getTypeTier(mainType, subType, keyType) {
    const typeData = loadTypeData();
    try {
        return typeData[mainType][subType][keyType].tier || null;
    } catch (error) {
        return null;
    }
}

/**
 * 获取指定主类型下的所有子类型
 * @param {string} mainType 主要类型
 * @returns {Array} 子类型数组
 */
export function getSubTypes(mainType) {
    const typeData = loadTypeData();
    return Object.keys(typeData[mainType] || {});
}

/**
 * 获取指定主类型和子类型下的所有具体类型
 * @param {string} mainType 主要类型
 * @param {string} subType 子类型
 * @returns {Array} 具体类型数组
 */
export function getKeyTypes(mainType, subType) {
    const typeData = loadTypeData();
    try {
        return Object.keys(typeData[mainType][subType] || {});
    } catch (error) {
        return [];
    }
}

/**
 * 检查类型是否存在
 * @param {string} mainType 主要类型
 * @param {string} subType 子类型
 * @param {string} keyType 具体类型
 * @returns {boolean} 是否存在该类型
 */
export function hasType(mainType, subType, keyType) {
    const typeData = loadTypeData();
    try {
        return !!typeData[mainType][subType][keyType];
    } catch (error) {
        return false;
    }
}

/**
 * 获取指定层级的所有类型
 * @param {string} tier 层级名称
 * @returns {Array} 包含指定层级的所有类型路径数组
 */
export function getTypesByTier(tier) {
    const typeData = loadTypeData();
    const result = [];

    for (const mainType in typeData) {
        for (const subType in typeData[mainType]) {
            for (const keyType in typeData[mainType][subType]) {
                if (typeData[mainType][subType][keyType].tier === tier) {
                    result.push(getTypePath(mainType, subType, keyType));
                }
            }
        }
    }

    return result;
}

/**
 * 运行转换并将结果写入文件
 */
export function generateTypeJson() {
    try {
        // 运行转换
        const keyDict = convertToKeyDict();
        
        // 确保目标目录存在
        const targetDir = path.join(__dirname, '..', '..', 'src', 'data', 'mark');
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }
        
        // 写入文件
        const targetPath = path.join(targetDir, 'type.json');
        fs.writeFileSync(targetPath, JSON.stringify(keyDict, null, 4), 'utf8');
        
        console.log('成功生成 type.json 文件');
    } catch (error) {
        console.error('生成 type.json 文件失败:', error);
    }
}

// 如果直接运行此文件，则执行转换
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    generateTypeJson();
}
