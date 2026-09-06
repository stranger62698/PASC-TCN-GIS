import type { Metadata } from "next";

import { PascLocalPrototype } from "../components/PascLocalPrototype";

export const metadata: Metadata = {
  title: "PASC-TCN 本地推理验证｜澜迹 InSAR",
  robots: { index: false, follow: false },
};

export default function PascLocalPage() {
  return <PascLocalPrototype />;
}
