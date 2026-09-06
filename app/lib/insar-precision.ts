export const INSAR_DECIMAL_DIGITS = 1;
export const INSAR_TENTH_MM_SCALE = 0.1 as const;

export type QuantizedInsarSeries = {
  values: Int16Array | Int32Array;
  scale: typeof INSAR_TENTH_MM_SCALE;
  encoding: "int16_tenth_mm" | "int32_tenth_mm";
};

export function roundInsarValue(value: number) {
  return Number.isFinite(value) ? Math.round((value + Number.EPSILON) * 10) / 10 : value;
}

export function quantizeInsarSeries(values: ArrayLike<number>): QuantizedInsarSeries {
  let needsInt32 = false;
  for (let index = 0; index < values.length; index += 1) {
    const value = Number(values[index]);
    if (!Number.isFinite(value)) throw new Error("形变序列包含无效数值，无法执行一位小数量化。");
    const encoded = Math.round(value * 10);
    if (encoded < -2_147_483_648 || encoded > 2_147_483_647) throw new Error("形变值超出一位小数量化范围。");
    if (encoded < -32_768 || encoded > 32_767) needsInt32 = true;
  }
  const result = needsInt32 ? new Int32Array(values.length) : new Int16Array(values.length);
  for (let index = 0; index < values.length; index += 1) result[index] = Math.round(Number(values[index]) * 10);
  return { values: result, scale: INSAR_TENTH_MM_SCALE, encoding: needsInt32 ? "int32_tenth_mm" : "int16_tenth_mm" };
}

export function decodeInsarValue(value: number, scale = INSAR_TENTH_MM_SCALE) {
  return roundInsarValue(value * scale);
}
