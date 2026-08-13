import { notFound } from "next/navigation";
import { CaseDetailPage } from "../../components/CasePages";
import { cases } from "../../data/site";
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;const item=cases.find(x=>x.key===id);if(!item)notFound();return <CaseDetailPage item={item}/>}
