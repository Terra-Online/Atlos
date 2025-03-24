import json
import os
import sys
import argparse
from tqdm import tqdm

def extract_keys_from_types(input_file, output_file):
    print(f"Reading file: {input_file}")
    try:
        with open(input_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        print(f"Loaded size approximately: {os.path.getsize(input_file) / (1024):.2f} KB")
    except FileNotFoundError:
        print(f"Error: File {input_file} not found")
        return
    except json.JSONDecodeError:
        print(f"Error: Invalid JSON in {input_file}")
        return

    print("Extracting keys from types.json...")

    result = {
        "key": [{}],       # 3rd
        "category": [{}],  # 2nd
        "types": [{}]      # 1st
    }

    # Dictionary for custom mappings
    custom_mappings = {
    }
    print("Processing main types...")
    for type_obj in tqdm(data.get("types", []), desc="Processing type objects"):
        for type_name, type_value in tqdm(type_obj.items(), desc="Processing main types"):
            result["types"][0][type_name.lower()] = type_name.lower()

            for category_name, category_value in tqdm(type_value.items(),
                                                     desc=f"Processing {type_name} subcategories",
                                                     leave=False):
                result["category"][0][category_name.lower()] = category_name

                for item_name, item_value in tqdm(category_value.items(),
                                                 desc=f"Processing {category_name} items",
                                                 leave=False):
                    result["key"][0][item_name] = custom_mappings.get(item_name, item_name)

    print(f"Writing output to: {output_file}")
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=4)

    print(f"Extraction completed!")
    print(f"Extracted {len(result['types'][0])} main types")
    print(f"Extracted {len(result['category'][0])} categories")
    print(f"Extracted {len(result['key'][0])} unique keys")
    print(f"Output file size: {os.path.getsize(output_file) / (1024):.2f} KB")

def generate_output_path(input_path):
    base_dir = os.path.dirname(input_path)
    return os.path.join(base_dir, "i18n_EN.json")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Extract keys from types.json and generate i18n_EN.json')

    parser.add_argument('input', nargs='?', default='../types.json',
                        help='Path to input types.json file (default: ../types.json)')

    parser.add_argument('-o', '--output',
                        help='Path to output i18n_EN.json file (default: directory of input file + i18n_EN.json)')

    args = parser.parse_args()

    input_path = args.input

    if args.output:
        output_path = args.output
    else:
        output_path = generate_output_path(input_path)

    print(f"Input path: {input_path}")
    print(f"Output path: {output_path}")

    extract_keys_from_types(input_path, output_path)