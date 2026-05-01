export const OUTER_FUNCTIONS = Object.freeze([
	['sine', 8],
	['cosine', 8],
	['tangent', 8], // NOTE: This breaks a key rule, that outer functions should always be bounded [-1, 1]. But it looks awesome.
	['triangle', 4],
	['square', 2],
]);
export const OUTER_OPERATORS = Object.freeze(['+', '-']);
export const INNER_FUNCTIONS = Object.freeze([
	['sin', 1],
	['cos', 1],
	['tan', 2], // Higher = greater "glass block" occurrence.
]);
export const INNER_OPERATORS = Object.freeze(['+', '-', '*']);
export const VARIABLES = Object.freeze([
	't',
	'x',
	'y',
	'sx',
	'sy',
	'xx',
	'yy',
	'(xx + yy)',
	'(xx - yy)',
	'.5',
	'2.',
	'u_tau',
	'u_pi',
	'u_sqrt2',
]);
export const TIME_OPERATORS = Object.freeze(['+', '*']);
export const DIST_FORMULAS = Object.freeze([
	['result.x', 1],
	['length(result) / u_sqrt2', 1],
	['result.x * result.y', 1],
	['(result.x + result.y) / 2.', 1],
]);

export const N_COLOR_MODES = 6;
export const N_GLITCH_MODES = 7;

const AST_CODE_VERSION = '1';
const TEXT_CODE_VERSION = '2';
const SAFE_CODE_RE = /^[12][A-Za-z0-9_-]+$/;
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
const BASE64URL_LOOKUP = new Map([...BASE64URL_ALPHABET].map((char, index) => [char, index]));
const MAX_DECODE_ELEMENTS = 64;
const MAX_DECODE_DEPTH = 32;
const MAX_FORMULA_TEXT_BYTES = 8192;
const MAX_FORMULA_NORMALIZATION_VALUE = 64;

const RANDOM_FACTORS = {
	normal: {
		outer: 9,
		inner: 6,
		depth: 3,
	},
	glitched: {
		outer: 3,
		inner: 2,
		depth: 1,
	},
};

function getRandomIndex(arr, random) {
	return Math.floor(random() * arr.length);
}

function getRandomWeightedIndex(arr, random) {
	const totalWeight = arr.reduce((total, item) => total + item[1], 0);
	const cutoff = random() * totalWeight;
	let sum = 0;
	for (let i = 0; i < arr.length; i++) {
		sum += arr[i][1];
		if (cutoff < sum) return i;
	}
	return arr.length - 1;
}

function generateRandomExpressionAst(maxOuterElements, maxInnerElements, maxDepth, random) {
	// Reduce max outer and inner elements across all `generateElements` calls.
	const complexity = random();
	const outerMaxElements = Math.floor(maxOuterElements * complexity) + 1;
	const innerMaxElements = Math.floor(maxInnerElements * complexity) + 1;

	function generateElements(depth = 0) {
		const isOuterExpression = depth === 0;
		const maxElements = isOuterExpression ? outerMaxElements : innerMaxElements;
		const nElements = Math.floor(random() * maxElements) + 1;
		const elements = [];

		for (let i = 0; i < nElements; i++) {
			const shouldRecurse = depth < maxDepth && random() < 0.4;
			const shouldWrapWithFn = isOuterExpression || shouldRecurse || random() < 0.33;
			const child = shouldRecurse
				? { type: 'expression', expression: generateElements(depth + 1) }
				: { type: 'variable', variable: getRandomIndex(VARIABLES, random) };

			if (isOuterExpression) {
				elements.push({
					type: 'outer-call',
					fn: getRandomWeightedIndex(OUTER_FUNCTIONS, random),
					child,
					timeOperator: getRandomIndex(TIME_OPERATORS, random),
					timeVariable: getRandomIndex(VARIABLES, random),
				});
			} else if (shouldWrapWithFn) {
				elements.push({
					type: 'inner-call',
					fn: getRandomWeightedIndex(INNER_FUNCTIONS, random),
					child,
				});
			} else {
				elements.push({
					type: 'variable',
					variable: child.variable,
				});
			}
		}

		const operators = [];
		const operatorsTable = isOuterExpression ? OUTER_OPERATORS : INNER_OPERATORS;
		for (let i = 1; i < nElements; i++) {
			operators.push(getRandomIndex(operatorsTable, random));
		}

		return {
			type: 'expression',
			isOuter: isOuterExpression,
			elements,
			operators,
		};
	}

	return generateElements();
}

function stringifyExpressionRaw(expression) {
	const operators = expression.isOuter ? OUTER_OPERATORS : INNER_OPERATORS;
	const elements = expression.elements.map(element => stringifyElement(element, expression.isOuter));
	let output = elements[0];

	for (let i = 1; i < elements.length; i++) {
		output = `${output} ${operators[expression.operators[i - 1]]} ${elements[i]}`;
	}

	return output;
}

export function stringifyFormulaAstExpression(ast) {
	return stringifyExpressionRaw(ast);
}

function stringifyChild(child) {
	return child.type === 'variable' ? VARIABLES[child.variable] : stringifyExpressionRaw(child.expression);
}

function stringifyElement(element, isOuterExpression) {
	if (isOuterExpression) {
		return `${OUTER_FUNCTIONS[element.fn][0]}(${stringifyChild(element.child)}, t ${
			TIME_OPERATORS[element.timeOperator]
		} ${VARIABLES[element.timeVariable]})`;
	}

	if (element.type === 'variable') return VARIABLES[element.variable];
	return `${INNER_FUNCTIONS[element.fn][0]}(${stringifyChild(element.child)})`;
}

export function stringifyFormulaAst(ast) {
	const expression = stringifyFormulaAstExpression(ast);
	const chainLength = ast.elements.length;

	// Since each element in the expression ranges [-1, 1], normalize output to [0, 1] like so:
	return normalizeFormulaExpression(expression, chainLength);
}

function formatFloatLiteral(value) {
	if (Object.is(value, -0)) return '-0.';
	const output = String(value);
	return /^-?\d+$/.test(output) ? `${output}.` : output;
}

function normalizeFormulaExpression(expression, normalizationValue) {
	return `(${expression} + ${normalizationValue}.) / (${normalizationValue}. * 2.)`;
}

function assertFormulaText(expression) {
	if (typeof expression !== 'string' || expression.trim() === '')
		throw new RangeError('Formula expressions cannot be empty.');
	return expression.trim();
}

function assertFormulaNormalizationValue(value) {
	if (!Number.isInteger(value) || value < 1 || value > MAX_FORMULA_NORMALIZATION_VALUE) {
		throw new RangeError('Formula normalization value is out of range.');
	}
	return value;
}

function createFormula({ distFormulaIndex, hueHeadstartValue, tHeadstartValue, tScaleValue, xAst, yAst }) {
	const xExpression = stringifyFormulaAstExpression(xAst);
	const yExpression = stringifyFormulaAstExpression(yAst);
	const xNormalizationValue = xAst.elements.length;
	const yNormalizationValue = yAst.elements.length;

	return {
		distFormulaIndex,
		distFormula: DIST_FORMULAS[distFormulaIndex][0],
		hueHeadstartValue,
		hueHeadstart: formatFloatLiteral(hueHeadstartValue),
		tHeadstartValue,
		tHeadstart: `${tHeadstartValue}.`,
		tScaleValue,
		tScale: `${tScaleValue}.`,
		xAst,
		yAst,
		xExpression,
		yExpression,
		xNormalizationValue,
		yNormalizationValue,
		xOut: normalizeFormulaExpression(xExpression, xNormalizationValue),
		yOut: normalizeFormulaExpression(yExpression, yNormalizationValue),
	};
}

export function createCustomFormula({
	distFormulaIndex,
	hueHeadstartValue,
	tHeadstartValue,
	tScaleValue,
	xExpression,
	yExpression,
	xNormalizationValue = 1,
	yNormalizationValue = 1,
}) {
	const normalizedXExpression = assertFormulaText(xExpression);
	const normalizedYExpression = assertFormulaText(yExpression);
	const normalizedXValue = assertFormulaNormalizationValue(xNormalizationValue);
	const normalizedYValue = assertFormulaNormalizationValue(yNormalizationValue);

	return {
		isCustom: true,
		distFormulaIndex,
		distFormula: DIST_FORMULAS[distFormulaIndex][0],
		hueHeadstartValue,
		hueHeadstart: formatFloatLiteral(hueHeadstartValue),
		tHeadstartValue,
		tHeadstart: `${tHeadstartValue}.`,
		tScaleValue,
		tScale: `${tScaleValue}.`,
		xExpression: normalizedXExpression,
		yExpression: normalizedYExpression,
		xNormalizationValue: normalizedXValue,
		yNormalizationValue: normalizedYValue,
		xOut: normalizeFormulaExpression(normalizedXExpression, normalizedXValue),
		yOut: normalizeFormulaExpression(normalizedYExpression, normalizedYValue),
	};
}

export function createRandomFormula(glitchMode, random = Math.random) {
	const distFormulaIndex = getRandomWeightedIndex(DIST_FORMULAS, random);
	const { outer, inner, depth } = RANDOM_FACTORS[glitchMode ? 'glitched' : 'normal'];
	const xAst = generateRandomExpressionAst(outer, inner, depth, random);
	const yAst = generateRandomExpressionAst(outer, inner, depth, random);
	const tScaleValue = Math.floor(random() * 12) + 1;
	const tHeadstartValue = Math.floor(random() * 6);
	const hueHeadstartValue = random() || 0;

	return createFormula({
		distFormulaIndex,
		hueHeadstartValue,
		tHeadstartValue,
		tScaleValue,
		xAst,
		yAst,
	});
}

class BitWriter {
	bytes = [];
	currentByte = 0;
	bitLength = 0;

	writeBit(bit) {
		if (bit) this.currentByte |= 1 << (7 - (this.bitLength % 8));
		this.bitLength += 1;
		if (this.bitLength % 8 === 0) {
			this.bytes.push(this.currentByte);
			this.currentByte = 0;
		}
	}

	writeBits(value, count) {
		if (!Number.isInteger(value) || value < 0 || value >= 2 ** count) {
			throw new RangeError(`Value ${value} does not fit in ${count} bits.`);
		}
		for (let i = count - 1; i >= 0; i--) this.writeBit((value >> i) & 1);
	}

	writeCode(code) {
		for (const bit of code) this.writeBit(bit === '1' ? 1 : 0);
	}

	writeGamma(value) {
		if (!Number.isInteger(value) || value < 1) throw new RangeError('Gamma values must be positive integers.');
		const binary = value.toString(2);
		for (let i = 1; i < binary.length; i++) this.writeBit(0);
		this.writeCode(binary);
	}

	writeFloat64(value) {
		if (!Number.isFinite(value)) throw new RangeError('Only finite float values can be encoded.');
		const bytes = new Uint8Array(8);
		new DataView(bytes.buffer).setFloat64(0, value, false);
		for (const byte of bytes) this.writeBits(byte, 8);
	}

	writeString(value) {
		const bytes = new TextEncoder().encode(value);
		if (bytes.length > MAX_FORMULA_TEXT_BYTES) throw new RangeError('Formula text is too long.');
		this.writeGamma(bytes.length + 1);
		for (const byte of bytes) this.writeBits(byte, 8);
	}

	toBytes() {
		return Uint8Array.from(this.bitLength % 8 === 0 ? this.bytes : [...this.bytes, this.currentByte]);
	}
}

class BitReader {
	constructor(bytes) {
		this.bytes = bytes;
		this.bitOffset = 0;
		this.bitLength = bytes.length * 8;
	}

	remainingBits() {
		return this.bitLength - this.bitOffset;
	}

	readBit() {
		if (this.bitOffset >= this.bitLength) throw new RangeError('Unexpected end of code.');
		const byte = this.bytes[this.bitOffset >> 3];
		const bit = (byte >> (7 - (this.bitOffset % 8))) & 1;
		this.bitOffset += 1;
		return bit;
	}

	readBits(count) {
		let value = 0;
		for (let i = 0; i < count; i++) value = (value << 1) | this.readBit();
		return value;
	}

	readGamma() {
		let leadingZeros = 0;
		while (this.readBit() === 0) {
			leadingZeros += 1;
			if (leadingZeros > 15) throw new RangeError('Gamma value is too large.');
		}

		let value = 1;
		for (let i = 0; i < leadingZeros; i++) value = (value << 1) | this.readBit();
		return value;
	}

	readFloat64() {
		const bytes = new Uint8Array(8);
		for (let i = 0; i < bytes.length; i++) bytes[i] = this.readBits(8);
		const value = new DataView(bytes.buffer).getFloat64(0, false);
		if (!Number.isFinite(value)) throw new RangeError('Decoded float is not finite.');
		return value;
	}

	readString() {
		const byteLength = this.readGamma() - 1;
		if (byteLength > MAX_FORMULA_TEXT_BYTES) throw new RangeError('Formula text is too long.');

		const bytes = new Uint8Array(byteLength);
		for (let i = 0; i < bytes.length; i++) bytes[i] = this.readBits(8);
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	}

	assertOnlyZeroPadding() {
		if (this.remainingBits() >= 8) throw new RangeError('Unexpected trailing bytes.');
		while (this.remainingBits() > 0) {
			if (this.readBit() !== 0) throw new RangeError('Nonzero padding bits.');
		}
	}
}

function bytesToBase64Url(bytes) {
	let output = '';
	let buffer = 0;
	let bits = 0;

	for (const byte of bytes) {
		buffer = (buffer << 8) | byte;
		bits += 8;
		while (bits >= 6) {
			bits -= 6;
			output += BASE64URL_ALPHABET[(buffer >> bits) & 0x3f];
			buffer &= (1 << bits) - 1;
		}
	}

	if (bits > 0) output += BASE64URL_ALPHABET[(buffer << (6 - bits)) & 0x3f];
	return output;
}

function base64UrlToBytes(input) {
	if (input.length === 0 || input.length % 4 === 1) throw new RangeError('Invalid base64url length.');

	const bytes = [];
	let buffer = 0;
	let bits = 0;

	for (const char of input) {
		const value = BASE64URL_LOOKUP.get(char);
		if (value == null) throw new RangeError('Invalid base64url character.');
		buffer = (buffer << 6) | value;
		bits += 6;
		while (bits >= 8) {
			bits -= 8;
			bytes.push((buffer >> bits) & 0xff);
			buffer &= (1 << bits) - 1;
		}
	}

	if (buffer !== 0) throw new RangeError('Non-canonical base64url padding.');
	return Uint8Array.from(bytes);
}

function writeOuterFunction(writer, index) {
	writer.writeCode(['0', '10', '110', '1110', '1111'][index]);
}

function readOuterFunction(reader) {
	if (reader.readBit() === 0) return 0;
	if (reader.readBit() === 0) return 1;
	if (reader.readBit() === 0) return 2;
	return reader.readBit() === 0 ? 3 : 4;
}

function writeInnerFunction(writer, index) {
	writer.writeCode(['0', '10', '11'][index]);
}

function readInnerFunction(reader) {
	if (reader.readBit() === 0) return 0;
	return reader.readBit() === 0 ? 1 : 2;
}

function writeInnerOperator(writer, index) {
	writer.writeCode(['0', '10', '11'][index]);
}

function readInnerOperator(reader) {
	if (reader.readBit() === 0) return 0;
	return reader.readBit() === 0 ? 1 : 2;
}

function writeChild(writer, child) {
	if (child.type === 'variable') {
		writer.writeBit(0);
		writer.writeBits(child.variable, 4);
	} else {
		writer.writeBit(1);
		writeExpression(writer, child.expression, false);
	}
}

function readChild(reader, depth) {
	if (reader.readBit() === 0) {
		const variable = reader.readBits(4);
		if (variable >= VARIABLES.length) throw new RangeError('Variable index is out of range.');
		return { type: 'variable', variable };
	}

	return { type: 'expression', expression: readExpression(reader, false, depth + 1) };
}

function writeExpression(writer, expression, isOuterExpression) {
	writer.writeGamma(expression.elements.length);
	for (let i = 0; i < expression.elements.length; i++) {
		if (i > 0) {
			if (isOuterExpression) writer.writeBit(expression.operators[i - 1]);
			else writeInnerOperator(writer, expression.operators[i - 1]);
		}

		const element = expression.elements[i];
		if (isOuterExpression) {
			writeOuterFunction(writer, element.fn);
			writeChild(writer, element.child);
			writer.writeBits(element.timeOperator, 1);
			writer.writeBits(element.timeVariable, 4);
		} else if (element.type === 'variable') {
			writer.writeBit(0);
			writer.writeBits(element.variable, 4);
		} else {
			writer.writeBit(1);
			writer.writeBit(element.child.type === 'variable' ? 0 : 1);
			writeInnerFunction(writer, element.fn);
			if (element.child.type === 'variable') {
				writer.writeBits(element.child.variable, 4);
			} else {
				writeExpression(writer, element.child.expression, false);
			}
		}
	}
}

function readExpression(reader, isOuterExpression, depth = 0) {
	if (depth > MAX_DECODE_DEPTH) throw new RangeError('Expression is too deeply nested.');

	const nElements = reader.readGamma();
	if (nElements > MAX_DECODE_ELEMENTS) throw new RangeError('Expression has too many elements.');

	const elements = [];
	const operators = [];

	for (let i = 0; i < nElements; i++) {
		if (i > 0) operators.push(isOuterExpression ? reader.readBits(1) : readInnerOperator(reader));

		if (isOuterExpression) {
			const fn = readOuterFunction(reader);
			const child = readChild(reader, depth);
			const timeOperator = reader.readBits(1);
			const timeVariable = reader.readBits(4);
			if (timeVariable >= VARIABLES.length) throw new RangeError('Time variable index is out of range.');
			elements.push({ type: 'outer-call', fn, child, timeOperator, timeVariable });
		} else if (reader.readBit() === 0) {
			const variable = reader.readBits(4);
			if (variable >= VARIABLES.length) throw new RangeError('Variable index is out of range.');
			elements.push({ type: 'variable', variable });
		} else {
			const childIsExpression = reader.readBit() === 1;
			const fn = readInnerFunction(reader);
			const child = childIsExpression
				? { type: 'expression', expression: readExpression(reader, false, depth + 1) }
				: { type: 'variable', variable: reader.readBits(4) };
			if (child.type === 'variable' && child.variable >= VARIABLES.length) {
				throw new RangeError('Variable index is out of range.');
			}
			elements.push({ type: 'inner-call', fn, child });
		}
	}

	return {
		type: 'expression',
		isOuter: isOuterExpression,
		elements,
		operators,
	};
}

export function encodeState({ colorMode, glitchMode, formula }) {
	if (!Number.isInteger(colorMode) || colorMode < 0 || colorMode >= N_COLOR_MODES) {
		throw new RangeError('Color mode is out of range.');
	}
	if (!Number.isInteger(glitchMode) || glitchMode < 0 || glitchMode >= N_GLITCH_MODES) {
		throw new RangeError('Glitch mode is out of range.');
	}

	const writer = new BitWriter();
	writer.writeBits(colorMode, 3);
	writer.writeBits(glitchMode, 3);
	writer.writeBits(formula.distFormulaIndex, 2);
	writer.writeBits(formula.tScaleValue - 1, 4);
	writer.writeBits(formula.tHeadstartValue, 3);
	writer.writeFloat64(formula.hueHeadstartValue);

	if (formula.isCustom || !formula.xAst || !formula.yAst) {
		writer.writeGamma(assertFormulaNormalizationValue(formula.xNormalizationValue ?? 1));
		writer.writeGamma(assertFormulaNormalizationValue(formula.yNormalizationValue ?? 1));
		writer.writeString(assertFormulaText(formula.xExpression));
		writer.writeString(assertFormulaText(formula.yExpression));
		return `${TEXT_CODE_VERSION}${bytesToBase64Url(writer.toBytes())}`;
	}

	writeExpression(writer, formula.xAst, true);
	writeExpression(writer, formula.yAst, true);
	return `${AST_CODE_VERSION}${bytesToBase64Url(writer.toBytes())}`;
}

function readStateHeader(reader) {
	const colorMode = reader.readBits(3);
	if (colorMode >= N_COLOR_MODES) throw new RangeError('Color mode is out of range.');

	const glitchMode = reader.readBits(3);
	if (glitchMode >= N_GLITCH_MODES) throw new RangeError('Glitch mode is out of range.');

	const distFormulaIndex = reader.readBits(2);
	const tScaleValue = reader.readBits(4) + 1;
	if (tScaleValue > 12) throw new RangeError('Time scale is out of range.');

	const tHeadstartValue = reader.readBits(3);
	if (tHeadstartValue >= 6) throw new RangeError('Time headstart is out of range.');

	const hueHeadstartValue = reader.readFloat64();

	return { colorMode, glitchMode, distFormulaIndex, tScaleValue, tHeadstartValue, hueHeadstartValue };
}

function decodeAstCode(reader) {
	const { colorMode, glitchMode, distFormulaIndex, tScaleValue, tHeadstartValue, hueHeadstartValue } =
		readStateHeader(reader);
	const xAst = readExpression(reader, true);
	const yAst = readExpression(reader, true);
	reader.assertOnlyZeroPadding();

	return {
		colorMode,
		glitchMode,
		formula: createFormula({
			distFormulaIndex,
			hueHeadstartValue,
			tHeadstartValue,
			tScaleValue,
			xAst,
			yAst,
		}),
	};
}

function decodeTextCode(reader) {
	const { colorMode, glitchMode, distFormulaIndex, tScaleValue, tHeadstartValue, hueHeadstartValue } =
		readStateHeader(reader);
	const xNormalizationValue = assertFormulaNormalizationValue(reader.readGamma());
	const yNormalizationValue = assertFormulaNormalizationValue(reader.readGamma());
	const xExpression = reader.readString();
	const yExpression = reader.readString();
	reader.assertOnlyZeroPadding();

	return {
		colorMode,
		glitchMode,
		formula: createCustomFormula({
			distFormulaIndex,
			hueHeadstartValue,
			tHeadstartValue,
			tScaleValue,
			xExpression,
			yExpression,
			xNormalizationValue,
			yNormalizationValue,
		}),
	};
}

function decodeCodeOrThrow(code) {
	if (!SAFE_CODE_RE.test(code)) throw new RangeError('Code contains unsafe characters or an unsupported version.');

	const reader = new BitReader(base64UrlToBytes(code.slice(1)));
	if (code[0] === AST_CODE_VERSION) return decodeAstCode(reader);
	if (code[0] === TEXT_CODE_VERSION) return decodeTextCode(reader);
	throw new RangeError('Unsupported code version.');
}

export function decodeCode(code) {
	try {
		return decodeCodeOrThrow(code);
	} catch {
		return null;
	}
}

export function extractCodeFromFilename(filename) {
	const match = /^harmonics-([A-Za-z0-9_-]+)(?:\.[^.]+)?$/.exec(filename);
	return match?.[1] ?? null;
}
