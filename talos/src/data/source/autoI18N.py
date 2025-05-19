import json
import sys
import os
from tqdm import tqdm
import re

# Global constants for paths and configuration
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REF_DIR = os.path.join(SCRIPT_DIR, "ref")
REF_FILE = os.path.join(REF_DIR, "_REF.json")
SUPPORTED_LANGUAGES = ["EN", "TC", "SC", "JP"]
IGNORE_SUFFIXES = [" Spot"]

def normalize_key(key):
    """Normalize key to lowercase and replace spaces with underscores"""
    if not isinstance(key, str):
        return key

    formatted = key.lower()
    # fallback for non-ascii characters
    greek_replacements = {
        'α': 'a', 'β': 'b', 'γ': 'g', 'δ': 'd', 'ε': 'e',
        'ζ': 'z', 'η': 'e', 'θ': 'th', 'ι': 'i', 'κ': 'k',
        'λ': 'l', 'μ': 'm', 'ν': 'n', 'ξ': 'x', 'ο': 'o',
        'π': 'p', 'ρ': 'r', 'σ': 's', 'τ': 't', 'υ': 'y',
        'φ': 'f', 'χ': 'ch', 'ψ': 'ps', 'ω': 'o'
    }
    for greek, latin in greek_replacements.items():
        formatted = formatted.replace(greek, latin)
    # change any split characters to underscore
    formatted = re.sub(r'[\s\-\.]+', '_', formatted)
    # remove any non-alphanumeric characters
    formatted = re.sub(r'[^a-z0-9_]', '', formatted)
    # merge consecutive underscores
    formatted = re.sub(r'_+', '_', formatted)
    # remove any leading/trailing underscores
    formatted = formatted.strip('_')

    return formatted

def remove_ignore_suffixes(value):
    """Remove ignored suffixes from the value for better matching"""
    if not isinstance(value, str):
        return value
    
    # Check and remove suffixes
    result = value
    for suffix in IGNORE_SUFFIXES:
        if result.endswith(suffix):
            result = result[:-len(suffix)]
            break
            
    return result

def unicode_escape(s):
    """Convert single quotes in a string to \u0027 format"""
    if isinstance(s, str):
        return s.replace("'", "\\u0027")
    return s

def full_unicode_escape(s):
    """Convert entire string to Unicode escape format"""
    if isinstance(s, str):
        return ''.join(f'\\u{ord(c):04x}' for c in s)
    return s

def convert_to_hashable(value):
    """Convert unhashable values to hashable format"""
    if isinstance(value, (list, dict)):
        # Convert to JSON string to use as dictionary key
        return json.dumps(value, sort_keys=True)
    return value

def build_value_to_key_map(json_obj):
    """Build a mapping from values to keys in the English JSON"""
    result = {}
    unicode_result = {}  # For fully Unicode escaped forms
    # Calculate total items to process
    total_items = 0
    def count_items(obj):
        nonlocal total_items
        if isinstance(obj, dict):
            for k, v in obj.items():
                if isinstance(v, (dict, list)):
                    count_items(v)
                else:
                    total_items += 1
        elif isinstance(obj, list):
            for item in obj:
                if isinstance(item, (dict, list)):
                    count_items(item)
                else:
                    total_items += 1
    count_items(json_obj)
    progress_bar = tqdm(total=total_items, desc="Building mapping")
    def traverse(obj, path=""):
        if isinstance(obj, dict):
            for k, v in obj.items():
                current_path = f"{path}.{k}" if path else k
                if isinstance(v, (dict, list)):
                    traverse(v, current_path)
                else:
                    # Store original value to path mapping (using hashable version)
                    hashable_v = convert_to_hashable(v)
                    if hashable_v not in result:
                        result[hashable_v] = current_path

                    # Store processed values with removed suffixes
                    if isinstance(v, str):
                        processed_v = remove_ignore_suffixes(v)
                        if processed_v != v:  # Only add if suffix was actually removed
                            hashable_processed = convert_to_hashable(processed_v)
                            if hashable_processed not in result:
                                result[hashable_processed] = current_path

                    # Store Unicode escaped version (single quotes)
                    if isinstance(v, str) and "'" in v:
                        escaped = unicode_escape(v)
                        if escaped not in result:
                            result[escaped] = current_path

                    # Store fully Unicode escaped version
                    if isinstance(v, str):
                        full_escaped = full_unicode_escape(v)
                        unicode_result[full_escaped] = current_path

                    progress_bar.update(1)

        elif isinstance(obj, list):
            for i, item in enumerate(obj):
                current_path = f"{path}[{i}]"
                if isinstance(item, (dict, list)):
                    traverse(item, current_path)
                else:
                    # Use hashable version as key
                    hashable_item = convert_to_hashable(item)
                    if hashable_item not in result:
                        result[hashable_item] = current_path

                    # Store processed values with removed suffixes
                    if isinstance(item, str):
                        processed_item = remove_ignore_suffixes(item)
                        if processed_item != item:  # Only add if suffix was actually removed
                            hashable_processed = convert_to_hashable(processed_item)
                            if hashable_processed not in result:
                                result[hashable_processed] = current_path

                    if isinstance(item, str) and "'" in item:
                        escaped = unicode_escape(item)
                        if escaped not in result:
                            result[escaped] = current_path

                    # Store fully Unicode escaped version
                    if isinstance(item, str):
                        full_escaped = full_unicode_escape(item)
                        unicode_result[full_escaped] = current_path

                    progress_bar.update(1)

    traverse(json_obj)
    progress_bar.close()
    return result, unicode_result

def get_value_by_path(json_obj, path):
    """Get value from JSON object by path"""
    if not path:
        return ""

    parts = path.split(".")
    current = json_obj

    try:
        for part in parts:
            if "[" in part and "]" in part:
                key, index_part = part.split("[", 1)
                index = int(index_part.rstrip("]"))

                if key:
                    current = current.get(key, {})
                    if current and isinstance(current, list) and 0 <= index < len(current):
                        current = current[index]
                    else:
                        return ""
                else:
                    if isinstance(current, list) and 0 <= index < len(current):
                        current = current[index]
                    else:
                        return ""
            else:
                if isinstance(current, dict):
                    current = current.get(part, "")
                    if current is None:
                        return ""
                else:
                    return ""
    except (KeyError, IndexError, TypeError):
        return ""

    return current

def load_ref_json():
    """Load reference JSON file from the reference directory"""
    # Ensure the directory exists
    os.makedirs(REF_DIR, exist_ok=True)
    
    # Create default structure if file doesn't exist
    if not os.path.exists(REF_FILE):
        ref_json = {lang: {} for lang in SUPPORTED_LANGUAGES}
        with open(REF_FILE, 'w', encoding='utf-8') as f:
            json.dump(ref_json, f, ensure_ascii=False, indent=2)
        print(f"Created new reference file at {REF_FILE}")
        return ref_json
    
    # Load existing file
    try:
        with open(REF_FILE, 'r', encoding='utf-8') as f:
            ref_json = json.load(f)
            
        # Ensure all required language keys exist
        for lang in SUPPORTED_LANGUAGES:
            if lang not in ref_json:
                ref_json[lang] = {}
                
        return ref_json
    except Exception as e:
        print(f"Error loading reference file: {e}")
        return {lang: {} for lang in SUPPORTED_LANGUAGES}

def load_language_specific_ref(lang_code):
    """Load language-specific reference file"""
    lang_file = os.path.join(REF_DIR, f"{lang_code}.json")
    
    # Return empty dict if the file doesn't exist
    if not os.path.exists(lang_file):
        return {}
    
    # Load language specific file
    try:
        with open(lang_file, 'r', encoding='utf-8') as f:
            lang_ref = json.load(f)
        print(f"Loaded language-specific reference from {lang_file}")
        return lang_ref
    except Exception as e:
        print(f"Error loading language reference file: {e}")
        return {}

def translate_value(value, en_value_to_key, en_unicode_to_key, other_lang_json, ref_json=None, lang_specific_ref=None, target_lang=None, missing_entries=None):
    """Translate a single value"""
    if not isinstance(value, str):
        return value

    # 先保存原始值用于后续处理
    original_value = value
    entry_key = value.lower() if isinstance(value, str) else ""
    translated_value = ""
    
    # 1. 首先尝试从 REF.json 中查找翻译（提高优先级）
    if ref_json and target_lang and entry_key:
        if entry_key in ref_json.get("EN", {}) and target_lang in ref_json:
            if entry_key in ref_json[target_lang] and ref_json[target_lang][entry_key]:
                translated_value = ref_json[target_lang][entry_key]
                return translated_value  # 如果在REF中找到，直接返回，最高优先级
    
    # 2. 尝试从语言特定参考文件中查找
    if not translated_value and lang_specific_ref and entry_key:
        if entry_key in lang_specific_ref:
            translated_value = lang_specific_ref[entry_key]
            return translated_value  # 如果在语言特定文件中找到，直接返回，第二优先级
    
    # 3. 最后尝试从目标语言 JSON 中查找对应路径的翻译
    # Convert value to hashable type
    hashable_value = convert_to_hashable(original_value)

    # Look up key path in EN.json mapping
    key_path = en_value_to_key.get(hashable_value)

    # If not found, try with removed suffixes
    if key_path is None and isinstance(original_value, str):
        processed_value = remove_ignore_suffixes(original_value)
        if processed_value != original_value:
            hashable_processed = convert_to_hashable(processed_value)
            key_path = en_value_to_key.get(hashable_processed)

    # Try Unicode escaping (single quotes)
    if key_path is None and "'" in original_value:
        unicode_value = unicode_escape(original_value)
        key_path = en_value_to_key.get(unicode_value)

    # Try full Unicode escaping
    if key_path is None:
        full_unicode_value = full_unicode_escape(original_value)
        key_path = en_unicode_to_key.get(full_unicode_value)

    # Use found key path to look up translation in other_lang_json
    if key_path:
        translated_value = get_value_by_path(other_lang_json, key_path)
        
    # 如果所有方法都无法找到翻译，则记录缺失条目
    if not translated_value and missing_entries is not None and entry_key:
        if entry_key not in ref_json.get("EN", {}) and entry_key.strip():
            missing_entries.append(entry_key)

    return translated_value or original_value

def update_ref_json(ref_json, missing_entries):
    """Update REF.json with missing entries"""
    if not missing_entries:
        return False
        
    updated = False
    for entry in missing_entries:
        if entry not in ref_json["EN"]:
            ref_json["EN"][entry] = entry
            for lang in SUPPORTED_LANGUAGES[1:]:  # Skip EN
                ref_json[lang][entry] = ""
            updated = True
            
    if updated:
        with open(REF_FILE, 'w', encoding='utf-8') as f:
            json.dump(ref_json, f, ensure_ascii=False, indent=2)
        print(f"Updated {REF_FILE} with {len(missing_entries)} new entries")
        
    return updated

def count_leaf_nodes(json_obj):
    """Count leaf nodes (non-dict and non-list values) in JSON"""
    count = 0

    def traverse(obj):
        nonlocal count
        if isinstance(obj, dict):
            for v in obj.values():
                if isinstance(v, (dict, list)):
                    traverse(v)
                else:
                    count += 1
        elif isinstance(obj, list):
            for item in obj:
                if isinstance(item, (dict, list)):
                    traverse(item)
                else:
                    count += 1

    traverse(json_obj)
    return count

def main():
    if len(sys.argv) != 5:
        print("Usage: python3 autoI18N.py EN_Origin.json EN.json TC.json i18n_TC_pre.json")
        return

    # 获取命令行参数
    source_file = sys.argv[1]  # 当前目录下的源文件
    en_file = sys.argv[2]      # 参照目录下的英文文件
    other_lang_file = sys.argv[3]  # 参照目录下的目标语言文件
    output_file = sys.argv[4]  # 当前目录下的输出文件

    # 修正参照文件路径，添加REF_DIR前缀
    en_file_path = os.path.join(REF_DIR, en_file)
    other_lang_file_path = os.path.join(REF_DIR, other_lang_file)
    
    # 从文件名确定目标语言
    target_lang = None
    if "TC" in other_lang_file:
        target_lang = "TC"
    elif "SC" in other_lang_file:
        target_lang = "SC"
    elif "JP" in other_lang_file:
        target_lang = "JP"
    else:
        print(f"Warning: Could not determine target language from filename {other_lang_file}")
        # 如果无法确定，默认使用TC
        target_lang = "TC"
    
    # 打印调试信息
    print(f"Target language: {target_lang}")
    print(f"Reference directory: {REF_DIR}")
    print(f"English reference file: {en_file_path}")
    print(f"Target language file: {other_lang_file_path}")
    
    # 加载参照翻译文件
    ref_json = load_ref_json()
    lang_specific_ref = load_language_specific_ref(target_lang)
    
    missing_entries = []

    try:
        print("Reading source file...")
        with open(source_file, 'r', encoding='utf-8') as f:
            source_json = json.load(f)

        print("Reading English reference file...")
        with open(en_file_path, 'r', encoding='utf-8') as f:  # 使用修正后的路径
            en_json = json.load(f)

        print("Reading target language file...")
        with open(other_lang_file_path, 'r', encoding='utf-8') as f:  # 使用修正后的路径
            other_lang_json = json.load(f)

    except Exception as e:
        print(f"Error reading JSON files: {e}")
        return

    # 构建英文值到键路径的映射
    print("Building value-to-key mapping...")
    en_value_to_key, en_unicode_to_key = build_value_to_key_map(en_json)

    # 创建结果结构
    result_json = {}
    for top_key in source_json:
        result_json[top_key] = []

        # 处理数组中的每个对象
        for obj in source_json[top_key]:
            # 对每个对象，创建一个新的翻译对象
            translated_obj = {}

            # 计算要翻译的总项数
            total_keys = len(obj)
            progress_bar = tqdm(total=total_keys, desc=f"Translating {top_key}")

            for key, value in obj.items():
                # 规范化键名
                normalized_key = normalize_key(key)
                
                # 翻译值
                translated_value = translate_value(
                    value, 
                    en_value_to_key, 
                    en_unicode_to_key, 
                    other_lang_json,
                    ref_json,
                    lang_specific_ref,
                    target_lang,
                    missing_entries
                )

                # 将翻译后的值存储在新对象中
                translated_obj[normalized_key] = translated_value
                progress_bar.update(1)

            progress_bar.close()
            result_json[top_key].append(translated_obj)
    
    # 更新REF.json添加缺失条目
    if missing_entries:
        print(f"Found {len(missing_entries)} untranslated entries")
        update_ref_json(ref_json, missing_entries)

    # 将结果写入输出文件
    print("Saving result file...")
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(result_json, f, ensure_ascii=False, indent=4)

    print(f"Translation complete. Results saved to {output_file}")

if __name__ == "__main__":
    main()