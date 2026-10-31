import { expect, it } from 'vitest';
import { tagEdgeGeometry } from './tagEdgeGeometry';

it('joins the actual parent bottom and child left, across intervening rows or wrapped pills', () => {
    const row = { left: 40, top: 160, width: 300, height: 48 };
    const parent = { left: 54, top: 80, width: 76, height: 40 };
    const child = { left: 86, top: 164, width: 130, height: 40 };
    const edge = tagEdgeGeometry(row, child, parent, 4, 14, 1);
    expect(row.top + edge.top).toBe(parent.top + parent.height);
    expect(row.left + edge.left + edge.width).toBe(child.left);
    expect(row.top + row.height - edge.bottom - .5).toBe(child.top + child.height / 2);
    expect(row.left + edge.left + .5).toBeGreaterThan(parent.left);
    expect(row.left + edge.left + .5).toBeLessThan(parent.left + parent.width);
    expect(edge.dots).toHaveLength(1);
});

it.each([12, 16, 22])('keeps an independent stem below its own upper edge at %ipx, never at a preceding row', font => {
    const row = { left: 40, top: 200, width: 300, height: font * 2.5 };
    const child = { left: 86, top: 204, width: 100, height: font * 2 };
    const edge = tagEdgeGeometry(row, child, undefined, 4, font, 2);
    expect(row.top + edge.top).toBeGreaterThan(child.top);
    expect(row.top + edge.top).toBeLessThan(child.top + child.height / 2);
    expect(row.left + edge.left + edge.width).toBe(child.left);
    expect(edge.dots).toHaveLength(2);
    expect(edge.dots[0]).toBeLessThan(edge.dots[1]);
});

it('keeps the checkbox-tree trunk outside the child checkbox while touching both pills', () => {
    const row = { left: 0, top: 32, width: 300, height: 28 };
    const parent = { left: 21, top: 3, width: 70, height: 22 };
    const child = { left: 42, top: 35, width: 70, height: 22 };
    const edge = tagEdgeGeometry(row, child, parent, 6.5, 12, 0, 16);
    expect(edge.left).toBeGreaterThan(21 + 13);
    expect(edge.left + edge.width).toBe(child.left);
    expect(edge.top + row.top).toBe(parent.top + parent.height);
});


it('reserves a disclosure slot and gap while keeping the stem attached to the real parent', () => {
    const row={left:0,top:32,width:300,height:28};
    const parent={left:14,top:3,width:70,height:22};
    const child={left:38,top:35,width:70,height:22};
    const slot={left:24,top:34,width:14,height:24};
    const edge=tagEdgeGeometry(row,child,parent,4,12,0,4,slot);
    expect(edge.left+edge.width).toBe(slot.left-2);
    expect(edge.width).toBeGreaterThan(0);
    expect(edge.top+row.top).toBe(parent.top+parent.height);
});
