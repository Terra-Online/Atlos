/** @type {import("stylelint").Config} */
export default {
    extends: ['stylelint-config-standard'],
    ignoreFiles: [
        '**/node_modules/**', '**/dist/**', '**/build/**', '**/coverage/**',
        '.pages-dist/**', '.cache/**', '.vite/**', '**/.wrangler/**',
        'performance/**', 'public/**', 'originData/**', '**/*.generated.*',
    ],
    overrides: [
        {
            files: ['**/*.scss'],
            extends: ['stylelint-config-standard-scss', 'stylelint-config-prettier-scss'],
            rules: {
                'scss/dollar-variable-empty-line-before': null,
                'scss/dollar-variable-pattern': null,
                'scss/double-slash-comment-empty-line-before': null,
                'scss/double-slash-comment-whitespace-inside': null,
                'scss/load-partial-extension': null,
                // Core CSS cannot see that declarations inside a mixin's @media
                // gain a selector at the @include site.
                'no-invalid-position-declaration': null,
            },
        },
        {
            files: ['**/*.module.{css,scss}'],
            rules: {
                'selector-pseudo-class-no-unknown': [true, { ignorePseudoClasses: ['global', 'local', 'export', 'import'] }],
                'property-no-unknown': [true, {
                    ignoreProperties: ['corner-shape', 'user-drag', 'composes'],
                    ignoreSelectors: [':export', /^:import\(/],
                }],
            },
        },
    ],
    rules: {
        // empty-line
        'at-rule-empty-line-before': null,
        'comment-empty-line-before': null,
        'custom-property-empty-line-before': null,
        'declaration-empty-line-before': null,
        'rule-empty-line-before': null,
        // color
        'color-function-notation': null,
        'color-function-alias-notation': null,
        'alpha-value-notation': null,
        // pattern
        // Existing styles mix camelCase modules, Leaflet classes and kebab-case.
        'selector-class-pattern': null,
        'keyframes-name-pattern': null,
        'no-descending-specificity': null,
        'custom-property-pattern': null,
        'font-family-name-quotes': null,
        'color-hex-length': null,
        'length-zero-no-unit': null,
        'shorthand-property-no-redundant-values': null,
        'media-feature-range-notation': null,
        'no-empty-source': null,
        // Separate blocks intentionally group state and descendant overrides.
        'no-duplicate-selectors': null,
        // Preserve currentColor, font names and case-sensitive custom identifiers.
        'value-keyword-case': null,
        // Keep authored fallbacks and progressive CSS features; still flag typos.
        'property-no-unknown': [true, { ignoreProperties: ['corner-shape', 'user-drag'] }],
        'property-no-vendor-prefix': null,
        'property-no-deprecated': [true, { ignoreProperties: ['clip'] }],
        'declaration-property-value-keyword-no-deprecated': [true, { ignoreKeywords: ['break-word'] }],
        // shorthand
        'declaration-block-no-redundant-longhand-properties': null,
    },
};
