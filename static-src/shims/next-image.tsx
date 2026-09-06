import { forwardRef, type ImgHTMLAttributes } from "react";

type StaticImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string | { src: string };
  alt: string;
  fill?: boolean;
  priority?: boolean;
  quality?: number;
  unoptimized?: boolean;
};

// Static exports have no image optimization endpoint; serve the original asset.
export default forwardRef<HTMLImageElement, StaticImageProps>(function StaticImage(
  { src, fill, priority, style, loading, alt, ...props }, ref
) {
  const domProps = { ...props };
  delete domProps.quality;
  delete domProps.unoptimized;
  const path = typeof src === "string" ? src : src.src;
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  const url = path.startsWith("/") && !path.startsWith("//") ? base + path : path;
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...domProps} alt={alt} ref={ref} src={url} loading={priority ? "eager" : loading || "lazy"} fetchPriority={priority ? "high" : props.fetchPriority} style={fill ? { position: "absolute", inset: 0, width: "100%", height: "100%", ...style } : style} />;
});

