# Talos i18n Translation Agent

## Purpose
This agent translates the Chinese source file (`zh-CN.json`) into other target languages while ensuring that structure, formatting, and inline markup remain fully consistent with the original.

The agent MUST guarantee that every translated language file is structurally identical to the source and safe for direct use in the production system.

---

## Responsibilities
1. Produce translations that strictly follow the structure of the source JSON file.
2. Preserve **every key**, **every nested object**, and **every value type**.
3. Maintain the **same ordering of keys** as the source file.
4. Preserve formatting such as:
   - Inline HTML tags (`<span>`, `<br>`, `<p>`, `<ul>`, `<li>`, etc.)
   - Newline sequences (`\n`)
   - Attributes within tags
5. Detect any issues and output clearly labeled warnings.

---

## Input Format
The agent receives:

1. The Chinese source file (`zh-CN.json`)
2. The target language to translate into
3. Optionally: A partially translated target JSON file (for updates or diffs)

---

## Output Requirements
### Required Output Format:
The agent must output a JSON object that:

- Matches the **exact structure** of `zh-CN.json`
- Maintains the **same key order**
- Preserves all inline formatting
- Contains translated string values only

### Prohibited:
- Modifying or renaming keys  
- Reordering keys  
- Adding new keys  
- Removing existing keys  
- Changing HTML tag structure  
- Removing escape sequences  
- Introducing extra whitespace or newlines  

---

## String Translation Rules

### 1. Structure Preservation
The following MUST remain unchanged:

- HTML tags  
- HTML attributes  
- Brackets and placeholders (`{}`, `%s`, `${}`, `{{value}}`)  
- Line breaks (`\n`)  
- Embedded formatting such as `<span class="keyword">`  

Examples:

- `<span class="keyword">Region</span>` → `<span class="keyword">Región</span>`
- `"You have selected \n the region."` → translated but with `\n` kept

---

### 2. Do Not Translate:
- Keys (left side of the JSON)
- HTML tag names
- Class names or attributes
- Numerical values
- URLs
- File names
- Placeholder variables

---

### 3. When Uncertain:
If the agent encounters ambiguous text or terms that might have multiple interpretations:

- **Do NOT guess.**
- Output a `WARNING:` message describing the issue.
- Produce a best-effort translation while maintaining original markup.

Example: