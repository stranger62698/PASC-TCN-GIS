import React from "react";
const base=(import.meta.env.BASE_URL||"/").replace(/\/$/,"");
const hashMode=import.meta.env.VITE_HASH_ROUTING==="true";
export default function Link({href,children,...props}:{href:string;children:React.ReactNode;[key:string]:unknown}){const target=href.startsWith("/")?(hashMode?`${base}/#${href}`:`${base}${href}`):href;return <a href={target||"/"} {...props}>{children}</a>}
