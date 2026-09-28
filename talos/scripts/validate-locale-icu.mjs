import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import IntlMessageFormat from 'intl-messageformat';

const SOURCE_LOCALE = 'en-US';
const localeDir = fileURLToPath(
    new URL('../src/locale/data/ui/', import.meta.url),
);
const ICU_CONTROL_PATTERN = /\{[\w.-]+,\s*(?:plural|select|selectordinal)\s*,/u;

const flattenStrings = (value, prefix = '', result = new Map()) => {
    for (const [key, child] of Object.entries(value)) {
        const identifier = prefix ? `${prefix}.${key}` : key;
        if (typeof child === 'string') result.set(identifier, child);
        else if (child && typeof child === 'object')
            flattenStrings(child, identifier, result);
    }
    return result;
};

const visitAst = (nodes, visitor) => {
    for (const node of nodes) {
        visitor(node);
        if (node.children) visitAst(node.children, visitor);
        if (node.options) {
            for (const option of Object.values(node.options)) {
                visitAst(option.value, visitor);
            }
        }
    }
};

const getSchema = (template, locale) => {
    const ast = new IntlMessageFormat(template, locale).getAst();
    const argumentsUsed = new Set();
    let hasIcuControl = false;
    visitAst(ast, (node) => {
        if (node.type === 5 || node.type === 6) hasIcuControl = true;
        if (node.value && node.type > 0 && node.type < 7) {
            argumentsUsed.add(`${node.type}:${node.value}`);
        }
    });
    return {
        argumentsUsed: [...argumentsUsed].sort(),
        hasIcuControl,
    };
};

const localeFiles = (await readdir(localeDir))
    .filter((file) => file.endsWith('.json'))
    .sort();
const sourceFile = `${SOURCE_LOCALE}.json`;
if (!localeFiles.includes(sourceFile)) {
    throw new Error(`Missing source locale: ${sourceFile}`);
}

const source = flattenStrings(
    JSON.parse(await readFile(path.join(localeDir, sourceFile), 'utf8')),
);
const sourceIcuSchemas = new Map();
for (const [identifier, template] of source) {
    if (!ICU_CONTROL_PATTERN.test(template)) continue;
    const schema = getSchema(template, SOURCE_LOCALE);
    if (schema.hasIcuControl) {
        sourceIcuSchemas.set(identifier, schema.argumentsUsed);
    }
}

const errors = [];
for (const file of localeFiles) {
    if (file === sourceFile) continue;
    const locale = path.basename(file, '.json');
    const translations = flattenStrings(
        JSON.parse(await readFile(path.join(localeDir, file), 'utf8')),
    );
    for (const [identifier, sourceSchema] of sourceIcuSchemas) {
        const translation = translations.get(identifier);
        if (!translation) {
            errors.push(`${locale}: missing ${identifier}`);
            continue;
        }
        let targetSchema;
        try {
            targetSchema = getSchema(translation, locale).argumentsUsed;
        } catch (error) {
            errors.push(`${locale}: invalid ${identifier}: ${error.message}`);
            continue;
        }
        if (JSON.stringify(targetSchema) !== JSON.stringify(sourceSchema)) {
            errors.push(
                `${locale}: ${identifier} uses [${targetSchema.join(', ')}], expected [${sourceSchema.join(', ')}]`,
            );
        }
    }
}

if (errors.length > 0) {
    console.error('Crowdin ICU schema validation failed:');
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
} else {
    console.log(
        `Validated ${sourceIcuSchemas.size} Crowdin ICU messages across ${localeFiles.length} locales.`,
    );
}
