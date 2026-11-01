import {invocationConstraints,constrainCapability,prohibitedObjectOperation} from './invocation-constraints.mjs';
import {requestSegments,exactToolProhibited,imageToolProhibitions,imageToolPurposes,imageEditInquiryOnly,webSearchToolProhibited,webSearchToolPurpose} from './request-evidence.mjs';
export function validateHostOptions(options={}) {
  const context=options.taskContext;
  if(context!==undefined&&(!context||typeof context!=='object'||Array.isArray(context)))throw new TypeError('taskContext must be an object');
  for(const key of ['objective','domain','background','nativeApproach'])if(context?.[key]!==undefined&&typeof context[key]!=='string')throw new TypeError('Invalid taskContext.'+key);
  for(const key of ['actions','deliverables','explicitSkills','constraints','complexityEvidence'])if(context?.[key]!==undefined&&(!Array.isArray(context[key])||context[key].some(x=>typeof x!=='string')))throw new TypeError('Invalid taskContext.'+key);
  if(context?.complexity!==undefined&&!['low','medium','high'].includes(context.complexity))throw new TypeError('Invalid taskContext.complexity');
  const requests=context?.capabilityRequests;
  if(requests!==undefined&&(!Array.isArray(requests)||requests.length>10))throw new TypeError('capabilityRequests must contain at most 10 requests');
  for(const r of requests??[]){if(!r||typeof r!=='object')throw new TypeError('Invalid capability request');for(const key of ['toolNames','evidenceRefs'])if(!Array.isArray(r[key])||!r[key].length||r[key].some(x=>typeof x!=='string'||!x.trim()))throw new TypeError('Invalid '+key);if(r.reason!==undefined&&typeof r.reason!=='string')throw new TypeError('Invalid reason');}
  if(options.qualityProfile!==undefined&&!['economy','balanced','quality'].includes(options.qualityProfile))throw new TypeError('Invalid qualityProfile');
  const methods=options.taskMethods;if(methods!==undefined&&methods!==false){if(!methods||typeof methods!=='object'||Array.isArray(methods))throw new TypeError('Invalid taskMethods');if(methods.maxCards!==undefined&&(!Number.isInteger(methods.maxCards)||methods.maxCards<0||methods.maxCards>2))throw new TypeError('Invalid maxCards');if(methods.disabledIds!==undefined&&(!Array.isArray(methods.disabledIds)||methods.disabledIds.some(x=>typeof x!=='string')))throw new TypeError('Invalid disabledIds');}
  invocationConstraints({},options);return options;
}
export function exactToolConsultations(query,assessment,options={}) {
  validateHostOptions(options);const cards=[],seen=new Set(),c=invocationConstraints({...assessment,rawText:query},options),imageBans=imageToolProhibitions(query),searchToolBanned=webSearchToolProhibited(query),imageInquiryOnly=imageEditInquiryOnly(query);
  for(const request of options.taskContext?.capabilityRequests??[]){
    if(!request.evidenceRefs.every(ref=>String(query).includes(ref)&&String(assessment.activeText??'').includes(ref)))continue;
    for(const name of request.toolNames){
      const tool=(options.runtimeTools??[]).find(t=>t?.name===name);if(!tool||tool.available===false||seen.has(name)||exactToolProhibited(query,name)||prohibitedObjectOperation(query,tool))continue;seen.add(name);
      if(searchToolBanned&&webSearchToolPurpose(tool.description,name))continue;
      const imagePurpose=imageToolPurposes(tool.description);
      if((imageBans.create&&imagePurpose.create)||(imageBans.edit&&imagePurpose.edit))continue;
      const uncertainImagePurpose=(imageBans.create||imageBans.edit)&&!imagePurpose.create&&!imagePurpose.edit&&request.evidenceRefs.some(ref=>/(?:图片|图像|照片|插画|截图|修图|\b(?:image|photo|picture)\b)/iu.test(ref));
      const read=tool.annotations?.readOnlyHint===true&&tool.annotations?.destructiveHint!==true;
      const inquiryOnly=imageInquiryOnly&&imagePurpose.edit;
      const active=String(assessment.activeText??'');
      const missingEditPurpose=imagePurpose.create&&!imagePurpose.edit&&/(?:图片|图像|照片|插画|截图|\b(?:images?|photos?|pictures?)\b)/iu.test(active)&&/(?:编辑|修改|修图|调整|\b(?:edit|modify|retouch)\b)/iu.test(active);
      cards.push(constrainCapability({name,toolNames:[name],explicit:false,source:'host-consultation',decision:uncertainImagePurpose||inquiryOnly||missingEditPurpose?'defer':tool.available===true?'consult':'defer',effect:read?'read':'unknown',availability:{callable:tool.available===true?true:null,evidence:'current-runtime-tool-record'},evidenceRefs:[...request.evidenceRefs],reason:request.reason??'Host-proposed consultation supported by current query evidence.',gates:['inspect-exact-schema-and-inputs','host-context-is-not-user-authorization','access-and-effects-not-yet-verified',...(uncertainImagePurpose?['image-category-prohibition-purpose-unverified']:[]),...(inquiryOnly?['image-edit-inquiry-not-execution']:[]),...(missingEditPurpose?['image-edit-purpose-unverified']:[])],advisoryOnly:true,invocation:{tool:name,executor:'host-agent',automaticallyExecuted:false}},c,tool));
    }
  }return cards;
}
export function requestContext(query,options={}){validateHostOptions(options);const provenance=requestSegments(query,{preserveNames:false});return {rawQuery:String(query??''),hostInterpretation:options.taskContext?structuredClone(options.taskContext):null,...(provenance.spans.length?{sourceSegments:provenance.spans,offsetUnit:provenance.offsetUnit}:{}),authority:'host-context-is-advisory-not-authorization'};}
