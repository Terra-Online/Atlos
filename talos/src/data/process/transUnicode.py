import json
import os
import sys
from tqdm import tqdm

def decode_unicode_in_json(input_file, output_file):
    print(f"Reading file: {input_file}")
    with open(input_file, 'r', encoding='utf-8') as f:
        data = json.load(f)
    print(f"Loaded size approximately: {os.path.getsize(input_file) / (1024 * 1024):.2f} MB")
    print("Processing Unicode escape sequences...")

    def process_item(item):
        if isinstance(item, dict):
            result = {}
            for key, value in tqdm(item.items(), desc="Processing dict items"):
                result[key] = process_item(value)
            return result
        elif isinstance(item, list):
            return [process_item(i) for i in tqdm(item, desc="Processing list items")]
        elif isinstance(item, str):
            return item
        else:
            return item

    decoded_data = process_item(data)
    print(f"Completed and writing to: {output_file}")
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(decoded_data, f, ensure_ascii=False, indent=2)
    print(f"Converted! Output file size approximately: {os.path.getsize(output_file) / (1024 * 1024):.2f} MB")

def generate_output_path(input_path):
    file_name, file_ext = os.path.splitext(input_path)
    return f"{file_name}_trans{file_ext}"

if __name__ == "__main__":
    if len(sys.argv) > 1:
        input_path = sys.argv[1]
    else:
        input_path = input("Enter path to Unicode JSON file: ")
    output_path = generate_output_path(input_path)
    print(f"Output path: {output_path}")
    decode_unicode_in_json(input_path, output_path)
    print("Done!")