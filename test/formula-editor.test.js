import assert from 'node:assert/strict';
import test from 'node:test';
import {
	FORMULA_EDITOR_ROWS,
	formatFormulaEditorLine,
	normalizeFormulaEditorValue,
} from '../src/formula-editor.js';

test('defines formula editor rows in display order', () => {
	assert.deepEqual(FORMULA_EDITOR_ROWS, [
		['X', 'xOut'],
		['Y', 'yOut'],
		['D', 'distFormula'],
	]);
});

test('formats formula editor lines', () => {
	assert.equal(formatFormulaEditorLine('X', 'sin(x)'), 'X: sin(x)');
	assert.equal(formatFormulaEditorLine('D', 'length(result) / u_sqrt2'), 'D: length(result) / u_sqrt2');
});

test('normalizes editable formula text', () => {
	assert.equal(normalizeFormulaEditorValue(' sin(x)\u00a0+\r\ny '), 'sin(x) +\ny');
});
