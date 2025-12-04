#!/usr/bin/env python3
# i18n_check.py
# Python 3.10+
# Purpose: Compare template (e.g., zh-CN) with target locale JSON files for structure and inline format consistency.
# Can auto-generate target.fixed.json with correct key order and placeholders while preserving existing translations.
#
# Usage:
#   Single file:  python schema.py --template zh-CN.json --target en-US.json [--fix] [--report report.txt]
#   Batch mode:   python schema.py --template zh-CN.json --batch [--fix] [--report-dir reports]

import json
import re
import argparse
import os
from pathlib import Path
from html.parser import HTMLParser
from typing import Any, List, Tuple, Dict, Optional

# --------- Inline HTML parsing (simplified) ----------
class _TagParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tokens: List[Tuple[str, str, Dict[str, str]]] = []  # (type, tag, attrs)

    def handle_starttag(self, tag, attrs):
        self.tokens.append(("start", tag, dict(attrs)))

    def handle_endtag(self, tag):
        self.tokens.append(("end", tag, {}))

    def handle_startendtag(self, tag, attrs):
        self.tokens.append(("self", tag, dict(attrs)))

def extract_tag_signature(s: str) -> List[Tuple[str, str, Tuple[Tuple[str,str], ...]]]:
    """Extract simplified tag token list from string: (type, tag, sorted(attrs tuple))"""
    p = _TagParser()
    try:
        p.feed(s)
    except Exception:
        # HTMLParser occasionally throws errors, fail gracefully
        pass
    out = []
    for t, tag, attrs in p.tokens:
        items = tuple(sorted(attrs.items()))
        out.append((t, tag, items))
    return out

def newline_positions(s: str) -> List[int]:
    """Return list of all '\\n' index positions (for comparing newline positions)"""
    return [m.start() for m in re.finditer(r'\\n', s)]

# --------- Structure comparison ----------
def is_primitive(v: Any) -> bool:
    return isinstance(v, (str, int, float, bool)) or v is None

def diff_keys(base: Any, target: Any, path: str = "") -> Tuple[List[str], List[str]]:
    """
    Return (missing_paths, extra_paths)
    Path uses dot notation for hierarchy, e.g., "guide.sidebarToggle"
    """
    missing: List[str] = []
    extra: List[str] = []
    if is_primitive(base):
        return missing, extra
    if isinstance(base, list):
        if not isinstance(target, list):
            missing.append(path or "<root> (array expected)")
        return missing, extra
    if not isinstance(base, dict):
        return missing, extra
    if not isinstance(target, dict):
        missing.append(path or "<root> (object expected)")
        return missing, extra
    for k in base.keys():
        sub = f"{path}.{k}" if path else k
        if k not in target:
            missing.append(sub)
            continue
        m, e = diff_keys(base[k], target[k], sub)
        missing.extend(m); extra.extend(e)
    for k in target.keys():
        if k not in base:
            sub = f"{path}.{k}" if path else k
            extra.append(sub)
    return missing, extra

# --------- Inline format comparison ----------
def compare_inline_format(base: Any, target: Any) -> List[str]:
    """
    Recursively compare HTML tag tokens and \\n positions in strings.
    Return list of issue descriptions (each with path prefix)
    """
    problems: List[str] = []
    def walk(b: Any, t: Any, path: str):
        if isinstance(b, str):
            if not isinstance(t, str):
                problems.append(f"{path}: type mismatch (template is string, target not string)")
                return
            b_tags = extract_tag_signature(b)
            t_tags = extract_tag_signature(t)
            if b_tags != t_tags:
                problems.append(f"{path}: HTML tag/token mismatch\n  template tokens={b_tags}\n  target tokens  ={t_tags}")
            b_nl = newline_positions(b)
            t_nl = newline_positions(t)
            if b_nl != t_nl:
                problems.append(f"{path}: newline positions differ -> template {b_nl} target {t_nl}")
        elif isinstance(b, dict):
            if not isinstance(t, dict):
                problems.append(f"{path}: type mismatch (template is object, target not object)")
                return
            for k in b.keys():
                sub = f"{path}.{k}" if path else k
                if k in t:
                    walk(b[k], t[k], sub)
        elif isinstance(b, list):
            if not isinstance(t, list):
                problems.append(f"{path}: type mismatch (template is array, target not array)")
                return
            # Only compare format of first item (common i18n doesn't need per-item array alignment)
            if len(b) > 0 and len(t) > 0:
                walk(b[0], t[0], f"{path}[0]")

    walk(base, target, "")
    return problems

# --------- Line number location (approximate) ----------
def find_key_line(source_text: str, key_path: str) -> Optional[int]:
    """
    Find keys in path sequentially in original JSON text, return approximate line number (1-based).
    Simple approach: for each key in path, search for next occurrence, return line of last key.
    If any key not found, return None.
    """
    keys = key_path.split(".")
    pos = 0
    for k in keys:
        # Search for "k" :
        m = re.search(r'\"' + re.escape(k) + r'\"\s*:', source_text[pos:])
        if not m:
            # Fallback: search for just "k"
            m2 = re.search(r'\"' + re.escape(k) + r'\"', source_text[pos:])
            if not m2:
                return None
            pos += m2.start()
        else:
            pos += m.start()
    # Count '\n' before pos to get line number
    return source_text.count("\n", 0, pos) + 1

# --------- Rebuild from template (preserve target values, reorder & fill gaps) ----------
def build_ordered_from_template(template: Any, target: Any) -> Any:
    """
    Return new object with same structure and key order as template.
    - If target has value at same path with compatible type, preserve target's value
    - If missing, generate empty placeholder by template type (string->"", object->{}, array->[])
    - Won't automatically add back extra keys from target (extras will be reported)
    """
    if is_primitive(template):
        return target if is_primitive(target) else (template if template is not None else "")
    if isinstance(template, list):
        if isinstance(target, list):
            return target
        # Generate empty list or shape by first item
        if len(template) == 0:
            return []
        return [ build_ordered_from_template(template[0], (target[0] if isinstance(target, list) and len(target)>0 else {})) ]
    # dict
    out: Dict[str, Any] = {}
    if not isinstance(target, dict):
        target = {}
    for k, v in template.items():
        if k in target:
            out[k] = build_ordered_from_template(v, target[k])
        else:
            # Missing -> placeholder
            if is_primitive(v):
                out[k] = ""
            elif isinstance(v, list):
                out[k] = []
            else:
                out[k] = build_ordered_from_template(v, {})
    return out

# --------- File loading and processing ----------
def load_file(path: str) -> Tuple[Any, str]:
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    data = json.loads(text)
    return data, text

def find_locale_files(template_path: str) -> List[str]:
    """
    Find all JSON files in the same directory as template, excluding the template itself.
    Returns list of file paths.
    """
    template_path_obj = Path(template_path)
    directory = template_path_obj.parent
    template_name = template_path_obj.name
    
    locale_files = []
    for file in directory.glob("*.json"):
        if file.name != template_name and file.name != "types.json":
            locale_files.append(str(file))
    
    return sorted(locale_files)

def process_single_target(template_data: Any, template_text: str, template_path: str,
                          target_path: str, fix: bool, report_path: Optional[str]) -> bool:
    """
    Process a single target file. Returns True if all checks passed.
    """
    try:
        tgt, tgt_text = load_file(target_path)
    except Exception as e:
        print(f"❌ Error loading {target_path}: {e}")
        return False

    missing, extra = diff_keys(template_data, tgt)
    inline_problems = compare_inline_format(template_data, tgt)

    report_lines: List[str] = []
    report_lines.append(f"Template: {template_path}")
    report_lines.append(f"Target: {target_path}")
    report_lines.append("")
    report_lines.append("=== Key structure ===")
    
    all_passed = True
    
    if missing:
        all_passed = False
        report_lines.append("Missing keys:")
        for k in missing:
            ln = find_key_line(template_text, k) or -1
            report_lines.append(f"  - {k}  (template line {ln})")
    else:
        report_lines.append("No missing keys ✅")
    
    if extra:
        all_passed = False
        report_lines.append("Extra keys in target:")
        for k in extra:
            ln = find_key_line(tgt_text, k) or -1
            report_lines.append(f"  - {k}  (target line {ln})")
    else:
        report_lines.append("No extra keys ✅")

    report_lines.append("")
    report_lines.append("=== Inline format (HTML tags / newlines) ===")
    if inline_problems:
        all_passed = False
        report_lines.append("Found inline format problems:")
        for p in inline_problems:
            try_path = p.split(":")[0]
            pathline = find_key_line(template_text, try_path) or "-"
            report_lines.append(f"  - {p}  (template line {pathline})")
    else:
        report_lines.append("No inline format problems ✅")

    report = "\n".join(report_lines)
    print("\n" + "="*80)
    print(report)

    if report_path:
        with open(report_path, "w", encoding="utf-8") as f:
            f.write(report)
        print(f"Report written to {report_path}")

    if fix:
        fixed = build_ordered_from_template(template_data, tgt)
        out_path = target_path + ".fixed.json"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(fixed, f, ensure_ascii=False, indent=2)
        print(f"Fixed file written to {out_path}")
    
    return all_passed

def main(argv=None):
    parser = argparse.ArgumentParser(
        description="i18n structure & inline-format checker and order-fixer",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  Single file mode:
    python schema.py --template zh-CN.json --target en-US.json
    python schema.py --template zh-CN.json --target en-US.json --fix --report report.txt
  
  Batch mode (check all locale files in same directory):
    python schema.py --template zh-CN.json --batch
    python schema.py --template zh-CN.json --batch --fix --report-dir reports
        """
    )
    parser.add_argument("--template", required=True, help="template JSON file (e.g. zh-CN.json)")
    parser.add_argument("--target", help="target JSON file to check/fix (e.g. en-US.json)")
    parser.add_argument("--batch", action="store_true", 
                       help="batch mode: check all JSON files in template's directory (excluding template itself)")
    parser.add_argument("--fix", action="store_true", 
                       help="write fixed target file(s) with keys ordered like template")
    parser.add_argument("--report", help="write textual report to this path (single file mode)")
    parser.add_argument("--report-dir", help="write reports to this directory (batch mode)")
    args = parser.parse_args(argv)

    # Load template
    try:
        tpl, tpl_text = load_file(args.template)
    except Exception as e:
        print(f"❌ Error loading template {args.template}: {e}")
        return 1

    if args.batch:
        # Batch mode: process all locale files
        locale_files = find_locale_files(args.template)
        if not locale_files:
            print(f"⚠️  No other locale files found in {Path(args.template).parent}")
            return 0
        
        print(f"📦 Batch mode: found {len(locale_files)} locale file(s) to check")
        print(f"Template: {args.template}")
        print("Targets:")
        for f in locale_files:
            print(f"  - {f}")
        
        # Create report directory if needed
        report_dir = None
        if args.report_dir:
            report_dir = Path(args.report_dir)
            report_dir.mkdir(parents=True, exist_ok=True)
        
        # Process each file
        all_passed = True
        for target_file in locale_files:
            target_name = Path(target_file).stem
            report_path = None
            if report_dir:
                report_path = str(report_dir / f"{target_name}_report.txt")
            
            passed = process_single_target(tpl, tpl_text, args.template, target_file, 
                                          args.fix, report_path)
            all_passed = all_passed and passed
        
        print("\n" + "="*80)
        if all_passed:
            print("✅ All locale files passed validation!")
        else:
            print("❌ Some locale files have issues. Check reports above.")
        
        return 0 if all_passed else 1
    
    else:
        # Single file mode
        if not args.target:
            print("❌ Error: --target is required in single file mode (or use --batch)")
            return 1
        
        passed = process_single_target(tpl, tpl_text, args.template, args.target, 
                                      args.fix, args.report)
        return 0 if passed else 1

if __name__ == "__main__":
    exit(main())
