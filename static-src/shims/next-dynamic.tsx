import React, { lazy, Suspense } from "react";
export default function dynamic(loader:()=>Promise<{default:React.ComponentType<any>}>,options?:{loading?:()=>React.ReactNode}){const Component=lazy(loader);return function DynamicComponent(props:any){return <Suspense fallback={options?.loading?.()??null}><Component {...props}/></Suspense>}}
