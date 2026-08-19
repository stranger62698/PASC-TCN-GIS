import { copyFile, mkdir } from "node:fs/promises";
const routes=["about","datasets","login","map","platform","showcase","solutions","statistics","showcase/city","showcase/landslide","showcase/road"];
for(const route of routes){await mkdir(new URL(`../static-dist/${route}/`,import.meta.url),{recursive:true});await copyFile(new URL("../static-dist/index.html",import.meta.url),new URL(`../static-dist/${route}/index.html`,import.meta.url))}
