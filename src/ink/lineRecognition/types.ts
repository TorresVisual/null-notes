export interface XY {
  x: number
  y: number
}

export interface LineMetrics {
  /** RMS perpendicular deviation from the fitted line, as a fraction of the chord. */
  rms: number
  /** 95th-percentile perpendicular deviation, as a fraction of the chord. */
  p95: number
  /** Straight distance between the stroke's ends over the length of the path. */
  chordPathRatio: number
}

export interface RecognizedLine {
  x1: number
  y1: number
  x2: number
  y2: number
  metrics: LineMetrics
}

export interface LineRecognitionConfig {
  /** RMS limit to start recognising a line. */
  enterRms: number
  /** RMS limit to keep recognising one that is already showing (hysteresis). */
  exitRms: number
  maxP95: number
  minChordPathRatio: number
  /** Chord length, in ink units, below which a stroke is a dot or a tick, not a line. */
  minLength: number
  /** Distinct points a stroke needs after preprocessing. */
  minSamples: number
  /** Moves shorter than this, in ink units, are pen jitter and are dropped. */
  minStep: number
  /** Points the path is resampled to, evenly along its length. */
  resampleCount: number
}
