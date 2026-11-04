/** Full-content identity in bounded chunks, shared with project media storage. */
export async function audioIdentity(file: Blob): Promise<string> {
  const parts: Uint8Array[] = [];
  for (let offset=0;offset<file.size;offset+=2*1024*1024) {
    parts.push(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.slice(offset,offset+2*1024*1024).arrayBuffer())));
  }
  const hashes=new Uint8Array(parts.length*32);parts.forEach((part,i)=>hashes.set(part,i*32));
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',hashes));
  return `${file.size}:${Array.from(digest,n=>n.toString(16).padStart(2,'0')).join('')}`;
}
