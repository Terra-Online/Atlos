import json
import sys
from tqdm import tqdm
import re

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

def translate_value(value, en_value_to_key, en_unicode_to_key, other_lang_json):
    """Translate a single value"""
    if not isinstance(value, str):
        return value

    # Convert value to hashable type
    hashable_value = convert_to_hashable(value)

    # Look up key path in EN.json mapping
    key_path = en_value_to_key.get(hashable_value)

    # Try Unicode escaping (single quotes)
    if key_path is None and "'" in value:
        unicode_value = unicode_escape(value)
        key_path = en_value_to_key.get(unicode_value)

    # Try full Unicode escaping
    if key_path is None:
        full_unicode_value = full_unicode_escape(value)
        key_path = en_unicode_to_key.get(full_unicode_value)

    # Use found key path to look up translation in other_lang_json
    translated_value = ""
    if key_path:
        translated_value = get_value_by_path(other_lang_json, key_path)

    return translated_value or value  # Return original value if no translation found

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
        print("Usage: python3 autoI18N.py EN_Origin.json EN.json TC_trans.json i18n_TC_pre.json")
        return

    source_file = sys.argv[1]
    en_file = sys.argv[2]
    other_lang_file = sys.argv[3]
    output_file = sys.argv[4]

    try:
        print("Reading source file...")
        with open(source_file, 'r', encoding='utf-8') as f:
            source_json = json.load(f)

        print("Reading English reference file...")
        with open(en_file, 'r', encoding='utf-8') as f:
            en_json = json.load(f)

        print("Reading target language file...")
        with open(other_lang_file, 'r', encoding='utf-8') as f:
            other_lang_json = json.load(f)

    except Exception as e:
        print(f"Error reading JSON files: {e}")
        return

    # Build value-to-key mapping from EN.json
    print("Building value-to-key mapping...")
    en_value_to_key, en_unicode_to_key = build_value_to_key_map(en_json)

    # Create result structure with the same top-level keys
    result_json = {}
    for top_key in source_json:
        result_json[top_key] = []

        # Process each object in the array
        for obj in source_json[top_key]:
            # For each object, create a new translated object
            translated_obj = {}

            # Calculate total items to translate
            total_keys = len(obj)
            progress_bar = tqdm(total=total_keys, desc=f"Translating {top_key}")

            for key, value in obj.items():
                # Normalize key name
                normalized_key = normalize_key(key)
                # Convert value
                hashable_value = convert_to_hashable(value)
                # Look up key path in EN.json mapping
                key_path = en_value_to_key.get(hashable_value)
                # Try Unicode escaping (single quotes)

                if key_path is None and isinstance(value, str):
                    if "'" in value:
                        unicode_value = unicode_escape(value)
                        key_path = en_value_to_key.get(unicode_value)
                    if key_path is None:
                        full_unicode_value = full_unicode_escape(value)
                        key_path = en_unicode_to_key.get(full_unicode_value)

                # Translate value using found key path
                translated_value = value  # Default to original value
                if key_path:
                    found_translation = get_value_by_path(other_lang_json, key_path)
                    if found_translation:
                        translated_value = found_translation

                # Store translated value in new object
                translated_obj[normalized_key] = translated_value
                progress_bar.update(1)

            progress_bar.close()
            result_json[top_key].append(translated_obj)

    # Write result to output file
    print("Saving result file...")
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(result_json, f, ensure_ascii=False, indent=4)

    print(f"Translation complete. Results saved to {output_file}")

if __name__ == "__main__":
    main()