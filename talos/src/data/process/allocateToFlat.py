import json
import os
import glob
from typing import Dict, List, Any
from datetime import datetime

# Directory constants
DEFAULT_REF_DIR = 'ref'
DEFAULT_INPUT_DIR = 'input'
DEFAULT_OUTPUT_DIR = 'output'
MARKER_DATA_DIR = '../marker/data'  # New output directory for marker data

def format_key(s: str) -> str:
    """Format string to lowercase, underscore-separated format"""
    if not s or not isinstance(s, str):
        return ""
    
    # Convert to lowercase
    formatted = s.lower()
    
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
    import re
    formatted = re.sub(r'[\s\-\.]+', '_', formatted)
    
    # Remove non-alphanumeric characters
    formatted = re.sub(r'[^a-z0-9_]', '', formatted)
    
    # Remove consecutive underscores
    formatted = re.sub(r'_+', '_', formatted)
    
    # Remove leading and trailing underscores
    formatted = formatted.strip('_')
    
    return formatted

def load_json_file(file_path):
    """Load data from JSON file"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading file {file_path}: {e}")
        return {}

def safe_load_json_with_comments(file_path):
    """Load JSON file that may contain comments"""
    try:
        if os.path.exists(file_path):
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read().strip()
                if content:
                    # Handle potential comments in JSON
                    import re
                    content = re.sub(r'//.*?\n', '\n', content)  # Remove single-line comments
                    # Try to parse the processed content
                    try:
                        return json.loads(content)
                    except json.JSONDecodeError as je:
                        print(f"Error parsing {file_path}: {je}")
        return {}
    except Exception as e:
        print(f"Error loading file {file_path}: {e}")
        return {}

def write_output_file(file_path, data):
    """Write data to output file"""
    try:
        # Ensure directory exists
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        print(f"Error writing to file {file_path}: {e}")
        return False

def process_marker_data(ref_dir=DEFAULT_REF_DIR, input_dir=DEFAULT_INPUT_DIR, 
                        output_dir=DEFAULT_OUTPUT_DIR):
    """Process marker data and output to files"""
    # Create necessary directories
    log_dir = os.path.join(output_dir, 'log')
    
    os.makedirs(output_dir, exist_ok=True)
    os.makedirs(log_dir, exist_ok=True)
    os.makedirs(MARKER_DATA_DIR, exist_ok=True)  # Ensure marker data directory exists
    
    # Use dictionaries and sets to record mapping relationships
    successful_mappings_dict = {}  # Use dictionary for deduplication
    failed_mappings_set = set()    # Use set for deduplication
    unchanged_mappings_set = set() # Use set to record successfully mapped but unchanged keys
    
    # Load all external mappings
    print("Loading external mapping dictionaries...")
    
    # Load type reference (handle possible comments)
    type_dict = safe_load_json_with_comments(os.path.join(ref_dir, 'type.json'))
    if not type_dict:
        print("Warning: Type reference failed to load, will use original type values")
    
    # Load region mapping
    region_dict = load_json_file(os.path.join(ref_dir, 'region.json'))
    if not region_dict:
        print("Warning: Region mapping failed to load, will use original region values")
    
    # Load subregion mapping
    subregion_dict = load_json_file(os.path.join(ref_dir, 'subregion.json'))
    if not subregion_dict:
        print("Warning: Subregion mapping failed to load, will use original subregion values")
    
    # Load all other mapping files
    all_mappings = {}
    for map_file in glob.glob(os.path.join(ref_dir, '*.json')):
        filename = os.path.basename(map_file)
        if filename not in ['type.json', 'region.json', 'subregion.json']:
            map_name = os.path.splitext(filename)[0]  # Remove .json suffix
            map_data = load_json_file(map_file)
            if map_data:
                # Format string values
                formatted_data = {}
                for k, v in map_data.items():
                    if isinstance(v, str):
                        formatted_data[k] = format_key(v)
                    else:
                        formatted_data[k] = v
                all_mappings[map_name] = formatted_data
                print(f"Loaded mapping: {map_name}")
    
    # Read all input files
    print("Reading input files...")
    all_data = []
    for json_file in glob.glob(os.path.join(input_dir, '*.json')):
        try:
            file_data = load_json_file(json_file)
            if isinstance(file_data, list):
                all_data.extend(file_data)
                print(f"Loaded: {json_file} ({len(file_data)} markers)")
            else:
                print(f"Skipping non-list data: {json_file}")
        except Exception as e:
            print(f"Error processing file {json_file}: {e}")
    
    print(f"Finally loaded {len(all_data)} markers")
    
    # Process data
    processed_data = []
    for item in all_data:
        if not isinstance(item, dict):
            continue
            
        try:
            # Extract type and region information
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
            
            # Apply region mapping
            main_region = region_dict.get(region_main, region_main) if region_dict else region_main
            sub_region = ""
            if subregion_dict and main_region in subregion_dict:
                sub_region = subregion_dict[main_region].get(region_sub, region_sub)
            else:
                sub_region = region_sub
            
            # Determine type
            item_type = type_key
            mapping_found = False
            mapping_source = ""
            
            # First check type dictionary
            if type_dict and type_key in type_dict:
                # Use type key name directly
                item_type = type_key
                mapping_found = True
                mapping_source = "type.json"
            else:
                # Check all other mappings
                for map_name, map_dict in all_mappings.items():
                    if type_key in map_dict:
                        item_type = map_dict[type_key]
                        mapping_found = True
                        mapping_source = map_name
                        break
            
            # Record unique mapping results
            if mapping_found:
                if item_type == type_key:  # Same value before and after mapping
                    unchanged_mappings_set.add(type_key)
                else:
                    # Only record unique key-value pairs and source with changed values
                    successful_mappings_dict[type_key] = {
                        "value": item_type,
                        "source": mapping_source
                    }
            else:
                # Only record unique unmapped keys
                failed_mappings_set.add(type_key)
            
            # Create processed item
            processed_item = dict(item)  # Create a copy instead of modifying original data
            
            # Add necessary fields
            processed_item['position'] = item.get('position', item.get('pos', []))
            processed_item['subregionId'] = sub_region or main_region
            processed_item['type'] = item_type
            
            # Remove unnecessary fields
            for field in ['pos', 'region', 'meta']:
                if field in processed_item:
                    del processed_item[field]
                    
            processed_data.append(processed_item)
        except Exception as e:
            print(f"Error processing item: {e}")
            print(f"Problematic item: {item}")
    
    print(f"Successfully processed {len(processed_data)} markers")
    
    # Categorize by subregion
    categorized_data = {}
    for item in processed_data:
        subregion_id = item.get('subregionId', 'unknown')
        if subregion_id not in categorized_data:
            categorized_data[subregion_id] = []
        categorized_data[subregion_id].append(item)
    
    # Output to files
    for subregion_id, items in categorized_data.items():
        # Write to default output directory
        output_file = os.path.join(output_dir, f"{subregion_id}.json")
        success = write_output_file(output_file, items)
        if success:
            print(f"Successfully wrote to: {output_file} ({len(items)} markers)")
            
        # Write to marker data directory
        marker_output_file = os.path.join(MARKER_DATA_DIR, f"{subregion_id}.json")
        success = write_output_file(marker_output_file, items)
        if success:
            print(f"Successfully wrote to marker dir: {marker_output_file}")
    
    # Convert dictionaries and sets to lists
    successful_mappings = [{"key": k, **v} for k, v in successful_mappings_dict.items()]
    failed_mappings = [{"key": k} for k in failed_mappings_set]
    unchanged_mappings = [{"key": k} for k in unchanged_mappings_set]
    
    # Create simplified mapping objects
    successful_mappings_simple = {k: v["value"] for k, v in successful_mappings_dict.items()}
    failed_mappings_keys = {k: k for k in failed_mappings_set}
    unchanged_mappings_keys = {k: k for k in unchanged_mappings_set}
    
    # Generate and output log file
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_file = os.path.join(log_dir, f"mapping_log_{timestamp}.json")
    
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
    
    success = write_output_file(log_file, log_data)
    if success:
        print(f"Successfully wrote log: {log_file}")
        print(f"  - Successfully mapped (changed): {len(successful_mappings)} unique types")
        print(f"  - Successfully mapped (unchanged): {len(unchanged_mappings)} unique types")
        print(f"  - Mapping not found: {len(failed_mappings)} unique types")
    
    # Output simplified mapping file separately for easy use
    simple_mapping_file = os.path.join(log_dir, f"simple_mappings_{timestamp}.json")
    simple_mappings = {
        "successful": successful_mappings_simple,
        "failed": failed_mappings_keys,
        "unchanged": unchanged_mappings_keys
    }
    success = write_output_file(simple_mapping_file, simple_mappings)
    if success:
        print(f"Successfully wrote simplified mapping file: {simple_mapping_file}")
    
    print(f"Processing completed, output {len(categorized_data)} files")

if __name__ == "__main__":
    process_marker_data()