import ShaderPad from 'shaderpad';

const canvas = document.getElementById('canvas');

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

function generateRandomExpression(maxOuterElements, maxInnerElements, maxDepth) {
	const outerFunctions = [
		['sine', 8],
		['cosine', 4],
		['triangle', 4],
		['square', 1],
	];
	const outerOperators = ['+', '-'];
	const innerFunctions = [
		['sin', 1],
		['cos', 1],
		['tan', 1], // Higher = greater "glass block" occurrence.
	];
	const innerOperators = ['+', '-', '*'];
	const variables = ['t', 'x', 'y', 'sx', 'sy', 'xx', 'yy', '.5', '2.', 'uTau', 'uPi', 'uSqrt2'];
	const timeOperators = ['+', '*'];

	function generateElements(depth = 0) {
		const isOuterExpression = depth === 0;
		const [maxElements, operators, functions] = isOuterExpression
			? [maxOuterElements, outerOperators, outerFunctions]
			: [maxInnerElements, innerOperators, innerFunctions];
		const nElements = Math.floor(Math.random() * maxElements) + 1;

		const elements = Array.from({ length: nElements }, () => {
			const shouldRecurse = depth < maxDepth && Math.random() < 0.4;
			const shouldWrapWithFn = isOuterExpression || shouldRecurse || Math.random() < 0.33;
			const element = shouldRecurse ? generateElements(depth + 1)[0] : getRandomElement(variables);
			return shouldWrapWithFn
				? `${getRandomWeightedElement(functions)}(${element}${
						isOuterExpression ? `, t ${getRandomElement(timeOperators)} ${getRandomElement(variables)}` : ''
				  })`
				: element;
		});

		const expression = elements.reduce(
			(acc, curr, i) => (i === 0 ? curr : `${acc} ${getRandomElement(operators)} ${curr}`),
			''
		);
		const chainLength = elements.length;
		return [expression, chainLength];
	}

	const [expression, chainLength] = generateElements();
	// Since each element in the expression ranges [-1, 1], we can normalize it to [0, 1] like so:
	return `(${expression} + ${chainLength}.) / (${chainLength}. * 2.)`;
}

const distFormulas = [
	['result.x', 1],
	['length(result) / uSqrt2', 1],
	['result.x * result.y', 1],
	['(result.x + result.y) / 2.', 1],
];

let colorMode = 1;
let glitchMode = false;
let shader;

const randomFactors = {
	normal: {
		outer: 6,
		inner: 12,
		depth: 4,
	},
	glitched: {
		outer: 4,
		inner: 2,
		depth: 4,
	},
};

function init() {
	const distFormula = getRandomWeightedElement(distFormulas);
	const { outer, inner, depth } = randomFactors[glitchMode ? 'glitched' : 'normal'];

	const xOut = generateRandomExpression(
		1 + Math.floor(Math.random() * outer),
		1 + Math.floor(Math.random() * inner),
		depth
	);
	const yOut = generateRandomExpression(
		1 + Math.floor(Math.random() * outer),
		1 + Math.floor(Math.random() * inner),
		depth
	);

	const tScale = `${Math.floor(Math.random() * 12) + 1}.`;
	const tHeadstart = `${Math.floor(Math.random() * 6)}.`;
	const hueHeadstart = `${Math.random() || '0.'}`;

	const fragmentShaderSrc = `
precision highp float;
uniform float uTime;
uniform vec2 uResolution;
uniform vec2 uCursor;
uniform float uIsColorOn;
uniform int uGlitchMode;
uniform float uSqrt2;
uniform float uTau;
uniform float uPi;
varying vec2 vUv;

// lch = (lightness, chromaticity, hue)
vec3 oklch2oklab(vec3 lch) {
  return vec3(lch.x, lch.y * cos(lch.z * uTau), lch.y * sin(lch.z * uTau));
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
  float maxDimension = max(uResolution.x, uResolution.y);
  vec2 xy = uv * uResolution;
  vec2 gridDimensions = round(maxDivisions * uResolution / maxDimension);
  // If either grid dimension is 1 or less, don’t apply the grid.
  gridDimensions = mix(gridDimensions, vec2(1.), step(min(gridDimensions.x, gridDimensions.y), 1.));
  vec2 gridSpacingPx = round(uResolution / gridDimensions);
  vec2 gridXy = floor(xy / gridSpacingPx);
  // Swap the position of grid cells where isEven(x) != isEven(y).
  float a = mod(gridXy.x, 2.0);
  float b = mod(gridXy.y, 2.0);
  vec2 gridXyOffset = vec2(a - b, b - a) * gridSpacingPx;
  vec2 checkeredUv = (gridXyOffset + xy) / uResolution;
  return mod(checkeredUv, 1.);
}

vec2 kaleidoscopeUv(vec2 uv, float numSides) {
  uv = uv * 2. - 1.;
  float angle = atan(uv.y, uv.x);
  float sectorAngle = uTau / numSides;
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

void main() {
  // Infer settings from the cursor position.
  float zoomLevel = 2.0 + uCursor.x * 16.;
  float numKaleidoscopeSides = 1. + round(uCursor.x * 7.);
  float maxGridDivisions = 1. + floor(uCursor.y * max(uResolution.x, uResolution.y) / 20.);

  // Apply uv transformations.
  vec2 uv = vUv;
  uv = mix(uv, checkerUv(uv, maxGridDivisions), float(uGlitchMode));
  uv = mix(uv, kaleidoscopeUv(uv, numKaleidoscopeSides), float(uGlitchMode));
  uv = (uv - .5) * zoomLevel; // Zoom and center the uv at 0.
  uv.y *= uResolution.y / uResolution.x; // Prevent distortion and stretching due to the aspect ratio.

  float t = sin(uTime / ${tScale}) * ${tScale} + ${tHeadstart};
  vec2 result = fn(uv, t);
  float dist = ${distFormula};
  // OG values.
  // float L = 0.5 - 0.5 * sin((dist) * t);
  // float C = sin(t * (L - 1.5));
  // float H = cos(dist * t) + uTime / 30.;
  // float K = 0.5 + 0.5 * sin(sqrt(dist) * t);
  float L = .1 + dist * .9;
  L *= L; // Bias towards darker colors.
  float C = (sin(dist * uTau + t / 4.) + 1.) / 3.; // 66% of a colour’s chroma comes from a lightness band that changes over time.
  C += .33 * (1. - L); // Give darker colors a chroma boost.
  float H = (cos(dist * t) + 1.) / 3. + uTime / 300. + ${hueHeadstart}; // Hue is a limited colour band that rotates over time.

  vec3 bw = clamp(vec3(L), vec3(0), vec3(1));
  vec3 color = oklch2srgb(vec3(L, C, H));

  vec3 mixed = mix(bw, color, uIsColorOn);
  gl_FragColor = vec4(mixed, 1.0);
}`;

	shader?.destroy();
	shader = new ShaderPad(fragmentShaderSrc, canvas);

	shader.initializeUniform('uSqrt2', 'float', Math.sqrt(2));
	shader.initializeUniform('uTau', 'float', Math.PI * 2);
	shader.initializeUniform('uPi', 'float', Math.PI);
	shader.initializeUniform('uIsColorOn', 'float', 1);
	shader.initializeUniform('uGlitchMode', 'int', glitchMode);

	shader.play(time => {
		let colorValue = colorMode === 0 ? 0 : colorMode === 1 ? 1 : (1 + Math.sin(time / 3)) / 2;
		shader.updateUniforms({ uIsColorOn: colorValue, uGlitchMode: glitchMode ? 1 : 0 });
	});
}

window.addEventListener('keydown', event => {
	if (event.code === 'KeyF') {
		canvas.requestFullscreen();
	} else if (event.code === 'KeyG') {
		glitchMode = !glitchMode;
	} else if (event.code === 'KeyR') {
		init();
	} else if (event.code === 'KeyS') {
		if (shader) {
			shader.save();
		}
	} else if (event.code === 'Space') {
		colorMode = (colorMode + 1) % 3;
	}
});

init();
