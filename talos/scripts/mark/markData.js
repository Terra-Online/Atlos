import fs from 'fs';
import path from 'path';
import { convertToKeyDict } from './markType.js';

const regionDict = {
    "JL": "Jinlong",
    "VL": "Valley_4",
    "DJ": "Dijiang",
}

const subregionDict = {
    "Valley_4": {
        "pane_1": "subregion-6",
        "pane_2": "subregion-5",
        "pane_3": "subregion-4",
        "pane_5": "subregion-3",
        "pane_6": "subregion-2",
        "pane_7": "subregion-1",
    },
    Dijiang: {
        "pane_1": "Dijiang",
    },
    "Jinlong": {
        "pane_1": "Jinlong",
    }

}

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

const dict = {
    "eny_0007_mimicw": "Poison Ivy",
    "eny_0018_lbtough": "Bonekrusher Executioner",
    "eny_0021_agmelee": "Ram",
    "eny_0023_aghornb": "Heavy Ram",
    "eny_0025_agrange": "Sting",
    "eny_0027_agscorp": "Heavy Sting",
    "eny_0029_lbmob": "Bonekrusher Raider",
    "eny_0033_lbhunt": "Bonekrusher Ambusher",
    "eny_0045_agtrinit": "Triaggelos",
    "eny_0046_lbshamman": "Bonekrusher Pyromancer",
    "eny_0047_firebat": "Bonekrusher Arsonist",
    "eny_0048_hvybow": "Bonekrusher Ballista",
    "eny_0049_rogue": "Bonekrusher Infiltrator",
    "eny_0050_hound": "Bonekrusher Ripptusk",
    "eny_0051_rodin": "Rhodagn",
    "eny_0053_hsmob": "Road Plunderer",
    "eny_0054_hsmino": "Hill Smasher",
    "eny_0055_hscrane": "Cloud Stalker",
    "eny_0058_agdisk": "Effigy",
    "eny_0059_erhound": "Blighted Tuskbeast",
    "eny_0061_palecore": "Marble Appendage",
    "eny_0062_paletent": "Marble Aggelomoirai",
    "eny_0063_agmelee2": "Ram α",
    "eny_0064_agrange2": "Sting α",
    "eny_0065_lbmob2": "Elite Raider",
    "eny_0066_lbhunt2": "Elite Ambusher",
    "eny_0067_hound2": "Elite Ripptusk",
    "eny_0068_lbtough2": "Elite Executioner",
    "eny_0069_aghornb2": "Heavy Ram α",
    "eny_0070_agscorp2": "Heavy Sting α",
    "eny_0035_lbhunt3": "eny_0035_lbhunt3",
    "eny_0031_lbmob3": "eny_0031_lbmob3",
    "eny_0026_agrange2": "eny_0026_agrange2",
    "eny_0060_lbmad": "Blighted Klaw",
    "eny_0024_aghornb2": "eny_0024_aghornb2",
    "eny_0022_agmelee2": "eny_0022_agmelee2",
    "eny_0034_lbhunt2": "eny_0034_lbhunt2",
    "eny_0052_palesent": "eny_0052_palesent",
    "eny_0030_lbmob2": "eny_0030_lbmob2",
    "eny_0039_agcanno": "eny_0039_agcanno",
    "eny_0028_agscorp2": "eny_0028_agscorp2",
    "eny_0032_lbmob4": "eny_0032_lbmob4"
}
Object.keys(dict).forEach(key => {
    dict[key] = formatKey(dict[key]);
});

/**
 * 读取并处理数据文件
 * @returns {Array} 处理后的合并数据数组
 */
export function loadAndProcessData() {
    try {
        // 读取文件
        const coinPath = path.join('originData', 'coin.json');
        const markPath = path.join('originData', 'marker.json');
        const enemyPath = path.join('originData', 'enemy.json');

        console.log('正在读取数据文件...');
        const coinData = JSON.parse(fs.readFileSync(coinPath, 'utf8'));
        const markData = JSON.parse(fs.readFileSync(markPath, 'utf8'));
        const enemyData = JSON.parse(fs.readFileSync(enemyPath, 'utf8'));
        // 获取类型字典
        const typeDict = convertToKeyDict();

        const data = [...markData, ...enemyData];

        // 处理硬币数据
        const processedData = data.map(item => {
            const type = item.type.key
            const main = regionDict[item.region.main] ?? item.region.main
            const sub = subregionDict[main][item.region.sub] ?? item.region.sub

            const result = {
                ...item,
                position: (item.position ?? item.pos),
                subregionId: sub ?? main,
                type: typeDict[type]?.key || dict[type] || type
            }

            // if (item.type.key.startsWith("eny")) {
            //     result.position = [-960 - result.position[0], result.position[1]]
            // }
            return result
        });


        processedData.forEach(item => {
            delete item.pos;
            delete item.region;
            delete item.meta;
        });

        console.log('数据处理完成');
        return processedData;

    } catch (error) {
        console.error('数据处理失败:', error);
        return [];
    }
}


const markData = loadAndProcessData()

// 按照 subregionId 分类数据并写入不同文件
const categorizedData = markData.reduce((acc, item) => {
    const subregionId = item.subregionId;
    if (!acc[subregionId]) {
        acc[subregionId] = [];
    }
    acc[subregionId].push(item);
    return acc;
}, {});

// 将分类后的数据写入不同文件
Object.entries(categorizedData).forEach(([subregionId, items]) => {
    const filePath = `./src/data/marker/data/${subregionId}.json`;
    fs.writeFileSync(filePath, JSON.stringify(items, null, 2));
});
