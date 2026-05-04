import assert from 'node:assert/strict';
import test from 'node:test';
import {
	DIST_FORMULAS,
	INNER_FUNCTIONS,
	N_COLOR_MODES,
	N_GLITCH_MODES,
	OUTER_FUNCTIONS,
	VARIABLES,
	createCustomFormula,
	createRandomFormula,
	decodeCode,
	encodeState,
	extractCodeFromFilename,
	stringifyFormulaAst,
	stringifyFormulaAstExpression,
} from '../src/share-state.js';

const SAFE_CODE_RE = /^1[A-Za-z0-9_-]+$/;
const SAFE_V2_CODE_RE = /^2[A-Za-z0-9_-]+$/;
const SAFE_V1_OR_V2_CODE_RE = /^[12][A-Za-z0-9_-]+$/;

function seededRandom(seed) {
	let state = seed >>> 0;
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 2 ** 32;
	};
}

function assertFormulaEqual(actual, expected) {
	assert.equal(actual.distFormulaIndex, expected.distFormulaIndex);
	assert.equal(actual.distFormula, expected.distFormula);
	assert.equal(actual.tScaleValue, expected.tScaleValue);
	assert.equal(actual.tScale, expected.tScale);
	assert.equal(actual.tHeadstartValue, expected.tHeadstartValue);
	assert.equal(actual.tHeadstart, expected.tHeadstart);
	assert.equal(actual.hueHeadstartValue, expected.hueHeadstartValue);
	assert.equal(actual.hueHeadstart, expected.hueHeadstart);
	assert.equal(actual.xOut, expected.xOut);
	assert.equal(actual.yOut, expected.yOut);
	assert.deepEqual(actual.xAst, expected.xAst);
	assert.deepEqual(actual.yAst, expected.yAst);
}

function decodePayload(code) {
	return Buffer.from(code.slice(1), 'base64url');
}

function encodePayload(payload) {
	return `1${payload.toString('base64url')}`;
}

function simpleOuterAst() {
	return {
		type: 'expression',
		isOuter: true,
		elements: [
			{
				type: 'outer-call',
				fn: 0,
				child: { type: 'variable', variable: 0 },
				timeOperator: 0,
				timeVariable: 0,
			},
		],
		operators: [],
	};
}

test('exports the current v1 formula tables', () => {
	assert.equal(N_COLOR_MODES, 13);
	assert.equal(N_GLITCH_MODES, 7);
	assert.deepEqual(
		OUTER_FUNCTIONS.map(([name]) => name),
		['sine', 'cosine', 'tangent', 'triangle', 'square'],
	);
	assert.deepEqual(
		INNER_FUNCTIONS.map(([name]) => name),
		['sin', 'cos', 'tan'],
	);
	assert.equal(VARIABLES.length, 14);
	assert.equal(DIST_FORMULAS.length, 4);
});

test('stringifies a formula AST using the shader formula format', () => {
	assert.equal(stringifyFormulaAstExpression(simpleOuterAst()), 'sine(t, t + t)');
	assert.equal(stringifyFormulaAst(simpleOuterAst()), '(sine(t, t + t) + 1.) / (1. * 2.)');
});

test('round-trips custom text formulas through URL-safe state codes', () => {
	const formula = createCustomFormula({
		distFormulaIndex: 1,
		tScaleValue: 4,
		tHeadstartValue: 2,
		hueHeadstartValue: 0.125,
		xExpression: 'sin(x + t)',
		yExpression: 'cos(y - t)',
		xNormalizationValue: 2,
		yNormalizationValue: 3,
	});
	const code = encodeState({ colorMode: 2, glitchMode: 3, formula });

	assert.match(code, SAFE_V2_CODE_RE);
	const decoded = decodeCode(code);
	assert.ok(decoded);
	assert.equal(decoded.colorMode, 2);
	assert.equal(decoded.glitchMode, 3);
	assert.deepEqual(decoded.origin, [0, 0]);
	assert.equal(decoded.rotation, 0);
	assert.equal(decoded.zoomLevel, 0);
	assert.equal(decoded.formula.isCustom, true);
	assert.equal(decoded.formula.xExpression, formula.xExpression);
	assert.equal(decoded.formula.yExpression, formula.yExpression);
	assert.equal(decoded.formula.xNormalizationValue, formula.xNormalizationValue);
	assert.equal(decoded.formula.yNormalizationValue, formula.yNormalizationValue);
	assert.equal(decoded.formula.xOut, '(sin(x + t) + 2.) / (2. * 2.)');
	assert.equal(decoded.formula.yOut, '(cos(y - t) + 3.) / (3. * 2.)');
	assert.equal(encodeState(decoded), code);
});

test('round-trips generated states through safe URL and filename code characters', () => {
	for (let seed = 1; seed <= 24; seed++) {
		const formula = createRandomFormula(seed % N_GLITCH_MODES, seededRandom(seed));
		const colorMode = seed % N_COLOR_MODES;
		const glitchMode = seed % N_GLITCH_MODES;
		const code = encodeState({ colorMode, glitchMode, formula });

		// V1 covers colorMode 0–7 (the original 3-bit field); V2 takes over for 8+.
		assert.match(code, SAFE_V1_OR_V2_CODE_RE);
		assert.match(code, colorMode < 8 ? SAFE_CODE_RE : SAFE_V2_CODE_RE);
		assert.equal(code.includes('='), false);
		assert.equal(code.includes('/'), false);
		assert.equal(code.includes('+'), false);

		const decoded = decodeCode(code);
		assert.ok(decoded);
		assert.equal(decoded.colorMode, colorMode);
		assert.equal(decoded.glitchMode, glitchMode);
		assert.deepEqual(decoded.origin, [0, 0]);
		assert.equal(decoded.rotation, 0);
		assert.equal(decoded.zoomLevel, 0);
		assertFormulaEqual(decoded.formula, formula);
		assert.equal(encodeState(decoded), code);
	}
});

test('omits default scene transforms from generated v1 state codes', () => {
	const formula = createRandomFormula(1, seededRandom(25));
	const state = { colorMode: 3, glitchMode: 1, formula };
	const code = encodeState(state);

	assert.equal(encodeState({ ...state, origin: [0, 0], rotation: 0, zoomLevel: 0 }), code);
});

test('round-trips scene transforms through generated v2 state codes', () => {
	const formula = createRandomFormula(2, seededRandom(26));
	const state = { colorMode: 4, glitchMode: 2, formula };
	const code = encodeState({ ...state, origin: [1.5, -2.25], rotation: 3, zoomLevel: -4 });

	assert.match(code, SAFE_V2_CODE_RE);
	assert.equal(extractCodeFromFilename(`harmonics-${code}.png`), code);
	assert.notEqual(code, encodeState(state));

	const decoded = decodeCode(code);
	assert.ok(decoded);
	assert.equal(decoded.colorMode, state.colorMode);
	assert.equal(decoded.glitchMode, state.glitchMode);
	assert.deepEqual(decoded.origin, [1.5, -2.25]);
	assert.equal(decoded.rotation, 3);
	assert.equal(decoded.zoomLevel, -4);
	assertFormulaEqual(decoded.formula, formula);
	assert.equal(encodeState(decoded), code);
});

test('round-trips high-numbered color modes through v2 state codes', () => {
	for (let colorMode = 8; colorMode < N_COLOR_MODES; colorMode++) {
		const formula = createRandomFormula(colorMode % N_GLITCH_MODES, seededRandom(400 + colorMode));
		const glitchMode = colorMode % N_GLITCH_MODES;
		const code = encodeState({ colorMode, glitchMode, formula });

		assert.match(code, SAFE_V2_CODE_RE);
		assert.equal(extractCodeFromFilename(`harmonics-${code}.png`), code);

		const decoded = decodeCode(code);
		assert.ok(decoded);
		assert.equal(decoded.colorMode, colorMode);
		assert.equal(decoded.glitchMode, glitchMode);
		assert.deepEqual(decoded.origin, [0, 0]);
		assert.equal(decoded.rotation, 0);
		assert.equal(decoded.zoomLevel, 0);
		assertFormulaEqual(decoded.formula, formula);
		assert.equal(encodeState(decoded), code);
	}
});

test('round-trips scene transforms through custom text state codes', () => {
	const formula = createCustomFormula({
		distFormulaIndex: 2,
		tScaleValue: 7,
		tHeadstartValue: 4,
		hueHeadstartValue: 0.75,
		xExpression: 'sin(x * 2.)',
		yExpression: 'cos(y * .5)',
		xNormalizationValue: 2,
		yNormalizationValue: 2,
	});
	const code = encodeState({ colorMode: 5, glitchMode: 6, origin: [-0.5, 0.25], rotation: 1, zoomLevel: 6, formula });

	assert.match(code, SAFE_V2_CODE_RE);

	const decoded = decodeCode(code);
	assert.ok(decoded);
	assert.equal(decoded.colorMode, 5);
	assert.equal(decoded.glitchMode, 6);
	assert.deepEqual(decoded.origin, [-0.5, 0.25]);
	assert.equal(decoded.rotation, 1);
	assert.equal(decoded.zoomLevel, 6);
	assert.equal(decoded.formula.isCustom, true);
	assert.equal(decoded.formula.xExpression, formula.xExpression);
	assert.equal(decoded.formula.yExpression, formula.yExpression);
	assert.equal(encodeState(decoded), code);
});

test('extracts codes from screenshot filenames only', () => {
	const formula = createRandomFormula(0, seededRandom(100));
	const code = encodeState({ colorMode: 1, glitchMode: 2, formula });

	assert.equal(extractCodeFromFilename(`harmonics-${code}.png`), code);
	assert.equal(extractCodeFromFilename(`harmonics-${code}.webp`), code);
	assert.equal(extractCodeFromFilename(`harmonics-${code}`), code);
	assert.equal(extractCodeFromFilename(`harmonics-${code} copy.png`), code);
	assert.equal(extractCodeFromFilename(`harmonics-${code} Copy 2.png`), code);
	assert.equal(extractCodeFromFilename(`harmonics-${code} (1).png`), code);
	assert.equal(extractCodeFromFilename(`harmonics-${code}(1).png`), code);
	assert.equal(extractCodeFromFilename(`harmonics-${code} copy (1).png`), code);
	assert.equal(extractCodeFromFilename(`harmonics-${code}.backup.png`), null);
	assert.equal(extractCodeFromFilename(`other-${code}.png`), null);
	assert.equal(extractCodeFromFilename(`Harmonics-${code}.png`), null);
	assert.equal(extractCodeFromFilename(`harmonics-${code}%.png`), null);
	assert.equal(extractCodeFromFilename(`harmonics-${code} backup.png`), null);
});

test('rejects invalid codes', () => {
	const formula = createRandomFormula(0, seededRandom(200));
	const code = encodeState({ colorMode: 0, glitchMode: 0, formula });

	assert.equal(decodeCode(`2${code.slice(1)}`), null);
	assert.equal(decodeCode(`${code}%`), null);
	assert.equal(decodeCode('1A'), null);
});

test('rejects impossible enum values while decoding', () => {
	const formula = createRandomFormula(0, seededRandom(300));
	const code = encodeState({ colorMode: 0, glitchMode: 0, formula });

	const glitchPayload = decodePayload(code);
	glitchPayload[0] = (glitchPayload[0] & 0xe3) | (7 << 2);
	assert.equal(decodeCode(encodePayload(glitchPayload)), null);
});

test('rejects nonzero bitstream padding', () => {
	const ast = simpleOuterAst();
	const code = encodeState({
		colorMode: 0,
		glitchMode: 0,
		formula: {
			distFormulaIndex: 0,
			tScaleValue: 1,
			tHeadstartValue: 0,
			hueHeadstartValue: 0.5,
			xAst: ast,
			yAst: ast,
		},
	});
	const payload = decodePayload(code);

	payload[payload.length - 1] |= 1;
	assert.equal(decodeCode(encodePayload(payload)), null);
});
