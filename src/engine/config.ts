/**
 * Every tunable constant of the forecast engines lives here.
 * Changing any value that alters a score must bump ENGINE_VERSION (semver minor for tuning, major for model changes).
 */

export const ENGINE_VERSION = '1.0.0';

export const EARTH_RADIUS_KM = 6371;

/** Sample points along the great-circle bearing toward the sun (km from the observer). */
export const SAMPLE_POINTS: { readonly canvas: readonly number[]; readonly corridor: readonly number[]; readonly chartOnly: readonly number[] } = {
  /** What the light lands on. */
  canvas: [-5, 0, 5, 20],
  /** Does the light get through. */
  corridor: [50, 100, 150, 200, 300, 350],
  /** Drawn in the cross-section only; never scored. */
  chartOnly: [-2.5, 2.5, 10, 30],
};

/** Weight of each canvas point in the canvas factor (same order as SAMPLE_POINTS.canvas). */
export const CANVAS_WEIGHTS = [0.15, 0.3, 0.3, 0.25] as const;

/** Atmospheric refraction factor applied to the tangent-ray height (0 = off). Effective radius = R / (1 - k). */
export const REFRACTION_K = 0;

/** Pressure levels requested from Open-Meteo (hPa). */
export const PRESSURE_LEVELS = [1000, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200] as const;

/** Cloud band boundaries (km above model ground) used when pressure-level data is missing. */
export const BANDS = {
  lowTopKm: 3,
  midTopKm: 8,
  /** Representative cloud heights (km above ground) for band-only data. */
  lowRepKm: 1.5,
  midRepKm: 5,
  highRepKm: 9.5,
} as const;

/** How much of the sun's light a cloud layer stops, per unit cover. */
export const OPACITY = { low: 1.0, mid: 0.8, high: 0.5 } as const;

/** Reach: path-weighted blocking fraction → factor. */
export const REACH = { clearBelow: 0.3, blockedAbove: 0.55 } as const;

/** Lit: share of canvas cloud undersides reached by sunlight, saturating. */
export const LIT = {
  saturation: 0.5,
  /** Solar depression step for the after-crossing window (degrees). */
  stepDeg: 0.25,
  /** A point on the light path blocks if cover × opacity at the path altitude reaches this. */
  blockThreshold: 0.6,
  /** Canvas cloud layers thinner than this are ignored as targets. */
  minTargetCover: 0.1,
} as const;

/** Canvas factor shape. */
export const CANVAS = {
  /** Upper-canvas (mid+high) cover giving full value. */
  peakFrom: 0.25,
  peakTo: 0.75,
  /** Value of a completely closed upper deck. */
  closedUpperValue: 0.45,
  /** Pale glow of a completely clear sky. */
  clearGlow: 0.15,
  /** How much low cloud hides the upper canvas. */
  lowHidesUpper: 0.9,
  /** Low cloud values: sparse low cloud gives a pale glow, a closed low lid only coloured edges. */
  lowSparsePeak: 0.35,
  lowSparseAt: 0.25,
  lowBrokenValue: 0.25,
  lowClosedValue: 0.05,
  /** Undercast (observer above the low deck). */
  undercastBase: 0.5,
  undercastPerCover: 0.3,
  /** Observer must be this far above the deck top (km) to count as above it. */
  aboveDeckMarginKm: 0.1,
  /** Pressure-level cover that counts as part of a deck. */
  deckLevelCover: 50,
} as const;

/** Air modifier components; missing inputs take the component minimum. */
export const AIR = {
  min: 0.85,
  max: 1.1,
  aod: { clean: 0.05, moderateLo: 0.1, moderateHi: 0.3, heavy: 0.5, bonus: 0.04, penalty: -0.05 },
  dustHeavy: 100,
  visibility: { goodKm: 30, poorKm: 10, bonus: 0.03, penalty: -0.05 },
  humidity: { niceLo: 50, niceHi: 85, veryHumid: 90, bonus: 0.02, penalty: -0.05 },
} as const;

/** Rain penalty over the canvas: strong multiplier, never a zero. */
export const RAIN = {
  probFrom: 40,
  probTo: 90,
  mmFull: 2,
  maxPenalty: 0.6,
} as const;

/** "Overcast" for the all-points-overcast zero rule (total cloud %). */
export const OVERCAST_TOTAL = 97;

/** Scenarios averaged into the sunset rating. */
export const SCENARIOS = {
  /** Best-light moment: minutes after sunset (before sunrise). */
  bestLightOffsetMin: 10,
  /** Model disagreement badge when |A − B| ≥ this. */
  disagreeAt: 1,
  /** Shoulder samples (display only). */
  shoulderHours: 1,
} as const;

/** Verdict ladder. */
export const VERDICT_LABELS = ['Skip', 'Likely skip', 'Maybe', 'Probably go', 'Go'] as const;
/** Upper bounds (exclusive) of combined score for Skip, Likely skip, Maybe, Probably go; ≥ last → Go. Tunable. */
export const VERDICT_BANDS = [1, 2, 3, 4] as const;
export const COMBINE_WEIGHTS = { sunset: 0.8, golden: 0.2 } as const;

/** Golden hour (sun altitude window, degrees) and near-field analysis. */
export const GOLDEN = {
  topDeg: 6,
  bottomDeg: -4,
  /** Sun elevations sampled for direct light (degrees). */
  sampleElevations: [5.5, 4, 2.5, 1, 0],
  /** Near-field points (km toward the sun) — canvas points within 30 km. */
  maxDistanceKm: 30,
  warmDirect: 0.6,
  patchy: 0.25,
} as const;

/** Day phases by solar altitude (degrees). */
export const PHASES = {
  daytimeAbove: 6,
  goldenBottom: -4,
  blueBottom: -6,
  astroDark: -18,
  /** Official sunrise/sunset (upper limb, standard refraction). */
  officialHorizon: -0.833,
} as const;

/** Night engine thresholds. */
export const NIGHT = {
  cloudBands: [10, 25, 50, 75] as const,
  milkyWay: { maxCloud: 10, moonMaxAltDeg: 10, moonMaxIllum: 0.25, maxRh: 90 },
  dewSpreadWorse: 3,
  dewSpreadCap: 1,
  windWarnKmh: 20,
  gustWarnKmh: 35,
  galacticCore: { raHours: 17 + 45 / 60 + 40 / 3600, decDeg: -29 },
  moonRays: {
    brightTwo: 0.4,
    brightOne: 0.2,
    midCloud: 30,
    aodLo: 0.08,
    aodHi: 0.4,
    rh: 70,
    visLoKm: 5,
    visHiKm: 30,
  },
} as const;

export const BLUE_HOUR = {
  open: 25,
  broken: 50,
  cloudy: 75,
  highCap: 50,
  fogVisKm: 10,
  fogRh: 90,
  hazeVisKm: 20,
  snowLiftM: 0.05,
  goOpaqueMax: 10,
  goHighMin: 10,
  goHighMax: 50,
} as const;

/** Day engine thresholds. */
export const DAY = {
  storm: { cape: 300, liftedIndex: 0, directWm2: 150, sunshineS: 900, uniformRainMm: 1, uniformRainCloud: 95 },
  softOvercast: 85,
  clearMidday: 15,
  steadyRainMm: 1,
  steadyRainCloud: 90,
  hazeVisKm: 10,
  snowDepthM: 0.05,
  inversionLowCover: 70,
} as const;

/** Phenomena. */
export const PHENOMENA = {
  rainbowMaxSunDeg: 42,
  rainbowShowersMm: 0.1,
  rainbowDirectWm2: 120,
  alpenglowReliefM: 500,
  alpenglowMinAngleDeg: 1.5,
  alpenglowReach: 0.7,
  crepuscularBrokenLo: 30,
  crepuscularBrokenHi: 85,
  mistDewSpread: 2,
  mistWindKmh: 8,
  mistRh: 90,
  mistMaxCloud: 25,
  clarityVisKm: 50,
  clarityAod: 0.08,
} as const;

/** Terrain classification from the elevation profile. */
export const TERRAIN = {
  mountainObserverM: 1500,
  mountainReliefM: 1000,
  valleyRiseM: 300,
  nearKm: 15,
  coastKm: 30,
} as const;

/** Open-Meteo usage budget. */
export const BUDGET = {
  dailyLimit: 10000,
  hourlyLimit: 5000,
  minuteLimit: 600,
  targetPerRefresh: 120,
  /** Variables per location included in one call before it counts fractionally more. */
  varsPerCall: 10,
  daysPerCall: 14,
  cacheMinutes: 60,
} as const;
