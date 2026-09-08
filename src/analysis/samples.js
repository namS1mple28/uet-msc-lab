import { makeDataset } from './model.js';

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function gaussian(x, center, width, height) {
  const z = (x - center) / width;
  return height * Math.exp(-0.5 * z * z);
}

function xrdSample() {
  const random = rng(0x6405_2024);
  const x = [];
  const y = [];
  const centers = [28.44, 47.30, 56.12, 69.13, 76.37];
  const heights = [100, 64, 37, 10, 14];
  for (let i = 0; i <= 3500; i += 1) {
    const angle = 20 + i * 0.02;
    let intensity = 2;
    centers.forEach((center, peak) => { intensity += gaussian(angle, center, 0.055, heights[peak]); });
    intensity += (random() - 0.5) * 0.22;
    x.push(Number(angle.toFixed(2)));
    y.push(intensity);
  }
  return makeDataset({
    id: 'sample-xrd-si', name: 'XRD silicon chuẩn (synthetic)', x, y,
    xLabel: '2θ', yLabel: 'Intensity', xUnit: '°', yUnit: 'a.u.',
    source: { kind: 'sample', technique: 'XRD', material: 'Si', standard: 'NIST SRM 640', seed: 0x64052024 },
    tutorial: 'Tìm các peak XRD, đổi 2θ sang d-spacing bằng Bragg law và kiểm tra cường độ tương đối 100/64/37/10/14.',
  });
}

function ramanSample() {
  const random = rng(0x5241_2024);
  const x = [];
  const y = [];
  const peaks = [[158, 7, 40], [270, 10, 18], [520, 12, 100], [790, 16, 32], [960, 14, 55]];
  for (let shift = 100; shift <= 1200; shift += 1) {
    let intensity = 3 + 0.0015 * (shift - 100);
    peaks.forEach(([center, width, height]) => { intensity += gaussian(shift, center, width, height); });
    intensity += (random() - 0.5) * 0.5;
    x.push(shift); y.push(Math.max(0, intensity));
  }
  return makeDataset({
    id: 'sample-raman-pg', name: 'Raman penta-graphene (synthetic)', x, y,
    xLabel: 'Raman shift', yLabel: 'Intensity', xUnit: 'cm⁻¹', yUnit: 'a.u.',
    source: { kind: 'sample', technique: 'Raman', material: 'penta-graphene', seed: 0x52412024 },
    tutorial: 'Detect Raman peak positions and compare FWHM to distinguish a narrow crystalline mode from a broadened mode.',
  });
}

function uvAlphaSample() {
  const random = rng(0x5556_2024);
  const x = [];
  const y = [];
  const Eg = 2.10;
  const hc = 1239.841984;
  for (let wavelength = 300; wavelength <= 800; wavelength += 1) {
    const energy = hc / wavelength;
    // Ideal direct-gap Tauc relation: (alpha*hν)^2 is linear above Eg.
    const alpha = energy > Eg ? 180_000 * Math.sqrt(energy - Eg) / energy : 120;
    x.push(wavelength);
    y.push(Math.max(0, alpha + (random() - 0.5) * 25));
  }
  return makeDataset({
    id: 'sample-uvvis-direct-gap', name: 'UV/Vis α direct-gap (synthetic)', x, y,
    xLabel: 'Wavelength', yLabel: 'Absorption coefficient α', xUnit: 'nm', yUnit: 'cm⁻¹',
    source: { kind: 'sample', technique: 'UV/Vis', material: 'ideal direct-gap semiconductor', Eg, hc, seed: 0x55562024 },
    tutorial: 'Đổi wavelength sang photon energy, vẽ (αhν)² theo hν và chọn ROI tuyến tính để ước lượng direct optical band gap.',
  });
}

/** Fresh deterministic examples for the import and analysis tutorials. */
export function sampleDatasets() {
  return [xrdSample(), ramanSample(), uvAlphaSample()];
}
