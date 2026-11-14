export async function api<T>(path:string,body?:unknown,method=body===undefined?'GET':'POST'):Promise<T>{
 const response=await fetch(`/api${path}`,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 if(!response.ok){const error=await response.json().catch(()=>({message:'Server unavailable'}));throw new Error(error.message??`Request failed (${response.status})`);}
 return response.json() as Promise<T>;
}
export const time=(value:string)=>new Date(value).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
export const words=(value:string)=>value.toLowerCase().replaceAll('_',' ');
