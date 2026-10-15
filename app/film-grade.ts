/**
 * One film look, defined once. The editor and still exports draw it with a CSS
 * filter on the background; MP4 export applies the same maths in ffmpeg, so the
 * preview and the video match.
 *
 * CSS applies filter functions in order. contrast() is per channel, then
 * saturate(), sepia() and brightness() are 3×3 colour matrices from the Filter
 * Effects spec, which ffmpeg's colorchannelmixer takes as one combined matrix.
 */
export type CarouselGrade = "film";

export const FILM_GRADE = {
  contrast: 1.08,
  saturate: 0.84,
  sepia: 0.14,
  brightness: 0.96,
  /** Strength of the moving grain ffmpeg adds; stills use a static texture instead. */
  grain: 7,
} as const;

export function filmGradeCss(grade = FILM_GRADE) {
  return `contrast(${grade.contrast}) saturate(${grade.saturate}) sepia(${grade.sepia}) brightness(${grade.brightness})`;
}

type Matrix = [number, number, number, number, number, number, number, number, number];

function saturate(s: number): Matrix {
  return [
    0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
  ];
}

function sepia(amount: number): Matrix {
  const a = 1 - amount;
  return [
    0.393 + 0.607 * a, 0.769 - 0.769 * a, 0.189 - 0.189 * a,
    0.349 - 0.349 * a, 0.686 + 0.314 * a, 0.168 - 0.168 * a,
    0.272 - 0.272 * a, 0.534 - 0.534 * a, 0.131 + 0.869 * a,
  ];
}

/** b · a: apply a first, then b. */
function multiply(b: Matrix, a: Matrix): Matrix {
  const out = new Array(9).fill(0) as Matrix;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      for (let k = 0; k < 3; k++) out[row * 3 + col] += b[row * 3 + k] * a[k * 3 + col];
    }
  }
  return out;
}

/** saturate, then sepia, then brightness, as one matrix. */
export function filmGradeMatrix(grade = FILM_GRADE): Matrix {
  const colour = multiply(sepia(grade.sepia), saturate(grade.saturate));
  return colour.map((value) => value * grade.brightness) as Matrix;
}

/** The ffmpeg filters for one video stream, ending in moving grain. */
export function filmGradeFfmpeg(grade = FILM_GRADE) {
  const contrast = (channel: string) => `${channel}='clip((val-127.5)*${grade.contrast}+127.5,0,255)'`;
  const m = filmGradeMatrix(grade).map((value) => value.toFixed(5));
  const mixer = `colorchannelmixer=rr=${m[0]}:rg=${m[1]}:rb=${m[2]}:gr=${m[3]}:gg=${m[4]}:gb=${m[5]}:br=${m[6]}:bg=${m[7]}:bb=${m[8]}`;
  return `format=rgb24,lutrgb=${contrast("r")}:${contrast("g")}:${contrast("b")},${mixer},noise=alls=${grade.grain}:allf=t+u`;
}
