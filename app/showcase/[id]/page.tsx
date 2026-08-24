import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CaseDetailPage } from "../../components/CasePages";
import { cases } from "../../data/site";

const siteOrigin = "https://lanje-urban-insar.fengyaowu78.chatgpt.site";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const item = cases.find((entry) => entry.key === id);
  if (!item) return {};
  const image = new URL(item.image, siteOrigin).toString();
  return {
    title: `${item.title}｜澜迹 InSAR`,
    description: item.description,
    openGraph: { title: item.title, description: item.description, images: [{ url: image, alt: item.title }] },
    twitter: { card: "summary_large_image", title: item.title, description: item.description, images: [image] },
  };
}

export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;const item=cases.find(x=>x.key===id);if(!item)notFound();return <CaseDetailPage item={item}/>}
