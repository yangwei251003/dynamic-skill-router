import {z} from 'zod';

// These are retrieval roles, never permissions or claims of authentication.
export const CAPABILITY_ROLES = [
  'local-execution','public-web-access','image-generation','image-observation',
  'document-runtime','interface-observation','compilation-diagnostics',
];
const boundedText=(max)=>z.string().trim().min(1).max(max);
export const capabilityRequestSchema=z.object({
  role:z.enum(CAPABILITY_ROLES).optional(),
  toolNames:z.array(boundedText(240)).min(1).max(10).optional(),
  purpose:boundedText(600),
  evidenceRefs:z.array(boundedText(500)).min(1).max(12),
}).strict().refine(value=>Boolean(value.role||value.toolNames?.length),{
  message:'Specify a capability role or exact current runtime tool name.',
});
export const capabilityRequestsSchema=z.array(capabilityRequestSchema).max(10);
const evidenceSchema=z.object({
  source:z.enum(['user','project','runtime','reference','inference']),
  reference:boundedText(500),claim:z.string().optional(),
});

/** Validate a host interpretation separately from the untouched user request.
 * References establish traceability only; a cited assertion is not authority.
 * Both MCP schemas and direct JS callers use this same request schema.
 */
export function normalizeCapabilityRequests(taskContext={}) {
  if(taskContext.capabilityRequests===undefined)return {requests:[],unresolved:[]};
  const supplied=taskContext.capabilityRequests;
  if(!Array.isArray(supplied)||supplied.length>10)return {
    requests:[],unresolved:[{index:null,reason:'invalid-capability-requests',authority:'advisory-only'}],
  };
  const evidence=new Map();
  for(const raw of Array.isArray(taskContext.evidence)?taskContext.evidence:[]){
    const parsed=evidenceSchema.safeParse(raw);
    if(parsed.success)evidence.set(parsed.data.reference,parsed.data);
  }
  const requests=[],unresolved=[];
  for(const [index,raw] of supplied.entries()){
    const parsed=capabilityRequestSchema.safeParse(raw);
    if(!parsed.success){unresolved.push({index,reason:'invalid-capability-request',authority:'advisory-only'});continue;}
    const item=parsed.data;
    const missing=item.evidenceRefs.filter(ref=>!evidence.has(ref));
    if(missing.length){unresolved.push({index,reason:'unbound-evidence-reference',evidenceRefs:missing,authority:'advisory-only'});continue;}
    requests.push({...item,index,toolNames:[...new Set(item.toolNames||[])],
      evidenceRefs:[...new Set(item.evidenceRefs)],evidence:item.evidenceRefs.map(ref=>evidence.get(ref)),
      source:'host-context',authority:'advisory-only'});
  }
  return {requests,unresolved};
}
