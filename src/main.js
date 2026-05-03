import ShaderPad from 'shaderpad';
import { createFullscreenCanvas, save } from 'shaderpad/util';
import autosize from 'shaderpad/plugins/autosize';
import {
	DIST_FORMULAS,
	N_COLOR_MODES,
	N_GLITCH_MODES,
	createCustomFormula,
	createRandomFormula,
	decodeCode,
	encodeState,
	extractCodeFromFilename,
} from './share-state.js';
import { FORMULA_EDITOR_ROWS, formatFormulaEditorLine, normalizeFormulaEditorValue } from './formula-editor.js';

const MAX_FORMULA_HISTORY_LENGTH = 64;
const canvas = createFullscreenCanvas();

let colorMode = 0;
let glitchMode = 0;
let shader;
let isPaused = false;
let formulaHistoryIndex = -1;
let currentFormula;
let formulaEditor;

const formulaHistory = [];

let lastTime = 0;
function updateShaderUniforms(time = lastTime) {
	if (!shader) return;
	shader.updateUniforms({ u_colorMode: colorMode, u_glitchMode: glitchMode });
	lastTime = time;
}

function togglePause() {
	if (!shader) return;
	isPaused = !isPaused;
	if (isPaused) {
		shader.pause();
	} else {
		shader.play(updateShaderUniforms);
	}
}

function drawIfPaused() {
	if (!isPaused || !shader) return;
	updateShaderUniforms();
	shader.draw();
}

function getCurrentCode() {
	if (!currentFormula) return null;
	try {
		return encodeState({ colorMode, glitchMode, formula: currentFormula });
	} catch (error) {
		console.warn('Could not encode Harmonics state.', error);
		return null;
	}
}

function getShareUrl(code = getCurrentCode()) {
	const url = new URL(window.location.href);
	url.hash = code ?? '';
	return url.href;
}

function replaceHashFromCurrentState() {
	if (!currentFormula) return;
	const code = getCurrentCode();
	const url = new URL(window.location.href);
	url.hash = code ?? '';
	if (url.href !== window.location.href) {
		window.history.replaceState(window.history.state, '', url.href);
	}
}

function pushFormulaHistory(formula) {
	formulaHistory.splice(formulaHistoryIndex + 1);
	formulaHistory.push(formula);
	formulaHistory.splice(0, Math.max(0, formulaHistory.length - MAX_FORMULA_HISTORY_LENGTH));
	formulaHistoryIndex = formulaHistory.length - 1;
}

function showState({ colorMode: nextColorMode, glitchMode: nextGlitchMode, formula }, { updateHash = true } = {}) {
	const previousColorMode = colorMode;
	const previousGlitchMode = glitchMode;
	colorMode = nextColorMode;
	glitchMode = nextGlitchMode;
	const result = renderFormula(formula);
	if (!result.ok) {
		colorMode = previousColorMode;
		glitchMode = previousGlitchMode;
		updateShaderUniforms();
		return false;
	}
	pushFormulaHistory(formula);
	if (updateHash) replaceHashFromCurrentState();
	return true;
}

function warnInvalidCode(code, source) {
	console.warn(`Could not load Harmonics state from ${source}:`, code);
}

function getFragmentShaderSrc(formula) {
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
	return fragmentShaderSrc;
}

function createInitializedShader(fragmentShaderSrc) {
	const nextShader = new ShaderPad(fragmentShaderSrc, { canvas, plugins: [autosize()] });

	try {
		nextShader.initializeUniform('u_sqrt2', 'float', Math.sqrt(2), { allowMissing: true });
		nextShader.initializeUniform('u_tau', 'float', Math.PI * 2, { allowMissing: true });
		nextShader.initializeUniform('u_pi', 'float', Math.PI, { allowMissing: true });
		nextShader.initializeUniform('u_colorMode', 'int', colorMode);
		nextShader.initializeUniform('u_glitchMode', 'int', glitchMode);
		nextShader.updateUniforms({ u_time: lastTime });

		nextShader.on('autosize:resize', drawIfPaused);
		nextShader.on('updateUniforms', updates => {
			if (Object.hasOwn(updates, 'u_cursor')) drawIfPaused();
		});
	} catch (error) {
		nextShader.destroy();
		throw error;
	}

	return nextShader;
}

function renderFormula(formula) {
	let nextShader;
	try {
		nextShader = createInitializedShader(getFragmentShaderSrc(formula));
	} catch (error) {
		console.warn('Could not render Harmonics formula. Keeping the previous shader.', error);
		return { ok: false, error };
	}

	const previousShader = shader;
	previousShader?.destroy();
	shader = nextShader;
	currentFormula = formula;
	if (isPaused) {
		drawIfPaused();
	} else {
		shader.play(updateShaderUniforms);
	}

	return { ok: true };
}

function showNewFormula() {
	const formula = createRandomFormula(glitchMode);
	const result = renderFormula(formula);
	if (!result.ok) return false;

	pushFormulaHistory(formula);
	replaceHashFromCurrentState();
	return true;
}

function showPreviousFormula() {
	if (formulaHistoryIndex <= 0) return;

	const previousIndex = formulaHistoryIndex;
	formulaHistoryIndex -= 1;
	const result = renderFormula(formulaHistory[formulaHistoryIndex]);
	if (!result.ok) {
		formulaHistoryIndex = previousIndex;
		return false;
	}

	replaceHashFromCurrentState();
	return true;
}

function showNextFormula() {
	if (formulaHistoryIndex >= formulaHistory.length - 1) return;

	const previousIndex = formulaHistoryIndex;
	formulaHistoryIndex += 1;
	const result = renderFormula(formulaHistory[formulaHistoryIndex]);
	if (!result.ok) {
		formulaHistoryIndex = previousIndex;
		return false;
	}

	replaceHashFromCurrentState();
	return true;
}

function getDistFormulaIndex(formula) {
	if (
		Number.isInteger(formula?.distFormulaIndex) &&
		formula.distFormulaIndex >= 0 &&
		formula.distFormulaIndex < DIST_FORMULAS.length
	) {
		return formula.distFormulaIndex;
	}

	const index = DIST_FORMULAS.findIndex(([distFormula]) => distFormula === formula?.distFormula);
	return index === -1 ? 0 : index;
}

function createFormulaEditorShell() {
	const shell = document.createElement('span');
	shell.className = 'formula-editor__shell';
	return shell;
}

function createFormulaEditorRow(label, { editable = false } = {}) {
	const row = document.createElement('div');
	row.className = 'formula-editor__row';

	const shell = editable ? createFormulaEditorShell() : document.createElement('button');
	if (!editable) {
		shell.type = 'button';
		shell.className = 'formula-editor__shell formula-editor__distance';
	}

	const value = document.createElement('span');
	value.className = 'formula-editor__value';
	if (editable) {
		value.setAttribute('contenteditable', 'plaintext-only');
		value.spellcheck = false;
		value.autocapitalize = 'off';
	}

	shell.append(`${label}: `, value);
	row.append(shell);
	return { row, shell, value };
}

function createFormulaEditor() {
	const root = document.createElement('div');
	root.hidden = true;
	root.className = 'formula-editor';
	root.setAttribute('aria-label', 'Formula editor');

	const rows = Object.fromEntries(
		FORMULA_EDITOR_ROWS.map(([label, key]) => {
			const row = createFormulaEditorRow(label, { editable: key !== 'distFormula' });
			root.append(row.row);
			return [key, row];
		}),
	);

	rows.xOut.value.addEventListener('input', applyFormulaEditorDraft);
	rows.yOut.value.addEventListener('input', applyFormulaEditorDraft);
	rows.distFormula.shell.addEventListener('mousedown', event => {
		event.preventDefault();
	});
	rows.distFormula.shell.addEventListener('click', event => {
		event.preventDefault();
		cycleFormulaEditorDistance();
	});

	root.addEventListener('keydown', event => {
		if (event.key === 'Enter' || event.key === 'Escape') {
			event.preventDefault();
			closeFormulaEditor();
		}
	});
	root.addEventListener('focusout', event => {
		if (event.relatedTarget && root.contains(event.relatedTarget)) return;
		requestAnimationFrame(() => {
			if (!root.hidden && !root.contains(document.activeElement)) closeFormulaEditor();
		});
	});
	document.addEventListener('pointerdown', event => {
		if (!root.hidden && !root.contains(event.target)) closeFormulaEditor();
	});

	document.body.append(root);
	return {
		root,
		rows,
		draftFormula: null,
		distFormulaIndex: 0,
	};
}

function getFormulaEditor() {
	formulaEditor ??= createFormulaEditor();
	return formulaEditor;
}

function isFormulaEditorFocused() {
	return Boolean(formulaEditor && !formulaEditor.root.hidden && formulaEditor.root.contains(document.activeElement));
}

function getFormulaEditorValue(key) {
	return normalizeFormulaEditorValue(getFormulaEditor().rows[key].value.textContent ?? '');
}

function setFormulaEditorSyntaxError(hasSyntaxError) {
	if (!formulaEditor) return;
	formulaEditor.root.classList.toggle('formula-editor--syntax-error', hasSyntaxError);
}

function setFormulaEditorDistance(index) {
	const editor = getFormulaEditor();
	editor.distFormulaIndex = index;
	editor.rows.distFormula.value.textContent = DIST_FORMULAS[index][0];
	editor.rows.distFormula.shell.setAttribute('aria-label', formatFormulaEditorLine('D', DIST_FORMULAS[index][0]));
}

function syncCurrentFormulaHistory() {
	if (formulaHistoryIndex < 0) {
		pushFormulaHistory(currentFormula);
		return;
	}

	formulaHistory[formulaHistoryIndex] = currentFormula;
}

function selectFormulaEditorValue(element) {
	const selection = window.getSelection();
	if (!selection) return;

	const range = document.createRange();
	range.selectNodeContents(element);
	selection.removeAllRanges();
	selection.addRange(range);
}

function openFormulaEditor() {
	if (!currentFormula) return;

	const editor = getFormulaEditor();
	editor.draftFormula = { ...currentFormula };
	editor.rows.xOut.value.textContent = currentFormula.xExpression ?? currentFormula.xOut;
	editor.rows.yOut.value.textContent = currentFormula.yExpression ?? currentFormula.yOut;
	setFormulaEditorDistance(getDistFormulaIndex(currentFormula));
	setFormulaEditorSyntaxError(false);
	document.body.classList.add('formula-editor-open');
	editor.root.hidden = false;
	requestAnimationFrame(() => {
		editor.rows.xOut.value.focus();
		selectFormulaEditorValue(editor.rows.xOut.value);
	});
}

function closeFormulaEditor() {
	if (!formulaEditor) return;
	formulaEditor.root.hidden = true;
	document.body.classList.remove('formula-editor-open');
	if (formulaEditor.root.contains(document.activeElement)) document.activeElement.blur();
}

function getFormulaEditorDraft() {
	const editor = getFormulaEditor();
	const xOut = getFormulaEditorValue('xOut');
	const yOut = getFormulaEditorValue('yOut');
	if (!xOut || !yOut) return null;

	return createCustomFormula({
		...editor.draftFormula,
		distFormulaIndex: editor.distFormulaIndex,
		xExpression: xOut,
		yExpression: yOut,
		xNormalizationValue: editor.draftFormula.xNormalizationValue ?? 1,
		yNormalizationValue: editor.draftFormula.yNormalizationValue ?? 1,
	});
}

function applyFormulaEditorDraft() {
	const editor = getFormulaEditor();
	const formula = getFormulaEditorDraft();
	if (!formula) {
		setFormulaEditorSyntaxError(true);
		return false;
	}

	const result = renderFormula(formula);
	if (!result.ok) {
		setFormulaEditorSyntaxError(true);
		return false;
	}

	editor.draftFormula = formula;
	setFormulaEditorSyntaxError(false);
	syncCurrentFormulaHistory();
	replaceHashFromCurrentState();
	return true;
}

function cycleFormulaEditorDistance() {
	const editor = getFormulaEditor();
	setFormulaEditorDistance((editor.distFormulaIndex + 1) % DIST_FORMULAS.length);
	applyFormulaEditorDraft();
}

window.addEventListener('keydown', event => {
	if (isFormulaEditorFocused()) return;
	if (event.altKey || event.ctrlKey || event.metaKey) return;

	switch (event.code) {
		case 'KeyC':
			colorMode = (colorMode + N_COLOR_MODES + (event.shiftKey ? -1 : 1)) % N_COLOR_MODES;
			updateShaderUniforms();
			drawIfPaused();
			replaceHashFromCurrentState();
			break;
		case 'KeyF':
			if (document.fullscreenElement) {
				document.exitFullscreen();
			} else {
				document.documentElement.requestFullscreen();
			}
			break;
		case 'KeyE':
			if (!event.repeat) openFormulaEditor();
			break;
		case 'KeyG':
			glitchMode = (glitchMode + N_GLITCH_MODES + (event.shiftKey ? -1 : 1)) % N_GLITCH_MODES;
			updateShaderUniforms();
			drawIfPaused();
			replaceHashFromCurrentState();
			break;
		case 'KeyQ':
			colorMode = glitchMode = 0;
			updateShaderUniforms();
			drawIfPaused();
			replaceHashFromCurrentState();
			break;
		case 'KeyR':
			if (event.shiftKey) {
				showPreviousFormula();
			} else {
				showNewFormula();
			}
			break;
		case 'KeyS':
			{
				const code = getCurrentCode();
				save(shader, code ? `harmonics-${code}` : 'harmonics-custom', getShareUrl(code));
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
		case 'Space':
			if (!event.repeat) togglePause();
			break;
		default:
			return;
	}

	event.preventDefault();
});

window.addEventListener('hashchange', () => {
	const code = window.location.hash.slice(1);
	if (!code) return;

	const state = decodeCode(code);
	if (!state) {
		warnInvalidCode(code, 'hash');
		return;
	}

	showState(state, { updateHash: false });
});

window.addEventListener('dragover', event => {
	event.preventDefault();
	if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
});

window.addEventListener('drop', event => {
	event.preventDefault();

	const files = [...(event.dataTransfer?.files ?? [])];
	const code = files.map(file => extractCodeFromFilename(file.name)).find(Boolean);
	if (!code) return;

	const state = decodeCode(code);
	if (!state) {
		warnInvalidCode(code, 'filename');
		return;
	}

	showState(state);
});

const initialCode = window.location.hash.slice(1);
if (initialCode) {
	const state = decodeCode(initialCode);
	if (state) {
		showState(state, { updateHash: false });
	} else {
		warnInvalidCode(initialCode, 'initial hash');
		showNewFormula();
	}
} else {
	showNewFormula();
}
