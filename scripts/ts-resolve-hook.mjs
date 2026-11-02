import { existsSync } from 'node:fs'; import { fileURLToPath } from 'node:url';
export async function resolve(spec, ctx, next){
  if((spec.startsWith('.')||spec.startsWith('/'))&&!/\.[a-z]+$/.test(spec)){
    const base=new URL(spec,ctx.parentURL);
    for(const e of ['.ts','/index.ts']){const u=new URL(base.href+e); if(existsSync(fileURLToPath(u))) return next(u.href,ctx);}
  } return next(spec,ctx);
}
