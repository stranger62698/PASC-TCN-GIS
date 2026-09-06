declare module "shpjs" {
  type FeatureCollection = { type: "FeatureCollection"; name?: string; features: unknown[] };
  export default function shp(input: ArrayBuffer): Promise<FeatureCollection | FeatureCollection[]>;
}
