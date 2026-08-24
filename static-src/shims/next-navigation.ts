const base=(import.meta.env.BASE_URL||"/").replace(/\/$/,"");
const hashMode=import.meta.env.VITE_HASH_ROUTING==="true";
export function usePathname(){if(typeof window==="undefined")return "/";return hashMode?(window.location.hash.slice(1)||"/"):(window.location.pathname.slice(base.length)||"/")}
export function notFound(){throw new Error("Not found")}
