import { detectBlock } from '../block/block-detector';
import { type Block, BlockType } from '../block/block-types';
import type { Doc } from '../markdown/document-types';
import type { Gap } from '../markdown/gap';
import { type LineMap, listItemContaining, quoteRunAt } from '../markdown/line-map';
import type { LineRange } from '../markdown/line-range-types';
import { parseLine } from '../parse/parse-line';

export type DropDecision =
    | { allowDrop: true }
    | { allowDrop: false; rejectReason: 'inside_list' | 'inside_quote_run'; region: LineRange };

/**
 * Container rules for a gap of the document `lineMap` describes, over every
 * top-level selected block of the payload (read in `sourceDoc`):
 *   - an unquoted list item's subtree accepts only unquoted list items (a
 *     list inside a quote is that quote run's interior);
 *   - a tight quote run (every seam inside a callout, inside a plain quote,
 *     and around quoted lists) accepts only one stack of plain quote lines of
 *     its own depth, between two plain quote lines outside any callout.
 * A gap must pass both; every other gap accepts every block. A rejection
 * carries the protected region, whose edges are where the drop can go
 * instead: the list rule comes first, so a seam in a quote run inside a list
 * item reports the item, whose edges leave it.
 */
export function canDropAt(
    payload: { blocks: readonly Block[]; content: string },
    gap: Gap,
    options: { lineMap: LineMap; tabSize: number; sourceDoc: Doc },
): DropDecision {
    if (!gap.above || !gap.below) return { allowDrop: true };
    const { lineMap, tabSize, sourceDoc } = options;
    const { blocks } = payload;
    const aboveLine = gap.seam - gap.blankLines - 1;
    const quoteDepth = (block: Block) => parseLine(sourceDoc.line(block.lines.startLine).text, tabSize).quote.depth;

    const item = listItemContaining(lineMap, aboveLine, 0);
    if (
        item !== null &&
        lineMap.lineMeta[item].quoteDepth === 0 &&
        lineMap.listSubtreeEndLine[item] >= gap.seam &&
        !blocks.every((block) => block.type === BlockType.ListItem && quoteDepth(block) === 0)
    ) {
        return {
            allowDrop: false,
            rejectReason: 'inside_list',
            region: { startLine: item, endLine: lineMap.listSubtreeEndLine[item] },
        };
    }

    const depth = lineMap.lineMeta[aboveLine].quoteDepth;
    if (gap.blankLines === 0 && depth > 0 && lineMap.lineMeta[gap.seam].quoteDepth > 0) {
        const joinsRun =
            gap.above.type === BlockType.Blockquote &&
            gap.below.type === BlockType.Blockquote &&
            lineMap.lineMeta[gap.seam].quoteDepth === depth &&
            !calloutCovers(lineMap.doc, aboveLine, gap.seam, { lineMap, tabSize }) &&
            !payload.content.split('\n').some((line) => line.trim().length === 0) &&
            blocks.every((block) => block.type === BlockType.Blockquote && quoteDepth(block) === depth);
        if (!joinsRun) {
            return { allowDrop: false, rejectReason: 'inside_quote_run', region: quoteRunAt(lineMap, aboveLine) };
        }
    }
    return { allowDrop: true };
}

/** Whether one callout, starting at or above `top`, reaches down to `bottom`. */
export function calloutCovers(
    doc: Doc,
    top: number,
    bottom: number,
    options: { lineMap: LineMap; tabSize: number },
): boolean {
    const { lineMeta } = options.lineMap;
    for (let line = top; line >= 1 && lineMeta[line].quoteDepth > 0; line--) {
        if (!lineMeta[line].isCallout) continue;
        const callout = detectBlock(doc, line, options);
        if (callout?.type === BlockType.Callout && callout.lines.endLine >= bottom) return true;
    }
    return false;
}
