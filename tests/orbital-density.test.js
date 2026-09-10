import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// The orbital implementation is intentionally inline in the static site.  Load
// the relevant declarations from the source file so these tests exercise the
// shipped kernel rather than maintaining a second implementation in tests.
const source = fs.readFileSync(new URL('../src/msc-lab.html', import.meta.url), 'utf8');
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));

const elementCode = between('const RAW=', '/* --- cấu hình electron --- */');
const configCode = between('const ORDER=', '/* --- bảng tuần hoàn --- */');
const waveCode = between('function binom(', 'const FPCV=');
const fieldCode = between('const fingerprintFieldCache=', 'function renderOrbitalFingerprint');

const paletteCode = `
const PAL={dark:{orbBg:[3,3,7],orbViolet:[94,57,190],orbMagenta:[210,53,184],orbRed:[240,63,78],orbOrange:[255,143,57],orbWhite:[255,246,233],orbPhaseNeg:[111,54,191]},light:{orbBg:[3,3,7],orbViolet:[94,57,190],orbMagenta:[210,53,184],orbRed:[240,63,78],orbOrange:[255,143,57],orbWhite:[255,246,233],orbPhaseNeg:[111,54,191]}};
let THEME='dark';
const P_=()=>PAL[THEME];
function pal(name,a){const c=P_()[name];return 'rgba('+c[0]+','+c[1]+','+c[2]+','+(a===undefined?1:a)+')';}
`;

const context = {};
vm.runInNewContext(`${elementCode}\n${configCode}\n${paletteCode}\n${waveCode}\n${fieldCode}
globalThis.__orbital={ELEMENTS,configOf,orbitalFingerprintSpec,differentiatingSubshell,Rnl,angular,hydrogenicPsiAt,sampleFingerprintField,fingerprintColor,fingerprintGradient,fingerprintFieldCache};`, context, { filename: 'src/msc-lab.html#orbital-kernel' });
const orbital = context.__orbital;

const sumOccupation = (configuration) => configuration.reduce((sum, orbitalEntry) => sum + orbitalEntry.e, 0);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const rgb = (value) => {
  const match = value.match(/rgba?\((\d+),(\d+),(\d+)/);
  assert.ok(match, `not an RGB color: ${value}`);
  return match.slice(1, 4).map(Number);
};

test('every element Z=1..118 has a conserving electron configuration and valid fingerprint metadata', () => {
  assert.equal(orbital.ELEMENTS.length, 118);
  for (let z = 1; z <= 118; z += 1) {
    const config = orbital.configOf(z);
    const spec = orbital.orbitalFingerprintSpec(z);
    assert.equal(sumOccupation(config), z, `occupation sum failed for Z=${z}`);
    assert.equal(spec.z, z);
    assert.equal(spec.symbol, orbital.ELEMENTS[z - 1].sym);
    assert.match(spec.orb, /^[1-7][spdf]$/);
    assert.ok(Number.isInteger(spec.n) && spec.n >= 1 && spec.n <= 7);
    assert.ok(Number.isInteger(spec.l) && spec.l >= 0 && spec.l <= 3);
    assert.equal(spec.m, 0);
    assert.ok(spec.delta > 0, `missing differentiating electron for Z=${z}`);
    assert.ok(spec.subshell.occupancy >= 1 && spec.subshell.occupancy <= spec.subshell.capacity);
    assert.deepEqual(Array.from(spec.coordinates.planes), ['xz', 'xy', 'yz']);
    assert.equal(spec.model.family, 'hydrogenic');
  }
});

test('representative elements map to the expected differentiating subshell and component', () => {
  const expected = {
    H: ['1s', 's'], C: ['2p', 'p_z'], Cr: ['3d', 'd_z²'], Fe: ['3d', 'd_z²'],
    Cu: ['3d', 'd_z²'], Ce: ['4f', 'f_z³'], U: ['5f', 'f_z³'], Og: ['7p', 'p_z'],
  };
  for (const [symbol, [orb, component]] of Object.entries(expected)) {
    const element = orbital.ELEMENTS.find((candidate) => candidate.sym === symbol);
    const spec = orbital.orbitalFingerprintSpec(element.z);
    assert.equal(spec.orb, orb, `${symbol} subshell`);
    assert.equal(spec.component, component, `${symbol} representative`);
  }
});

test('wavefunction and density are finite, with the expected 2s, p_z, and d_z² nodes', () => {
  const points = [[0, 0, 0], [0.3, -0.7, 1.2], [-3.1, 2.4, 0.6], [8, 0, -4]];
  for (const [x, y, z] of points) {
    for (const [n, l] of [[1, 0], [2, 0], [2, 1], [3, 2], [4, 3]]) {
      const psi = orbital.hydrogenicPsiAt(n, l, x, y, z);
      assert.ok(finite(psi), `non-finite psi for n=${n}, l=${l}`);
      assert.ok(finite(psi * psi) && psi * psi >= 0);
    }
  }
  assert.ok(Math.abs(orbital.Rnl(2, 0, 2)) < 1e-12, '2s radial node at 2a₀');
  assert.ok(Math.abs(orbital.hydrogenicPsiAt(2, 1, 1, 0, 0)) < 1e-12, 'p_z nodal plane z=0');
  const cone = orbital.hydrogenicPsiAt(3, 2, Math.sqrt(2), 0, 1);
  assert.ok(Math.abs(cone) < 1e-12, 'd_z² nodal cone 3cos²(theta)-1=0');
  assert.notEqual(orbital.hydrogenicPsiAt(2, 1, 0, 0, 1), 0, 'p_z is non-zero on its axis');
});

test('field sampling is deterministic and returns the same cached field object', () => {
  const first = orbital.sampleFingerprintField(3, 2, 'xz', 'density');
  const second = orbital.sampleFingerprintField(3, 2, 'xz', 'density');
  assert.strictEqual(first, second);
  assert.equal(orbital.fingerprintFieldCache.get('3|2|xz|density'), first);
  assert.equal(first.values.length, first.w * first.h);
  assert.ok(first.max > 0 && first.extent > 0);
  assert.ok(Array.from(first.values).every((value) => finite(value) && value >= 0));
  const phase = orbital.sampleFingerprintField(3, 2, 'xz', 'phase');
  assert.notStrictEqual(phase, first);
  assert.ok(Array.from(phase.values).some((value) => value < 0));
  assert.ok(Array.from(phase.values).every(finite));
});

test('density and phase colormaps have stable endpoints and useful luminance separation', () => {
  const densityLow = orbital.fingerprintColor('density', 0);
  const densityHigh = Array.from(orbital.fingerprintColor('density', 1));
  const phaseZero = Array.from(orbital.fingerprintColor('phase', 0));
  const phaseNegative = Array.from(orbital.fingerprintColor('phase', -1));
  const phasePositive = Array.from(orbital.fingerprintColor('phase', 1));
  assert.deepEqual(Array.from(densityLow), [3, 3, 7]);
  assert.deepEqual(phaseZero, [3, 3, 7]);
  assert.deepEqual(densityHigh, [255, 246, 233]);
  assert.deepEqual(phaseNegative, [210, 53, 184]);
  assert.deepEqual(phasePositive, [255, 246, 233]);
  assert.ok(luminance(densityHigh) > luminance(densityLow));
  assert.ok(luminance(phaseNegative) !== luminance(phasePositive));
  assert.match(orbital.fingerprintGradient('density'), /linear-gradient/);
  assert.match(orbital.fingerprintGradient('phase'), /linear-gradient/);
});
