import {readFile,writeFile,mkdir,readdir,rm} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {osmSitePositionFromElement} from "../widgets/structure-picker/osm-site-positions.js";
export function buildFinessSiteGeometries(payload, url, capturedAt) {
  if (payload.remark || !Array.isArray(payload.elements) || !Number.isFinite(Date.parse(capturedAt))) throw new Error("Incomplete OSM source");
  const nodes = new Map(payload.elements.filter(element => element.type === "node").map(element => [element.id, {lat:element.lat,lon:element.lon}]));
  const source = {id:"osm-finess-positions", label:"OpenStreetMap — sites FINESS",url,generatedAt:payload.osm3s?.timestamp_osm_base || capturedAt,license:"ODbL 1.0"};
  const shards=new Map(); const seen=new Set();
  for(const element of payload.elements){
    const record=Object.fromEntries(["type","id","lat","lon","nodes","geometry","tags","version","timestamp","changeset"].filter(key=>key in element).map(key=>[key,element[key]]));
    if(record.type==="way"&&!record.geometry)record.geometry=record.nodes?.map(id=>nodes.get(id));
    if(record.geometry?.some(point=>!point))continue;
    const poi=osmSitePositionFromElement(record,source);
    if(!poi?.finessIds.length||poi.kind!=="site")continue;
    if(!Number.isSafeInteger(record.version)||!Number.isFinite(Date.parse(record.timestamp))||Date.parse(record.timestamp)>Date.parse(source.generatedAt))throw new Error("Missing OSM version");
    const key=`${record.type}:${record.id}`;if(seen.has(key))throw new Error("Duplicate OSM object");seen.add(key);
    for(const prefix of new Set(poi.finessIds.map(id=>id.slice(0,6)))){if(!shards.has(prefix))shards.set(prefix,[]);shards.get(prefix).push(record);}
  }
  if(!shards.size)throw new Error("No usable geographic FINESS sites");
  return new Map([...shards].map(([prefix,records])=>[prefix,{schemaVersion:1,prefix,source,recordCount:records.length,records}]));
}
async function main(){
  const args=new Map();for(let i=2;i<process.argv.length;i+=2)args.set(process.argv[i],process.argv[i+1]);
  const url=args.get("--source-url");if(!/^https:\/\//.test(url??""))throw new Error("A real public source URL is required");
  const payload=args.has("--input")?JSON.parse(await readFile(args.get("--input"),"utf8")):await(await fetch(url,{signal:AbortSignal.timeout(60000)})).json();
  const shards=buildFinessSiteGeometries(payload,url,new Date().toISOString());
  const encoded=[...shards].map(([prefix,value])=>[`${prefix}.json`,JSON.stringify(value)+"\n"]);
  if(encoded.some(([,text])=>Buffer.byteLength(text)>96*1024))throw new Error("FINESS geometry shard exceeds browser budget");
  const output=args.get("--output")??fileURLToPath(new URL("../widgets/structure-picker/site-position-indexes/osm-finess-sites/",import.meta.url));await mkdir(output,{recursive:true});
  for(const name of await readdir(output))if(name.endsWith('.json')&&!encoded.some(([file])=>name===file))await rm(path.join(output,name));
  for(const[name,text]of encoded)await writeFile(path.join(output,name),text);
  console.log(JSON.stringify({files:shards.size,records:[...shards.values()].reduce((n,value)=>n+value.recordCount,0)}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
