import { msg } from '../i18n';
/** Recovery is read-only. Browser swap files are uncommitted candidates, never
 * preferred to a valid canonical index or an application-created backup. */
export interface ManifestIO {
  read(name:string):Promise<string|null>;
  write(name:string,text:string):Promise<void>;
}
const canonical="manifest.json",backup="manifest.json.bak";
const candidates=[canonical,backup,"manifest.crswap","manifest.json.crswap"];
const filename=(value:unknown):value is string=>typeof value==="string" && Boolean(value) && !/[\\/]/.test(value) && value!=="." && value!=="..";
function manifestFiles(raw:string):string[]|null {
  try {
    const value=JSON.parse(raw);
    if(!value || typeof value!=="object")return null;
    if(Array.isArray(value.models)) {
      const files:string[]=[];
      for(const model of value.models){
        if(!model || typeof model.id!=="string" || !Array.isArray(model.edits))return null;
        if(model.original!==undefined){if(!filename(model.original))return null;files.push(model.original);}
        for(const edit of model.edits){if(!edit || typeof edit.id!=="string" || !filename(edit.file))return null;files.push(edit.file);}
        if(model.activeEditId && !model.edits.some((edit:{id:string})=>edit.id===model.activeEditId))return null;
      }
      if(value.models.length && !value.models.some((model:{id:string})=>model.id===value.activeModelId))return null;
      return files;
    }
    if(Array.isArray(value.versions)) {
      const files:string[]=[];
      for(const version of value.versions){
        if(!version || !filename(version.edited))return null;files.push(version.edited);
        if(version.original!==undefined){if(!filename(version.original))return null;files.push(version.original);}
      }
      return files;
    }
  }catch { /* malformed or incomplete candidate */ }
  return null;
}
export async function readRecoverableManifest(io:ManifestIO):Promise<string|null> {
  let found=false;
  for(const name of candidates){
    const raw=await io.read(name);
    if(raw===null)continue;
    found=true;
    const files=manifestFiles(raw);
    if(!files)continue;
    if(name!==canonical){
      // A stale backup or a half-finished new-version operation must not hide
      // missing content behind an apparently healthy index.
      let complete=true;
      for(const file of new Set(files)){
        const data=await io.read(file);
        try {if(data===null || !Array.isArray(JSON.parse(data)?.transcript?.segments))complete=false;}
        catch {complete=false;}
        if(!complete)break;
      }
      if(!complete)continue;
    }
    return raw;
  }
  if(found)throw new Error(msg('manifestRecovery.m1357'));
  return null;
}

/** Back up before replacing the index; check the final file after close, and
 * try restoring the prior index on failure. Never overwrite the backup during rollback. */
export async function writeRecoverableManifest(io:ManifestIO,text:string):Promise<void> {
  if(!manifestFiles(text))throw new Error(msg('manifestRecovery.m1358'));
  const previous=await readRecoverableManifest(io);
  if(previous!==null){
    try {
      await io.write(backup,previous);
      if(await io.read(backup)!==previous)throw new Error(msg('review.RS031'));
    }catch(error){throw new Error(msg('manifestRecovery.m1359'),{cause:error});}
  }
  try {
    await io.write(canonical,text);
    if(await io.read(canonical)!==text)throw new Error(msg('review.RS032'));
  }catch(error){
    let restored=false;
    if(previous!==null){
      try {
        restored=await io.read(canonical)===previous;
        if(!restored){await io.write(canonical,previous);restored=await io.read(canonical)===previous;}
      }catch { /* validated backup remains intact */ }
    }
    const detail=error instanceof Error ? `（${error.message}）` : "";
    throw new Error((restored
      ? msg('manifestRecovery.m1360')
      : previous!==null
        ? msg('manifestRecovery.m1361')
        : msg('manifestRecovery.m1362'))+detail,{cause:error});
  }
}
