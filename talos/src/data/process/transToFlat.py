import os
import json
import re
import argparse

"""
Convert multi-level type data structure to flat dictionary format
Default input: ./ref/types.json and ./ref/dict_mark.json
Default output: ./output/type.json and ../marker/type.json
"""

# Directory constants
DEFAULT_REF_DIR = 'ref'
DEFAULT_OUTPUT_DIR = 'output'
MARKER_OUTPUT_DIR = '../marker'

def format_key(string):
    """Format string to lowercase, underscore-separated format"""
    if not string or not isinstance(string, str):
        return ""
        
    # Convert to lowercase
    formatted = string.lower()
    
    # Replace Greek letters
    greek_map = {
        'α': 'a', 'β': 'b', 'γ': 'g', 'δ': 'd', 'ε': 'e', 'ζ': 'z', 'η': 'e',
        'θ': 'th', 'ι': 'i', 'κ': 'k', 'λ': 'l', 'μ': 'm', 'ν': 'n', 'ξ': 'x',
        'ο': 'o', 'π': 'p', 'ρ': 'r', 'σ': 's', 'τ': 't', 'υ': 'y', 'φ': 'f',
        'χ': 'ch', 'ψ': 'ps', 'ω': 'o'
    }
    
    for greek, latin in greek_map.items():
        formatted = formatted.replace(greek, latin)
    
    # Replace spaces and other separators with underscores
    formatted = re.sub(r'[\s\-\.]+', '_', formatted)
    
    # Remove non-alphanumeric characters
    formatted = re.sub(r'[^a-z0-9_]', '', formatted)
    
    # Remove consecutive underscores
    formatted = re.sub(r'_+', '_', formatted)
    
    # Remove leading and trailing underscores
    formatted = formatted.strip('_')
    
    return formatted

def safe_load_json_with_comments(file_path):
    """Load JSON file that may contain comments"""
    try:
        if os.path.exists(file_path):
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read().strip()
                if content:
                    # Remove single-line comments
                    content = re.sub(r'//.*?\n', '\n', content)
                    
                    try:
                        return json.loads(content)
                    except json.JSONDecodeError as je:
                        print(f"Error parsing {file_path}: {je}")
        return {}
    except Exception as e:
        print(f"Error loading file {file_path}: {e}")
        return {}

def load_type_data(ref_dir):
    """Read and parse types.json file"""
    try:
        file_path = os.path.join(ref_dir, 'types.json')
        data = safe_load_json_with_comments(file_path)
        if not data:
            print(f"Warning: Empty data loaded from {file_path}")
        return data
    except Exception as e:
        print(f"Failed to read types.json file: {e}")
        return {}

def load_mark_dict(ref_dir):
    """Read and parse dict_mark.json file"""
    try:
        file_path = os.path.join(ref_dir, 'dict_mark.json')
        data = safe_load_json_with_comments(file_path)
        
        if not data:
            return set()

        # Extract and format all VALUES (not keys)
        mark_values = set()
        for value in data.values():
            if isinstance(value, str):
                formatted_value = format_key(value)
                if formatted_value:
                    mark_values.add(formatted_value)

        return mark_values
    except Exception as e:
        print(f"Failed to read dict_mark.json file: {e}")
        return set()

def convert_to_key_dict(ref_dir):
    """Convert multi-level structure to flat dictionary"""
    type_data = load_type_data(ref_dir)
    mark_values = load_mark_dict(ref_dir)
    result = {}

    # Process main types
    for main_type in type_data:
        # Process subtypes
        for sub_type in type_data[main_type]:
            # Process specific types
            for key_type, properties in type_data[main_type][sub_type].items():
                # Skip empty keys
                if not key_type:
                    continue
                # Format key
                formatted_key = format_key(key_type)
                if not formatted_key:
                    continue
                # Create new object structure
                result[formatted_key] = {
                    'key': formatted_key,
                    'name': key_type,  # Use original name
                    'category': {
                        'main': main_type,
                        'sub': sub_type
                    }
                }
                # Add additional properties (like tier)
                if isinstance(properties, dict):
                    for prop_key, prop_value in properties.items():
                        result[formatted_key][prop_key] = prop_value
                
                # Check if the name matches any value in the mark dictionary
                formatted_name = format_key(key_type)
                
                # Add noFrame property only if:
                # 1. The name is in mark_values AND
                # 2. It does NOT have a subIcon property (subIcon items need frames)
                has_sub_icon = isinstance(properties, dict) and 'subIcon' in properties
                if formatted_name in mark_values and not has_sub_icon:
                    result[formatted_key]['noFrame'] = True
    return result

def write_type_json(key_dict, output_path):
    """Write the type dictionary to the specified output path"""
    # Ensure target directory exists
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    
    # Write to file
    with open(output_path, 'w', encoding='utf-8') as file:
        json.dump(key_dict, file, ensure_ascii=False, indent=4)
    
    print(f"Generated type.json at: {output_path}")

def generate_type_json(ref_dir, output_dir):
    """Run conversion and write results to file"""
    try:
        # Run conversion
        key_dict = convert_to_key_dict(ref_dir)
        
        # Get current script directory
        script_dir = os.path.dirname(os.path.abspath(__file__))
        
        # Write to default output directory
        default_output_path = os.path.join(script_dir, output_dir, 'type.json')
        write_type_json(key_dict, default_output_path)
        
        # Write to marker directory
        marker_output_path = os.path.join(script_dir, MARKER_OUTPUT_DIR, 'type.json')
        write_type_json(key_dict, marker_output_path)
        
    except Exception as e:
        print(f"Failed to generate type.json file: {e}")

def parse_args():
    parser = argparse.ArgumentParser(description="Convert multi-level type data to flat dictionary")
    parser.add_argument('-r', '--ref', default=DEFAULT_REF_DIR, help=f"Directory containing reference files (default: {DEFAULT_REF_DIR})")
    parser.add_argument('-o', '--output', default=DEFAULT_OUTPUT_DIR, help=f"Output directory (default: {DEFAULT_OUTPUT_DIR})")
    return parser.parse_args()

if __name__ == "__main__":
    args = parse_args()
    generate_type_json(args.ref, args.output)