export function usePathname(){return typeof window==="undefined"?"/":window.location.pathname}
export function notFound(){throw new Error("Not found")}
