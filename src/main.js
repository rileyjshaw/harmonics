import ShaderPad from 'shaderpad';
import { createFullscreenCanvas, save } from 'shaderpad/util';
import autosize from 'shaderpad/plugins/autosize';

function getRandomElement(arr) {
	return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomWeightedElement(arr) {
	const totalWeight = arr.reduce((a, b) => a + b[1], 0);
	const cutoff = Math.random() * totalWeight;
	let sum = 0;
	for (let i = 0; i < arr.length; i++) {
		sum += arr[i][1];
		if (cutoff < sum) return arr[i][0];
	}
	return arr[arr.length - 1][0];
}

const OUTER_FUNCTIONS = [
	['sine', 16],
	['cosine', 8],
	['tangent', 8], // NOTE: This breaks a key rule, that outer functions should always be bounded [-1, 1]. But it looks awesome.
	['triangle', 4],
	['square', 1],
];
const OUTER_OPERATORS = ['+', '-'];
const INNER_FUNCTIONS = [
	['sin', 1],
	['cos', 1],
	['tan', 1], // Higher = greater “glass block” occurrence.
];
const INNER_OPERATORS = ['+', '-', '*'];
const VARIABLES = [
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
];
const TIME_OPERATORS = ['+', '*'];
function generateRandomExpression(maxOuterElements, maxInnerElements, maxDepth) {
	// Reduce max outer and inner elements across all `generateElements` calls.
	const complexity = Math.random();
	const outer = [Math.floor(maxOuterElements * complexity) + 1, OUTER_OPERATORS, OUTER_FUNCTIONS];
	const inner = [Math.floor(maxInnerElements * complexity) + 1, INNER_OPERATORS, INNER_FUNCTIONS];

	function generateElements(depth = 0) {
		const isOuterExpression = depth === 0;
		const [maxElements, operators, functions] = isOuterExpression ? outer : inner;
		const nElements = Math.floor(Math.random() * maxElements) + 1;

		const elements = Array.from({ length: nElements }, () => {
			const shouldRecurse = depth < maxDepth && Math.random() < 0.4;
			const shouldWrapWithFn = isOuterExpression || shouldRecurse || Math.random() < 0.33;
			const element = shouldRecurse ? generateElements(depth + 1)[0] : getRandomElement(VARIABLES);
			return shouldWrapWithFn
				? `${getRandomWeightedElement(functions)}(${element}${
						isOuterExpression
							? `, t ${getRandomElement(TIME_OPERATORS)} ${getRandomElement(VARIABLES)}`
							: ''
					})`
				: element;
		});

		const expression = elements.reduce(
			(acc, curr, i) => (i === 0 ? curr : `${acc} ${getRandomElement(operators)} ${curr}`),
			'',
		);
		const chainLength = elements.length;
		return [expression, chainLength];
	}

	const [expression, chainLength] = generateElements();

	// Since each element in the expression ranges [-1, 1], normalize output to [0, 1] like so:
	return `(${expression} + ${chainLength}.) / (${chainLength}. * 2.)`;
}

const distFormulas = [
	['result.x', 1],
	['length(result) / u_sqrt2', 1],
	['result.x * result.y', 1],
	['(result.x + result.y) / 2.', 1],
];

const MAX_FORMULA_HISTORY_LENGTH = 64;
const canvas = createFullscreenCanvas();

const N_COLOR_MODES = 6;
let colorMode = 0;
const N_GLITCH_MODES = 7;
let glitchMode = 0;
let shader;
let isPaused = false;
let formulaHistoryIndex = -1;

const formulaHistory = [];

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
function createRandomFormula() {
	const distFormula = getRandomWeightedElement(distFormulas);
	const { outer, inner, depth } = RANDOM_FACTORS[glitchMode ? 'glitched' : 'normal'];

	const xOut = generateRandomExpression(outer, inner, depth);
	const yOut = generateRandomExpression(outer, inner, depth);
	const tScale = `${Math.floor(Math.random() * 12) + 1}.`;
	const tHeadstart = `${Math.floor(Math.random() * 6)}.`;
	const hueHeadstart = `${Math.random() || '0.'}`;

	return { distFormula, hueHeadstart, tHeadstart, tScale, xOut, yOut };
}

let lastTime;
function updateShaderUniforms(time = lastTime) {
	shader.updateUniforms({ u_colorMode: colorMode, u_glitchMode: glitchMode });
	lastTime = time;
}

function togglePause() {
	isPaused = !isPaused;
	if (isPaused) {
		shader.pause();
	} else {
		shader.play(updateShaderUniforms);
	}
}

function drawIfPaused() {
	if (!isPaused) return;
	updateShaderUniforms();
	shader.draw();
}

function init(formula) {
	const { distFormula, hueHeadstart, tHeadstart, tScale, xOut, yOut } = formula;

	console.debug(`👁️‍🗨️ Creating a new shader
xOut: ${xOut}
yOut: ${yOut}
distFormula: ${distFormula}
tScale: ${tScale}
tHeadstart: ${tHeadstart}
hueHeadstart: ${hueHeadstart}
glitchMode: ${glitchMode}
colorMode: ${colorMode}
`);

	const fragmentShaderSrc = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 out_color;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_cursor;
uniform int u_colorMode;
uniform int u_glitchMode;
uniform float u_sqrt2;
uniform float u_tau;
uniform float u_pi;

// lch = (lightness, chromaticity, hue)
vec3 oklch2oklab(vec3 lch) {
  return vec3(lch.x, lch.y * cos(lch.z * u_tau), lch.y * sin(lch.z * u_tau));
}

// oklab = (lightness, red_greenness, blue_yelowness)
vec3 oklab2lrgb(vec3 oklab) {
    vec3 lms = oklab * mat3(1,  0.3963377774,  0.2158037573,
                            1, -0.1055613458, -0.0638541728,
                            1, -0.0894841775, -1.2914855480);
    lms *= lms * lms;
    return lms * mat3( 4.0767416621, -3.3077115913,  0.2309699292,
                      -1.2684380046,  2.6097574011, -0.3413193965,
                      -0.0041960863, -0.7034186147,  1.7076147010);
}

vec3 lrgb2oklab(vec3 lrgb) {
    vec3 lms = lrgb * mat3(0.4121656120, 0.5362752080, 0.0514575653,
                            0.2118591070, 0.6807189584, 0.1074065790,
                            0.0883097947, 0.2818474174, 0.6302613616);
    return pow(lms, vec3(1.0 / 3.0)) * mat3(0.2104542553,  0.7936177850, -0.0040720468,
                                            1.9779984951, -2.4285922050,  0.4505937099,
                                            0.0259040371,  0.7827717662, -0.8086757660);
}

vec3 lrgb2srgb(vec3 lrgb) { return  mix(12.92 * lrgb, 1.055 * pow(lrgb, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, lrgb)); }

vec3 oklch2srgb(vec3 lch) {
  vec3 ok = oklch2oklab(lch);
  vec3 lrgb = oklab2lrgb(ok);
  vec3 srgb = lrgb2srgb(lrgb);
  return clamp(srgb, vec3(0), vec3(1));
}

float sine(float period, float t) {
  return sin(t / period);
}

float tangent(float period, float t) {
  return tan(t / period);
}

float cosine(float period, float t) {
  return cos(t / period);
}

float square(float period, float t) {
  return step(0.0, sine(period, t)) * 2. - 1.;
}

float triangle(float period, float t) {
  float halfPeriod = period / 2.;
  return (abs(mod(t, period) - halfPeriod)) / halfPeriod * 2. - 1.;
}

vec2 fn(vec2 uv, float t) {
  float x = uv.x;
  float y = uv.y;
  float sx = sin(x);
  float sy = sin(y);
  float xx = x * x;
  float yy = y * y;

  float xOut = ${xOut};
  float yOut = ${yOut};

  return vec2(xOut, yOut);
}

#define round(x) floor((x) + 0.5)

vec2 checkerUv(vec2 uv, float maxDivisions) {
  float maxDimension = max(u_resolution.x, u_resolution.y);
  vec2 xy = uv * u_resolution;
  vec2 gridDimensions = round(maxDivisions * u_resolution / maxDimension);
  // If either grid dimension is 1 or less, don’t apply the grid.
  gridDimensions = mix(gridDimensions, vec2(1.), step(min(gridDimensions.x, gridDimensions.y), 1.));
  vec2 gridSpacingPx = round(u_resolution / gridDimensions);
  vec2 gridXy = floor(xy / gridSpacingPx);
  // Swap the position of grid cells where isEven(x) != isEven(y).
  float a = mod(gridXy.x, 2.0);
  float b = mod(gridXy.y, 2.0);
  vec2 gridXyOffset = vec2(a - b, b - a) * gridSpacingPx;
  vec2 checkeredUv = (gridXyOffset + xy) / u_resolution;
  return mod(checkeredUv, 1.);
}

vec2 kaleidoscopeUv(vec2 uv, float numSides) {
  uv = uv * 2. - 1.;
  float angle = atan(uv.y, uv.x);
  float sectorAngle = u_tau / numSides;
  float theta = mod(angle + sectorAngle / 2., sectorAngle) - sectorAngle / 2.;
  float radius = length(uv);
  // return (1. + vec2(cos(theta), sin(theta)) * radius) / 2.;
  // HACK: Instead of returning cartesian coordinates (commented out above),
  // this returns polar coordinates and renders them as though they were
  // cartesian. This doesn’t make any sense, but it looks cooler than doing it
  // the “right way”.
  float warpedRadius = pow(radius, 4.) * sectorAngle;
  return vec2(theta, warpedRadius);
}

// Source: https://www.shadertoy.com/view/XdVcRW
#define SQ3 1.7320508076
mat2 rot2d(float a) { return mat2(cos(a),-sin(a),sin(a),cos(a)); }
vec2 p6mmmap(vec2 uv, float repeats) {
  // clamp to a repeating box width 6x height 2x*sqrt(3)
  uv.x /= SQ3;
  uv = fract(uv * repeats - 0.5) - 0.5;
  uv.x *= SQ3;
  uv = abs(uv);
  vec2 st = uv;

  vec2 uv330 = rot2d(radians(330.)) * uv;
  if (uv330.x < 0.0){
    st.y = (st.y - 0.5) * -1.0;
    st.x *= SQ3;
    return st * 2.0;
  } else if (uv330.x > 0.5){
    st.x = (st.x - 0.5 * SQ3) * -1.0 * SQ3;
    return st * 2.0;
  }

  vec2 uv30 = rot2d(radians(30.)) * uv;
  if (uv30.y < 0.0 && uv30.x >= 0.5) st = vec2(1.0,1.0);
  else if (uv30.y >= 0.0 && uv30.x >= 0.5) st = vec2(-1.0,1.0);
  else if (uv30.y < 0.0 && uv30.x < 0.5) st = vec2(1.0,-1.0);
  else st = vec2(-1.0,-1.0);

  uv30.x = uv30.x - 0.5;
  uv = rot2d(radians(270.)) * uv30;
  st = uv * st;
  st.x *= SQ3;
  return st * 2.0;
}

void main() {
  // Infer settings from the cursor position.
  float zoomLevel = 2.0 + u_cursor.x * 16.;
  float maxGridDivisions = 1. + floor(u_cursor.y * max(u_resolution.x, u_resolution.y) / 20.);
  float numKaleidoscopeSides = 1. + round(u_cursor.x * 7.);
  float numP6mmRepeats = 1. + round(u_cursor.x * 5.);

  float isCheckered = float(u_glitchMode == 1 || u_glitchMode == 4 || u_glitchMode == 5 || u_glitchMode == 6);
  float isKaleidoscope = float(u_glitchMode == 2 || u_glitchMode == 4 || u_glitchMode == 6);
  float isP6mm = float(u_glitchMode == 3 || u_glitchMode == 5 || u_glitchMode == 6);

  // Apply uv transformations.
  vec2 uv = v_uv;
  uv = mix(uv, checkerUv(uv, maxGridDivisions), isCheckered);
  uv = mix(uv, kaleidoscopeUv(uv, numKaleidoscopeSides), isKaleidoscope);
  uv = mix(uv, p6mmmap(uv, numP6mmRepeats), isP6mm);
  uv = (uv - .5) * zoomLevel; // Zoom and center the uv at 0.
  uv.y *= u_resolution.y / u_resolution.x; // Prevent distortion and stretching due to the aspect ratio.

  float t = sin(u_time / ${tScale}) * ${tScale} + ${tHeadstart};
  vec2 result = fn(uv, t);
  float dist = ${distFormula};

  float L = .1 + dist * .9;
  L *= L; // Bias towards darker colors.
  float C = (sin(dist * u_tau + t / 4.) + 1.) / 3.; // 66% of a colour’s chroma comes from a lightness band that changes over time.
  C += .33 * (1. - L); // Give darker colors a chroma boost.
  float H = (cos(dist * t) + 1.) / 3. + u_time / 300. + ${hueHeadstart}; // Hue is a limited colour band that rotates over time.
  if (u_colorMode == 0) {
    // Already set.
  } else if (u_colorMode == 1) {
    C = 0.;
  } else if (u_colorMode == 2) {
    float blend = (1. + sin(u_time / 3.)) / 2.;
    C = mix(C, L, blend);
    H = mix(H, L, blend);
  } else if (u_colorMode == 3) {
    // Override with OG values.
    L = 0.5 - 0.5 * sin((dist) * t);
    C = sin(t * (L - 1.5));
    H = cos(dist * t) + u_time / 30.;
  } else if (u_colorMode == 4) {
    // OG B/W.
    L = 0.5 + 0.5 * sin(sqrt(dist) * t);
    C = 0.;
  } else if (u_colorMode == 5) {
    L = result.x + result.y;
	C = result.x - result.y;
	H = dist;
  }

  L = clamp(L, 0., 1.);
  out_color = vec4(oklch2srgb(vec3(L, C, H)), 1.);
}`;

	shader?.destroy();
	shader = new ShaderPad(fragmentShaderSrc, { canvas, plugins: [autosize()] });

	shader.initializeUniform('u_sqrt2', 'float', Math.sqrt(2), { allowMissing: true });
	shader.initializeUniform('u_tau', 'float', Math.PI * 2, { allowMissing: true });
	shader.initializeUniform('u_pi', 'float', Math.PI, { allowMissing: true });
	shader.initializeUniform('u_colorMode', 'int', colorMode);
	shader.initializeUniform('u_glitchMode', 'int', glitchMode);

	shader.on('autosize:resize', drawIfPaused);

	if (isPaused) {
		drawIfPaused();
	} else {
		shader.play(updateShaderUniforms);
	}
}

function showNewFormula() {
	formulaHistory.splice(formulaHistoryIndex + 1);
	formulaHistory.push(createRandomFormula());
	formulaHistory.splice(0, Math.max(0, formulaHistory.length - MAX_FORMULA_HISTORY_LENGTH));
	formulaHistoryIndex = formulaHistory.length - 1;
	init(formulaHistory[formulaHistoryIndex]);
}

function showPreviousFormula() {
	if (formulaHistoryIndex <= 0) return;

	formulaHistoryIndex -= 1;
	init(formulaHistory[formulaHistoryIndex]);
}

function showNextFormula() {
	if (formulaHistoryIndex >= formulaHistory.length - 1) return;

	formulaHistoryIndex += 1;
	init(formulaHistory[formulaHistoryIndex]);
}

window.addEventListener('keydown', event => {
	if (event.altKey || event.ctrlKey || event.metaKey) return;

	switch (event.code) {
		case 'KeyC':
			colorMode = (colorMode + N_COLOR_MODES + (event.shiftKey ? -1 : 1)) % N_COLOR_MODES;
			drawIfPaused();
			break;
		case 'KeyF':
			if (document.fullscreenElement) {
				document.exitFullscreen();
			} else {
				canvas.requestFullscreen();
			}
			break;
		case 'KeyG':
			glitchMode = (glitchMode + 1) % N_GLITCH_MODES;
			drawIfPaused();
			break;
		case 'KeyR':
			if (event.shiftKey) {
				showPreviousFormula();
			} else {
				showNewFormula();
			}
			break;
		case 'ArrowLeft':
			showPreviousFormula();
			break;
		case 'ArrowRight':
			showNextFormula();
			break;
		case 'ArrowUp':
			showNewFormula();
			break;
		case 'KeyS':
			save(shader, 'harmonics', 'https://rileyjshaw.com/harmonics');
			break;
		case 'Space':
			if (!event.repeat) togglePause();
			break;
		default:
			return;
	}

	event.preventDefault();
});

showNewFormula();
