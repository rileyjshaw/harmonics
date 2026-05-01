export const FORMULA_EDITOR_ROWS = Object.freeze([
	['X', 'xOut'],
	['Y', 'yOut'],
	['D', 'distFormula'],
]);

export function formatFormulaEditorLine(label, formula) {
	return `${label}: ${formula}`;
}

export function normalizeFormulaEditorValue(value) {
	return value.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim();
}
