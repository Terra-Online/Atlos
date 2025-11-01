/** @type {import("stylelint").Config} */
export default {
    extends: ['stylelint-config-standard', 'stylelint-config-standard-scss'],
    rules: {
        // empty-line
        'at-rule-empty-line-before': null,
        'comment-empty-line-before': null,
        'custom-property-empty-line-before': null,
        'declaration-empty-line-before': null,
        'rule-empty-line-before': null,
        'scss/dollar-variable-empty-line-before': null,
        // color
        'color-function-notation': null,
        'color-function-alias-notation': null,
        'alpha-value-notation': null,
        // pattern
        'selector-class-pattern': [
            '^[a-z]+([A-Z][a-z0-9]*)*$',
            {
                message: 'Expected class selector to be in camelCase',
            },
        ],
        'keyframes-name-pattern': [
            '^[a-z]+([A-Z][a-z0-9]*)*$',
            {
                message: 'Expected keyframe name to be in camelCase',
            },
        ],
        'no-descending-specificity': null,
        "custom-property-pattern": null,
        // shorthand
        'declaration-block-no-redundant-longhand-properties': null,
    },
};