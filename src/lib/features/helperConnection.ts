/** The capability stays in memory; never store it or put it in a request URL. */
export function readHelperConnection(text:string){
 const url=new URL(text);
 if(url.protocol!=='http:'||url.hostname!==[127,0,0,1].join('.')||!url.port||url.username||url.password||url.pathname!=='/'||url.search||!/^#[A-Za-z0-9_-]{43}$/.test(url.hash))throw Error('Use the exact loopback connection printed by your local helper.');
 return {origin:url.origin,capability:url.hash.slice(1)};
}
