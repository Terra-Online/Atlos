import json
import os
import glob
from typing import Dict, List, Any
from datetime import datetime

def format_key(s: str) -> str:
    """将字符串标准化为小写、下划线分隔的格式"""
    if not s or not isinstance(s, str):
        return ""
    
    # 转换为小写
    formatted = s.lower()
    
    # 替换希腊字母
    greek_map = {
        'α': 'a', 'β': 'b', 'γ': 'g', 'δ': 'd', 'ε': 'e', 'ζ': 'z', 'η': 'e',
        'θ': 'th', 'ι': 'i', 'κ': 'k', 'λ': 'l', 'μ': 'm', 'ν': 'n', 'ξ': 'x',
        'ο': 'o', 'π': 'p', 'ρ': 'r', 'σ': 's', 'τ': 't', 'υ': 'y', 'φ': 'f',
        'χ': 'ch', 'ψ': 'ps', 'ω': 'o'
    }
    for greek, latin in greek_map.items():
        formatted = formatted.replace(greek, latin)
    
    # 替换空格和其他分隔符为下划线
    import re
    formatted = re.sub(r'[\s\-\.]+', '_', formatted)
    
    # 移除非字母数字字符
    formatted = re.sub(r'[^a-z0-9_]', '', formatted)
    
    # 移除连续下划线
    formatted = re.sub(r'_+', '_', formatted)
    
    # 移除首尾下划线
    formatted = formatted.strip('_')
    
    return formatted

def load_json_file(file_path):
    """从JSON文件加载数据"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"加载文件 {file_path} 时出错: {e}")
        return {}

def safe_load_json_with_comments(file_path):
    """加载可能包含注释的JSON文件"""
    try:
        if os.path.exists(file_path):
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read().strip()
                if content:
                    # 处理JSON中可能存在的注释
                    import re
                    content = re.sub(r'//.*?\n', '\n', content)  # 去除单行注释
                    # 尝试解析处理后的内容
                    try:
                        return json.loads(content)
                    except json.JSONDecodeError as je:
                        print(f"解析 {file_path} 时出错: {je}")
        return {}
    except Exception as e:
        print(f"加载文件 {file_path} 时出错: {e}")
        return {}

def process_marker_data():
    """处理标记数据并输出到文件"""
    # 创建必要的目录
    ref_dir = 'ref'
    input_dir = 'input'
    output_dir = 'output'
    log_dir = os.path.join(output_dir, 'log')  # 创建日志目录
    
    os.makedirs(output_dir, exist_ok=True)
    os.makedirs(log_dir, exist_ok=True)  # 确保日志目录存在
    
    # 使用字典和集合记录映射关系
    successful_mappings_dict = {}  # 使用字典去重
    failed_mappings_set = set()    # 使用集合去重
    unchanged_mappings_set = set() # 使用集合记录映射成功但未改变的键
    
    # 加载所有外部映射
    print("加載外部映射詞典...")
    
    # 加载类型参照（处理可能的注释）
    type_dict = safe_load_json_with_comments(os.path.join(ref_dir, 'type.json'))
    if not type_dict:
        print("警告：类型参照加载失败，将使用原始类型值")
    
    # 加载区域映射
    region_dict = load_json_file(os.path.join(ref_dir, 'region.json'))
    if not region_dict:
        print("警告：区域映射加载失败，将使用原始区域值")
    
    # 加载子区域映射
    subregion_dict = load_json_file(os.path.join(ref_dir, 'subregion.json'))
    if not subregion_dict:
        print("警告：子区域映射加载失败，将使用原始子区域值")
    
    # 加载所有其他映射文件
    all_mappings = {}
    for map_file in glob.glob(os.path.join(ref_dir, '*.json')):
        filename = os.path.basename(map_file)
        if filename not in ['type.json', 'region.json', 'subregion.json']:
            map_name = os.path.splitext(filename)[0]  # 移除 .json 后缀
            map_data = load_json_file(map_file)
            if map_data:
                # 格式化字符串值
                formatted_data = {}
                for k, v in map_data.items():
                    if isinstance(v, str):
                        formatted_data[k] = format_key(v)
                    else:
                        formatted_data[k] = v
                all_mappings[map_name] = formatted_data
                print(f"已加载映射: {map_name}")
    
    # 读取所有输入文件
    print("讀取輸入檔案...")
    all_data = []
    for json_file in glob.glob(os.path.join(input_dir, '*.json')):
        try:
            file_data = load_json_file(json_file)
            if isinstance(file_data, list):
                all_data.extend(file_data)
                print(f"已載入: {json_file} ({len(file_data)} 个點位)")
            else:
                print(f"跳过非列表数据: {json_file}")
        except Exception as e:
            print(f"处理文件 {json_file} 时出错: {e}")
    
    print(f"最終載入 {len(all_data)} 个點位")
    
    # 处理数据
    processed_data = []
    for item in all_data:
        if not isinstance(item, dict):
            continue
            
        try:
            # 提取类型和区域信息
            type_key = ""
            if isinstance(item.get('type'), dict):
                type_key = item['type'].get('key', '')
            elif isinstance(item.get('type'), str):
                type_key = item['type']
                
            region_main = ""
            region_sub = ""
            if isinstance(item.get('region'), dict):
                region_main = item['region'].get('main', '')
                region_sub = item['region'].get('sub', '')
            
            # 应用区域映射
            main_region = region_dict.get(region_main, region_main) if region_dict else region_main
            sub_region = ""
            if subregion_dict and main_region in subregion_dict:
                sub_region = subregion_dict[main_region].get(region_sub, region_sub)
            else:
                sub_region = region_sub
            
            # 确定类型
            item_type = type_key
            mapping_found = False
            mapping_source = ""
            
            # 先检查type字典
            if type_dict and type_key in type_dict:
                # 直接使用类型键名
                item_type = type_key
                mapping_found = True
                mapping_source = "type.json"
            else:
                # 检查其他所有映射
                for map_name, map_dict in all_mappings.items():
                    if type_key in map_dict:
                        item_type = map_dict[type_key]
                        mapping_found = True
                        mapping_source = map_name
                        break
            
            # 记录唯一的映射结果
            if mapping_found:
                if item_type == type_key:  # 映射前后值相同
                    unchanged_mappings_set.add(type_key)
                else:
                    # 只记录唯一且值有变化的键值对和来源
                    successful_mappings_dict[type_key] = {
                        "value": item_type,
                        "source": mapping_source
                    }
            else:
                # 只记录唯一的未映射键
                failed_mappings_set.add(type_key)
            
            # 创建处理后的项目
            processed_item = dict(item)  # 创建副本而不是修改原始数据
            
            # 添加必要的字段
            processed_item['position'] = item.get('position', item.get('pos', []))
            processed_item['subregionId'] = sub_region or main_region
            processed_item['type'] = item_type
            
            # 移除不需要的字段
            for field in ['pos', 'region', 'meta']:
                if field in processed_item:
                    del processed_item[field]
                    
            processed_data.append(processed_item)
        except Exception as e:
            print(f"处理项目时出错: {e}")
            print(f"问题项目: {item}")
    
    print(f"成功處理 {len(processed_data)} 个點位")
    
    # 按子区域分类
    categorized_data = {}
    for item in processed_data:
        subregion_id = item.get('subregionId', 'unknown')
        if subregion_id not in categorized_data:
            categorized_data[subregion_id] = []
        categorized_data[subregion_id].append(item)
    
    # 输出到文件
    for subregion_id, items in categorized_data.items():
        output_file = os.path.join(output_dir, f"{subregion_id}.json")
        try:
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(items, f, indent=2, ensure_ascii=False)
            print(f"成功写入: {output_file} ({len(items)} 个點位)")
        except Exception as e:
            print(f"写入文件 {output_file} 时出错: {e}")
    
    # 将字典和集合转换为列表
    successful_mappings = [{"key": k, **v} for k, v in successful_mappings_dict.items()]
    failed_mappings = [{"key": k} for k in failed_mappings_set]
    unchanged_mappings = [{"key": k} for k in unchanged_mappings_set]
    
    # 创建简化的映射对象
    successful_mappings_simple = {k: v["value"] for k, v in successful_mappings_dict.items()}
    failed_mappings_keys = {k: k for k in failed_mappings_set}  # 使用键作为值
    unchanged_mappings_keys = {k: k for k in unchanged_mappings_set}  # 未变化的键
    
    # 生成并输出日志文件
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_file = os.path.join(log_dir, f"mapping_log_{timestamp}.json")  # 保存到log目录
    
    log_data = {
        "timestamp": datetime.now().isoformat(),
        "total_processed": len(all_data),
        "successful_mappings_count": len(successful_mappings),
        "failed_mappings_count": len(failed_mappings),
        "unchanged_mappings_count": len(unchanged_mappings),
        "successful_mappings": successful_mappings,
        "failed_mappings": failed_mappings,
        "unchanged_mappings": unchanged_mappings,
        "successful_mappings_simple": successful_mappings_simple,
        "failed_mappings_keys": failed_mappings_keys,
        "unchanged_mappings_keys": unchanged_mappings_keys
    }
    
    try:
        with open(log_file, 'w', encoding='utf-8') as f:
            json.dump(log_data, f, indent=2, ensure_ascii=False)
        print(f"成功寫入日誌: {log_file}")
        print(f"  - 成功映射(有變化): {len(successful_mappings)} 个唯一類型")
        print(f"  - 成功映射(未變化): {len(unchanged_mappings)} 个唯一類型")
        print(f"  - 未找到映射: {len(failed_mappings)} 个唯一類型")
    except Exception as e:
        print(f"写入日志文件时出错: {e}")
    
    # 单独输出简化的映射文件，方便直接使用
    simple_mapping_file = os.path.join(log_dir, f"simple_mappings_{timestamp}.json")  # 保存到log目录
    try:
        simple_mappings = {
            "successful": successful_mappings_simple,
            "failed": failed_mappings_keys,
            "unchanged": unchanged_mappings_keys
        }
        with open(simple_mapping_file, 'w', encoding='utf-8') as f:
            json.dump(simple_mappings, f, indent=2, ensure_ascii=False)
        print(f"成功写入简化映射文件: {simple_mapping_file}")
    except Exception as e:
        print(f"写入简化映射文件时出错: {e}")
    
    print(f"處理完畢，共輸出 {len(categorized_data)} 个檔案")

if __name__ == "__main__":
    process_marker_data()