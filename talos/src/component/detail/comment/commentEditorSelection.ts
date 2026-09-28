import {
    $getRoot,
    $getSelection,
    $isElementNode,
    $isRangeSelection,
    $isTextNode,
    type LexicalNode,
} from 'lexical';
import { getCommentRawText, serializeCommentNode } from './commentEditorSource';

export type SelectionOffsets = { anchor: number; focus: number };

const nodeLength = (node: LexicalNode): number => serializeCommentNode(node).length;

const pointOffset = (root: LexicalNode, target: LexicalNode, targetOffset: number): number | null => {
    const visit = (node: LexicalNode, start: number): number | null => {
        if (node.getKey() === target.getKey()) {
            if (!$isElementNode(node)) return start + Math.min(Math.max(targetOffset, 0), nodeLength(node));
            return start + node.getChildren()
                .slice(0, Math.max(0, Math.min(targetOffset, node.getChildrenSize())))
                .reduce((sum, child) => sum + nodeLength(child), 0);
        }
        if (!$isElementNode(node)) return null;
        let offset = start;
        for (const child of node.getChildren()) {
            const result = visit(child, offset);
            if (result !== null) return result;
            offset += nodeLength(child);
        }
        return null;
    };
    return visit(root, 0);
};

export const getCommentSelectionOffsets = (
    selection: ReturnType<typeof $getSelection>,
): SelectionOffsets | null => {
    if (!$isRangeSelection(selection)) return null;
    const root = $getRoot();
    const anchor = pointOffset(root, selection.anchor.getNode(), selection.anchor.offset);
    const focus = pointOffset(root, selection.focus.getNode(), selection.focus.offset);
    return anchor === null || focus === null ? null : { anchor, focus };
};

type Leaf = { node: LexicalNode; start: number; end: number; parent: LexicalNode | null; index: number };

const leavesOf = (root: LexicalNode): Leaf[] => {
    const leaves: Leaf[] = [];
    const visit = (node: LexicalNode, start: number) => {
        if (!$isElementNode(node)) {
            leaves.push({ node, start, end: start + nodeLength(node), parent: node.getParent(), index: node.getIndexWithinParent() });
            return;
        }
        let offset = start;
        node.getChildren().forEach((child) => { visit(child, offset); offset += nodeLength(child); });
    };
    visit(root, 0);
    return leaves;
};

export const setCommentSelectionAtOffsets = (
    selection: ReturnType<typeof $getSelection>,
    anchorOffset: number,
    focusOffset: number,
): void => {
    if (!$isRangeSelection(selection)) return;
    const leaves = leavesOf($getRoot());
    if (!leaves.length) { $getRoot().selectEnd(); return; }
    const point = (offset: number) => {
        const clamped = Math.max(0, Math.min(offset, getCommentRawText().length));
        for (const leaf of leaves) {
            if ($isTextNode(leaf.node) && (clamped < leaf.end || clamped === leaf.start)) {
                return { key: leaf.node.getKey(), offset: Math.max(0, clamped - leaf.start), type: 'text' as const };
            }
            if (!$isTextNode(leaf.node) && clamped >= leaf.start && clamped <= leaf.end) {
                const parent = leaf.parent;
                if (parent && $isElementNode(parent)) {
                    return { key: parent.getKey(), offset: clamped <= leaf.start ? leaf.index : leaf.index + 1, type: 'element' as const };
                }
            }
        }
        const last = leaves[leaves.length - 1];
        return $isTextNode(last.node)
            ? { key: last.node.getKey(), offset: last.node.getTextContentSize(), type: 'text' as const }
            : { key: $getRoot().getKey(), offset: $getRoot().getChildrenSize(), type: 'element' as const };
    };
    const anchor = point(anchorOffset);
    const focus = point(focusOffset);
    selection.anchor.set(anchor.key, anchor.offset, anchor.type);
    selection.focus.set(focus.key, focus.offset, focus.type);
};
