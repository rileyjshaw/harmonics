import assert from 'node:assert/strict';
import test from 'node:test';
import {
	DIST_FORMULAS,
	INNER_FUNCTIONS,
	N_COLOR_MODES,
	N_GLITCH_MODES,
	OUTER_FUNCTIONS,
	VARIABLES,
	createRandomFormula,
	decodeCode,
	encodeState,
	extractCodeFromFilename,
	stringifyFormulaAst,
} from '../src/share-state.js';

const SAFE_CODE_RE = /^1[A-Za-z0-9_-]+$/;

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
	assert.equal(N_COLOR_MODES, 6);
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
	assert.equal(stringifyFormulaAst(simpleOuterAst()), '(sine(t, t + t) + 1.) / (1. * 2.)');
});

test('round-trips generated states through safe URL and filename code characters', () => {
	for (let seed = 1; seed <= 24; seed++) {
		const formula = createRandomFormula(seed % N_GLITCH_MODES, seededRandom(seed));
		const colorMode = seed % N_COLOR_MODES;
		const glitchMode = seed % N_GLITCH_MODES;
		const code = encodeState({ colorMode, glitchMode, formula });

		assert.match(code, SAFE_CODE_RE);
		assert.equal(code.includes('='), false);
		assert.equal(code.includes('/'), false);
		assert.equal(code.includes('+'), false);

		const decoded = decodeCode(code);
		assert.ok(decoded);
		assert.equal(decoded.colorMode, colorMode);
		assert.equal(decoded.glitchMode, glitchMode);
		assertFormulaEqual(decoded.formula, formula);
		assert.equal(encodeState(decoded), code);
	}
});

test('extracts codes from screenshot filenames only', () => {
	const formula = createRandomFormula(0, seededRandom(100));
	const code = encodeState({ colorMode: 1, glitchMode: 2, formula });

	assert.equal(extractCodeFromFilename(`harmonics-${code}.png`), code);
	assert.equal(extractCodeFromFilename(`harmonics-${code}.webp`), code);
	assert.equal(extractCodeFromFilename(`harmonics-${code}`), code);
	assert.equal(extractCodeFromFilename(`harmonics-${code}.backup.png`), null);
	assert.equal(extractCodeFromFilename(`other-${code}.png`), null);
	assert.equal(extractCodeFromFilename(`harmonics-${code}%.png`), null);
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
	const payload = decodePayload(code);

	payload[0] = (6 << 5) | (payload[0] & 0x1f);
	assert.equal(decodeCode(encodePayload(payload)), null);

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
