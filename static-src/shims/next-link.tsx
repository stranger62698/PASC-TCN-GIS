import React from "react";
export default function Link({href,children,...props}:{href:string;children:React.ReactNode;[key:string]:unknown}){return <a href={href} {...props}>{children}</a>}
