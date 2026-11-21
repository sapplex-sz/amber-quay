// AMBER QUAY: invented vehicle models, colours and gear.
export const CAR_COLORS = [
  [38, 140, 150], [190, 76, 44], [232, 220, 190], [226, 170, 44], [112, 60, 104], [48, 70, 112], [60, 110, 74],
  [238, 236, 228], [196, 52, 48], [96, 150, 190], [150, 150, 154], [220, 120, 70],
];
// len/wid in metres; top = body top z; cab = [length frac, height, width frac, rear shift frac]; spd m/s; acc m/s2
export const MODELS = {
  hatch: { name: 'Pip Hatch', len: 3.8, wid: 1.76, top: 1.0, cab: [0.58, 0.62, 0.9, -0.04], spd: 24, acc: 9, turn: 2.6, hp: 90, mass: 1 },
  sedan: { name: 'Corvane Sedan', len: 4.7, wid: 1.88, top: 1.0, cab: [0.5, 0.58, 0.88, -0.06], spd: 27, acc: 9.5, turn: 2.35, hp: 110, mass: 1.15 },
  sport: { name: 'Marlin GT', len: 4.5, wid: 1.96, top: 0.88, cab: [0.4, 0.5, 0.84, -0.1], spd: 40, acc: 15, turn: 2.7, hp: 100, mass: 1.05 },
  taxi: { name: 'Kettle Cab', len: 4.7, wid: 1.9, top: 1.0, cab: [0.5, 0.6, 0.88, -0.06], spd: 26, acc: 9.5, turn: 2.35, hp: 110, mass: 1.15 },
  van: { name: 'Haulby Van', len: 5.3, wid: 2.05, top: 1.55, cab: [0.34, 0.68, 0.96, 0.28], spd: 22, acc: 7.5, turn: 1.9, hp: 140, mass: 1.6 },
  pickup: { name: 'Brawn Pickup', len: 5.1, wid: 2.0, top: 1.15, cab: [0.34, 0.62, 0.9, 0.2], spd: 25, acc: 9, turn: 2.2, hp: 130, mass: 1.5 },
  police: { name: 'Harbour Constabulary Cruiser', len: 4.8, wid: 1.92, top: 1.0, cab: [0.5, 0.58, 0.88, -0.06], spd: 36, acc: 14, turn: 2.6, hp: 130, mass: 1.3 },
  tram: { name: 'Rookline Tram', len: 17, wid: 2.8, top: 3.1, cab: [0.96, 0.8, 0.96, 0], spd: 7, acc: 3, turn: 0, hp: 9999, mass: 30 },
};
export const CIV_MODELS = ['hatch', 'hatch', 'sedan', 'sedan', 'sedan', 'taxi', 'van', 'pickup', 'sport'];
export const SKIN = [[240, 205, 170], [218, 164, 120], [170, 112, 78], [120, 78, 54], [90, 58, 42]];
export const HAIR = [[40, 30, 26], [90, 60, 36], [180, 130, 60], [30, 30, 36], [140, 60, 40], [200, 196, 190]];
export const SHIRTS = [[200, 70, 50], [40, 140, 150], [236, 190, 60], [90, 130, 80], [150, 70, 130], [230, 226, 214], [60, 90, 150], [220, 130, 80], [120, 160, 200]];
export const PANTS = [[50, 56, 76], [88, 70, 56], [60, 60, 64], [120, 110, 90], [40, 70, 80]];
export const WEAPONS = {
  fists: { name: 'FISTS', dmg: 16, rate: 0.36, range: 2.3 },
  pistol: { name: 'RIVET .38', dmg: 24, rate: 0.26, range: 60, clip: 12, speed: 85 },
};
