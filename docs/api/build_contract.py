"""Generate the REVIEW OpenAPI artifact. Not a runtime or endpoint implementation."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parent
S={}; paths={}
def ref(n): return {'$ref':f'#/components/schemas/{n}'}
def obj(props,required=None,**kw): return {'type':'object','properties':props,'required':list(props) if required is None else required,'additionalProperties':False,**kw}
def string(maximum=1000,minimum=0,**kw): return {'type':'string','minLength':minimum,'maxLength':maximum,**kw}
def integer(minimum=0,maximum=2147483647): return {'type':'integer','minimum':minimum,'maximum':maximum}
def enum(*values): return {'type':'string','enum':list(values)}
def array(item,limit=100): return {'type':'array','items':item,'maxItems':limit}
def nullable(s): return {'anyOf':[s,{'type':'null'}]}
def add(n,s): S[n]=s; return ref(n)
def envelope(n): return obj({'data':ref(n),'meta':ref('ResponseMeta')})
ID=add('Id',string(36,36,pattern='^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'))
REV=add('Revision',integer(1)); DT=add('UtcTime',string(24,24,format='date-time',pattern=r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'))
SEQ=add('Sequence',string(20,1,pattern=r'^(0|[1-9][0-9]{0,19})$'))
KEY=add('CommandKey',string(128,16,pattern=r'^[A-Za-z0-9_-]+$'))
CURSOR=add('EventCursor',string(57,38,pattern=r'^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:(0|[1-9][0-9]{0,19})$'))
add('ResponseMeta',obj({'requestId':string(100,1),'replayed':{'type':'boolean'},'storeEpoch':ID}))
error_codes=['INVALID_REQUEST','AUTH_REQUIRED','ORIGIN_REJECTED','CSRF_REJECTED','NOT_FOUND','PRECONDITION_REQUIRED','REVISION_MISMATCH','IDEMPOTENCY_CONFLICT','NODE_STALE','CONTROL_CONFLICT','LEASE_EXPIRED','CAPABILITY_UNAVAILABLE','BUDGET_EXCEEDED','QUOTE_EXPIRED','QUOTE_MISMATCH','OPERATION_UNCERTAIN','MUST_PAUSE_FIRST','ASSET_NOT_RESTORABLE','ASSET_MISSING','UNSUPPORTED_MEDIA','UPLOAD_TOO_LARGE','RATE_LIMITED','CURSOR_EXPIRED','INVALID_CURSOR','DATABASE_BUSY','INTERNAL_ERROR']
error_codes.append('SUGGESTIONS_UNAVAILABLE')
add('ApiError',obj({'error':obj({'code':enum(*error_codes),'message':string(1000,1),'retryable':{'type':'boolean'},'retryAction':enum('none','same_command','refresh_snapshot','reconcile_operation','reauthenticate'),'requestId':string(100,1),'details':obj({'fieldErrors':array(obj({'path':string(200,1),'message':string(300,1)}),30),'currentRevision':REV,'snapshotUrl':string(500,1),'operationId':ID},[])})}))
add('ExchangeRequest',obj({'bootstrapNonce':string(256,32)}))
add('Session',obj({'profileId':ID,'expiresAt':DT,'csrfToken':string(256,16),'apiVersion':{'const':'1.0.0'},'maxUploadBytes':integer(1,104857600)}))
add('ResourceMeta',obj({'id':ID,'createdAt':DT,'updatedAt':DT,'deletedAt':nullable(DT),'revision':REV}))
mutable={'id':ID,'createdAt':DT,'updatedAt':DT,'deletedAt':nullable(DT),'revision':REV,'archivedAt':nullable(DT)}
add('StorySettings',obj({'premise':string(12000),'playerRole':string(4000),'worldRules':array(string(1000),30),'tone':string(500)}))
add('CharacterSettings',obj({'description':string(8000),'speechStyle':string(2000),'boundaries':array(string(1000),30)}))
add('CastSlot',obj({'slotKey':string(64,1,pattern=r'^[a-zA-Z0-9_-]+$'),'characterVersionId':ID,'overrides':obj({'roleInWorld':string(3000),'relationshipToPlayer':string(2000)})}))
add('AssetSlot',obj({'slotKey':string(64,1,pattern=r'^[a-zA-Z0-9_-]+$'),'assetId':ID,'purpose':enum('cover','opening','style','reference')}))
story_fields={'title':string(120,1),'settings':ref('StorySettings'),'cast':array(ref('CastSlot'),20),'assets':array(ref('AssetSlot'),20)}
char_fields={'name':string(80,1),'settings':ref('CharacterSettings'),'portraitAssetId':nullable(ID)}
add('Story',obj({**mutable,**story_fields}))
add('Character',obj({**mutable,**char_fields}))
add('CreateStory',obj(story_fields)); add('CreateCharacter',obj(char_fields))
add('PatchStory',obj({**story_fields,'archivedAt':nullable(DT)},[],minProperties=1))
add('PatchCharacter',obj({**char_fields,'archivedAt':nullable(DT)},[],minProperties=1))
add('StoryVersion',obj({'id':ID,'storyDraftId':ID,'versionNo':REV,'sourceRevision':REV,'sealedAt':DT,'contentHash':string(64,64,pattern='^[0-9a-f]{64}$'),'createdAt':DT,**story_fields}))
add('CharacterVersion',obj({'id':ID,'characterTemplateId':ID,'versionNo':REV,'sourceRevision':REV,'createdAt':DT,**char_fields}))
add('Asset',obj({'id':ID,'revision':REV,'createdAt':DT,'updatedAt':DT,'deletedAt':nullable(DT),'mimeType':string(100,1),'byteSize':SEQ,'sha256':string(64,64,pattern='^[0-9a-f]{64}$'),'status':enum('ready','deleting','purged'),'width':integer(1,32768),'height':integer(1,32768),'contentUrl':string(500,1)}))
add('UploadMetadata',obj({'rightsDeclaration':string(2000,1),'fileName':string(255,1)}))
add('UploadAsset',obj({'file':{'type':'string','format':'binary'},'metadata':ref('UploadMetadata')}))
add('Capability',obj({'verification':enum('verified','unknown','unsupported'),'mode':enum('job','realtime'),'aspectRatios':array(enum('16:9','9:16','1:1'),3),'imageInput':enum('verified','unknown','unsupported'),'nativeAudio':enum('verified','unknown','unsupported'),'cancel':enum('verified','unknown','unsupported'),'verifiedAt':nullable(DT)}))
add('ProviderModel',obj({'catalogId':string(200,1),'providerId':string(100,1),'modelId':string(200,1),'adapterVersion':string(80,1),'capabilityVersion':string(80,1),'capabilities':ref('Capability'),'available':{'type':'boolean'},'unavailableReason':nullable(string(500))}))
add('ProviderBinding',obj({'id':ID,'bindingKey':string(80,1),'versionNo':REV,'catalogId':string(200,1),'providerId':string(100,1),'modelId':string(200,1),'adapterVersion':string(80,1),'capabilityVersion':string(80,1),'aspectRatio':enum('16:9','9:16','1:1'),'credentialConfigured':{'type':'boolean'},'createdAt':DT}))
add('CreateProviderBinding',obj({'bindingKey':string(80,1),'catalogId':string(200,1),'aspectRatio':enum('16:9','9:16','1:1')}))
for name in ['ProviderModel','ProviderBinding']:
 S[name]['properties'].update({'connectionId':ID,'region':string(80,1)})
 S[name]['required']+=['connectionId','region']
S['CreateProviderBinding']['properties']['connectionId']=ID; S['CreateProviderBinding']['required'].append('connectionId')
add('ControlProof',obj({'leaseId':ID,'leaseEpoch':REV,'clientInstanceId':ID,'controlToken':string(256,32)}))
add('ControlLease',obj({'leaseId':ID,'leaseEpoch':REV,'clientInstanceId':ID,'controlToken':string(256,32),'expiresAt':DT,'renewAfterMs':integer(1000,120000)}))
add('ControlSummary',obj({'leaseEpoch':REV,'clientInstanceId':ID,'expiresAt':DT,'expired':{'type':'boolean'}}))
add('LeaseAcquire',obj({'kind':{'const':'acquire'},'clientInstanceId':ID}))
add('LeaseRenew',obj({'kind':{'const':'renew'},'control':ref('ControlProof')}))
add('LeaseTakeover',obj({'kind':{'const':'takeover'},'clientInstanceId':ID,'expectedLeaseEpoch':REV,'confirmed':{'const':True}}))
add('LeaseRequest',{'oneOf':[ref('LeaseAcquire'),ref('LeaseRenew'),ref('LeaseTakeover')]})
add('Suggestion',obj({'id':ID,'label':string(80,1),'utterance':string(1000,1)}))
add('Interaction',obj({'id':ID,'experienceRevision':REV,'kind':enum('setup','decision'),'suggestionState':enum('not_applicable','ready','unavailable'),'suggestions':array(ref('Suggestion'),4),'freeInputAllowed':{'type':'boolean'}}))
S['Interaction']['allOf']=[{'if':{'properties':{'kind':{'const':'setup'}}},'then':{'properties':{'suggestionState':{'const':'not_applicable'},'suggestions':{'maxItems':0},'freeInputAllowed':{'const':False}}},'else':{'properties':{'freeInputAllowed':{'const':True}},'oneOf':[{'properties':{'suggestionState':{'const':'ready'},'suggestions':{'minItems':2}}},{'properties':{'suggestionState':{'const':'unavailable'},'suggestions':{'maxItems':0}}}]}}]
add('ResponseDraft',obj({'id':ID,'interactionEventId':ID,'draftRevision':REV,'text':string(4000),'updatedAt':DT}))
add('Media',obj({'segmentId':ID,'assetId':ID,'contentUrl':string(500,1),'durationMs':integer(1,3600000),'aspectRatio':enum('16:9','9:16','1:1'),'audioAvailable':{'type':'boolean'},'validation':{'const':'passed'}}))
add('Money',obj({'amountMicros':string(19,1,pattern=r'^(0|[1-9][0-9]{0,18})$'),'currency':enum('CNY','USD')}))
add('BudgetSummary',obj({'limit':ref('Money'),'reserved':ref('Money'),'settled':ref('Money'),'unresolved':ref('Money')}))
add('AllowedActions',obj({x:{'type':'boolean'} for x in ['start','respond','pause','resume','retry','reconcile','delete']}))
add('Experience',obj({'id':ID,'storyVersionId':ID,'providerBindingVersionId':ID,'createdAt':DT,'updatedAt':DT,'deletedAt':nullable(DT),'revision':REV,'rowRevision':REV,'status':enum('preparing','generating','validating','playing','awaiting_input','paused','needs_attention','ended'),'schedulingPaused':{'type':'boolean'},'dispatchEpoch':integer(),'lastEventSequence':SEQ,'currentInteraction':nullable(ref('Interaction')),'responseDraft':nullable(ref('ResponseDraft')),'media':nullable(ref('Media')),'savedPositionMs':integer(0,3600000),'pendingOperationIds':array(ID,50),'budget':ref('BudgetSummary'),'allowedActions':ref('AllowedActions')}))
S['Experience']['properties'].update({'eventStreamId':ID,'eventCursor':CURSOR}); S['Experience']['required']+=['eventStreamId','eventCursor']
S['Experience']['properties']['controlSummary']=nullable(ref('ControlSummary')); S['Experience']['required'].append('controlSummary')
add('RecoveryTarget',obj({'turnId':ID,'operationId':nullable(ID),'allowedRetryModes':array(enum('local_recovery','new_attempt'),2),'reconcileRequired':{'type':'boolean'}}))
S['Experience']['properties']['recoveryTarget']=nullable(ref('RecoveryTarget')); S['Experience']['required'].append('recoveryTarget')
add('CreateExperience',obj({'storyVersionId':ID,'providerBindingVersionId':ID,'budgetLimit':ref('Money')}))
add('ChoiceResponse',obj({'kind':{'const':'choice'},'suggestionId':ID}))
add('FreeResponse',obj({'kind':{'const':'free'},'text':string(4000,1)}))
add('PlayerResponse',{'oneOf':[ref('ChoiceResponse'),ref('FreeResponse')]})
add('StartAction',obj({'kind':{'const':'start'},'expectedExperienceRevision':REV}))
add('IntentAction',obj({'kind':{'const':'intent'},'interactionEventId':ID,'expectedExperienceRevision':REV,'response':ref('PlayerResponse')}))
add('RetryAction',obj({'kind':{'const':'retry'},'turnId':ID,'expectedExperienceRevision':REV}))
add('QuotedAction',{'oneOf':[ref('StartAction'),ref('IntentAction'),ref('RetryAction')]})
add('QuoteRequest',obj({'action':ref('QuotedAction')}))
add('Quote',obj({'id':ID,'experienceId':ID,'actionHash':string(64,64,pattern='^[0-9a-f]{64}$'),'maxCost':ref('Money'),'expiresAt':DT,'inputAssetIds':array(ID,30),'providerBindingVersionId':ID,'pricingVersion':string(100,1),'includes':array(enum('planning','video','validation','asset_transfer','bounded_repair'),5)}))
add('QuotedInput',obj({'assetId':ID,'purpose':enum('opening','style','reference','character_identity'),'processingSummary':string(1000,1)}))
add('GenerationSummary',obj({'providerId':string(100,1),'modelId':string(200,1),'durationSeconds':integer(1,3600),'width':integer(1,32768),'height':integer(1,32768),'aspectRatio':enum('16:9','9:16','1:1'),'audioMode':enum('native','silent'),'promptSummary':string(2000,1),'inputs':array(ref('QuotedInput'),30)}))
S['Quote']['properties']['generationSummary']=ref('GenerationSummary'); S['Quote']['required'].append('generationSummary')
S['Quote']['properties']['executionProfileVersionId']=ID; S['Quote']['required'].append('executionProfileVersionId')
S['GenerationSummary']['properties']['width']=nullable(integer(1,32768))
S['GenerationSummary']['properties']['height']=nullable(integer(1,32768))
S['GenerationSummary']['properties']['dimensionMode']=enum('exact','provider_resolved')
S['GenerationSummary']['properties']['resolution']=string(80,1)
S['GenerationSummary']['required']+=['dimensionMode','resolution']
S['GenerationSummary']['allOf']=[{'if':{'properties':{'dimensionMode':{'const':'exact'}}},'then':{'properties':{'width':integer(1,32768),'height':integer(1,32768)}},'else':{'properties':{'width':{'type':'null'},'height':{'type':'null'}}}}]
add('StartRequest',obj({'control':ref('ControlProof'),'expectedExperienceRevision':REV,'acceptedQuoteId':ID}))
add('IntentRequest',obj({'control':ref('ControlProof'),'action':ref('IntentAction'),'expectedDraftRevision':REV,'acceptedQuoteId':ID}))
add('DraftUpdate',obj({'interactionEventId':ID,'expectedDraftRevision':REV,'expectedExperienceRevision':REV,'text':string(4000)}))
add('RetrySuggestionsRequest',obj({'control':ref('ControlProof'),'expectedExperienceRevision':REV}))
add('PauseRequest',obj({'control':ref('ControlProof'),'expectedRowRevision':REV,'draft':nullable(ref('DraftUpdate'))}))
add('ResumeRequest',obj({'control':ref('ControlProof'),'expectedRowRevision':REV}))
add('RetryLocal',obj({'mode':{'const':'local_recovery'},'control':ref('ControlProof'),'expectedExperienceRevision':REV}))
add('RetryNew',obj({'mode':{'const':'new_attempt'},'control':ref('ControlProof'),'expectedExperienceRevision':REV,'acceptedQuoteId':ID}))
add('RetryRequest',{'oneOf':[ref('RetryLocal'),ref('RetryNew')]})
add('TurnAccepted',obj({'experienceId':ID,'turnId':ID,'operationId':ID,'status':{'const':'accepted'},'statusUrl':string(500,1)}))
add('Operation',obj({'id':ID,'experienceId':ID,'turnId':ID,'status':enum('reserved','submitting','submission_unknown','accepted','running','succeeded','failed','cancel_requested','cancelled'),'providerTaskKnown':{'type':'boolean'},'mediaSegmentId':nullable(ID),'cost':obj({'reserved':ref('Money'),'settled':nullable(ref('Money')),'unresolved':{'type':'boolean'}}),'attentionCode':nullable(string(100)),'updatedAt':DT}))
add('OperationAccepted',obj({'operationId':ID,'status':{'const':'accepted'},'statusUrl':string(500,1)}))
add('PlaybackStart',obj({'control':ref('ControlProof'),'segmentId':ID}))
add('PlaybackInstance',obj({'id':ID,'segmentId':ID,'nextSequence':SEQ,'playbackRevision':REV}))
add('PlaybackReport',obj({'control':ref('ControlProof'),'segmentId':ID,'playbackInstanceId':ID,'sequence':SEQ,'positionMs':integer(0,3600000),'state':enum('playing','paused','completed')}))
add('PlaybackAck',obj({'acceptedSequence':SEQ,'playbackRevision':REV,'factCommitState':enum('not_requested','pending','committed','needs_attention'),'lastEventSequence':SEQ}))
add('CommandStatus',obj({'commandId':KEY,'state':{'const':'accepted'},'resourceType':enum('story','character','story_version','character_version','asset','binding','experience','quote','turn','operation','lease','playback_instance','response_draft'),'resourceId':ID,'originalHttpStatus':integer(200,299),'acceptedAt':DT}))
add('Deletion',obj({'id':ID,'deletedAt':DT,'revision':REV,'pendingOperationIds':array(ID,50)}))
add('EventEnvelope',{'oneOf':[]})
for typ,payload in [('experience.snapshot','Experience'),('operation.updated','Operation'),('response_draft.updated','ResponseDraft')]:
 name='Event'+''.join(x.title() for x in typ.split('.'))
 add(name,obj({'eventId':ID,'sequence':SEQ,'schemaVersion':{'const':1},'experienceId':ID,'occurredAt':DT,'type':{'const':typ},'payload':ref(payload)})); S['EventEnvelope']['oneOf'].append(ref(name))
 S[name]['properties']['eventStreamId']=ID; S[name]['required'].append('eventStreamId')
add('StreamReset',obj({'code':enum('CURSOR_EXPIRED','AUTH_REQUIRED'),'snapshotUrl':string(500,1)}))
for name in ['Story','Character','Asset','Experience','ProviderModel','ProviderBinding']:
 add(name+'Page',obj({'items':array(ref(name),100),'nextCursor':nullable(string(1000,1))}))
params={
 'IdempotencyKey':{'name':'Idempotency-Key','in':'header','required':True,'schema':KEY,'description':'Owner-scoped command ID. Same payload replays; a changed payload needs a new key.'},
 'IfMatch':{'name':'If-Match','in':'header','required':True,'schema':string(150,3,pattern='^"[^"]+"$'),'description':'One strong ETag from GET of the target aggregate. No wildcard/list/weak tags.'},
 'Limit':{'name':'limit','in':'query','schema':{'type':'integer','minimum':1,'maximum':100,'default':20}},
 'Cursor':{'name':'cursor','in':'query','schema':string(1000,1)},
 'Deleted':{'name':'deleted','in':'query','schema':enum('exclude','only'),'description':'Default exclude; only supports owner recycle-bin queries.'},
 'ClientInstance':{'name':'X-Client-Instance-Id','in':'header','required':True,'schema':ID},
}
def param(n): return {'$ref':f'#/components/parameters/{n}'}
errors={str(n):{'description':desc,'content':{'application/json':{'schema':ref('ApiError')}}} for n,desc in [(400,'Invalid request'),(401,'Authentication required'),(403,'Origin/CSRF/control permission rejected'),(404,'Missing or not visible to owner'),(409,'State or idempotency conflict'),(410,'Expired event cursor or removed media'),(412,'If-Match precondition failed'),(413,'Upload too large'),(415,'Unsupported media'),(422,'Valid syntax but invalid action/capability/quote'),(428,'Required precondition absent'),(429,'Rate limited'),(500,'Unexpected server error'),(503,'Temporarily unavailable') ]}
for code in ['429','503']:
 errors[code]['headers']={'Retry-After':{'description':'Bounded retry delay in integer seconds. Retry only the same accepted command identity.','schema':integer(1,3600)}}
def operation(path,method,oid,summary,out=None,body=None,status=200,etag=False,match=False,stage='M1',idem=True,extra=None,description=''):
 ps=[]
 import re
 for name in re.findall(r'{([^}]+)}',path):
  ps.append({'name':name,'in':'path','required':True,'schema':KEY if name=='commandId' else ID})
 mut=method not in ['get','head']
 if mut and idem:ps.append(param('IdempotencyKey'))
 if match:ps.append(param('IfMatch'))
 ps+=extra or []
 op={'operationId':oid,'summary':summary,'description':description or summary,'tags':[path.split('/')[1]],'x-stage':stage,'x-implemented':False,'x-idempotency':'command' if mut and idem else 'playback-sequence' if oid=='reportPlayback' else 'none','parameters':ps,'responses':dict(errors)}
 if mut:op['security']=[{'sessionCookie':[],'csrfToken':[]},{'desktopBearer':[]}]
 headers={'X-Request-Id':{'schema':string(100,1)},'Cache-Control':{'schema':{'const':'no-store'}}}
 if etag:headers['ETag']={'schema':string(150,3)}
 if mut and idem:headers['Idempotency-Replayed']={'schema':{'type':'boolean'}}
 op['responses'][str(status)]={'description':'Accepted; processing is not completion' if status==202 else 'Success','headers':headers}
 if out:op['responses'][str(status)]['content']={'application/json':{'schema':envelope(out)}}
 if body:op['requestBody']={'required':True,'content':{'application/json':{'schema':ref(body)}}}
 paths.setdefault(path,{})[method]=op
 return op
op=operation('/session/exchange','post','exchangeSession','用一次性本机启动材料建立会话','Session','ExchangeRequest',stage='M0',idem=False)
op['security']=[];op['responses']['200']['headers']['Set-Cookie']={'schema':string(1000,1)}
operation('/session','get','getSession','读取会话与CSRF材料','Session',stage='M0')
operation('/commands/{commandId}','get','getCommand','查询已接受命令，不再次执行','CommandStatus',stage='M1')
for plural,n,create,patch in [('stories','Story','CreateStory','PatchStory'),('characters','Character','CreateCharacter','PatchCharacter')]:
 operation('/'+plural,'get','list'+plural.title(),'分页读取'+plural,n+'Page',extra=[param('Limit'),param('Cursor'),param('Deleted')])
 operation('/'+plural,'post','create'+n,'创建'+n,n,create,201,etag=True)
 path='/'+plural+'/{id}'
 operation(path,'get','get'+n,'读取'+n,n,etag=True,extra=[{'name':'includeDeleted','in':'query','schema':{'type':'boolean','default':False}}])
 operation(path,'patch','update'+n,'修改'+n,n,patch,etag=True,match=True)
 operation(path,'delete','delete'+n,'逻辑删除'+n,'Deletion',match=True)
 operation(path+'/restore','post','restore'+n,'恢复'+n,n,etag=True,match=True)
 operation(path+'/versions','post','freeze'+n,'冻结当前修订或复用既有版本',n+'Version',status=200,match=True)
 version='story-versions' if n=='Story' else 'character-versions'
 operation('/'+version+'/{id}','get','get'+n+'Version','读取不可变版本',n+'Version')
operation('/assets','get','listAssets','分页读取素材','AssetPage',extra=[param('Limit'),param('Cursor'),param('Deleted')])
op=operation('/assets','post','uploadAsset','导入本机图片，不自动发送给模型','Asset',status=201,etag=True)
op['requestBody']={'required':True,'content':{'multipart/form-data':{'schema':ref('UploadAsset'),'encoding':{'metadata':{'contentType':'application/json'}}}}}
operation('/assets/{id}','get','getAsset','读取素材元数据','Asset',etag=True,extra=[{'name':'includeDeleted','in':'query','schema':{'type':'boolean','default':False}}])
operation('/assets/{id}','delete','deleteAsset','隐藏素材并禁止新引用；历史媒体保留','Deletion',match=True)
operation('/assets/{id}/restore','post','restoreAsset','恢复尚未进入回收的素材','Asset',match=True,etag=True)
op=operation('/assets/{id}/content','get','readAsset','读取受权媒体字节，支持单Range',stage='M1',extra=[{'name':'Range','in':'header','schema':string(100,1)},{'name':'If-Range','in':'header','schema':string(150,1)}])
for code in ['200','206']:
 op['responses'][code]={'description':'Media bytes','headers':{'Accept-Ranges':{'schema':{'const':'bytes'}},'Content-Range':{'schema':string(100)},'ETag':{'schema':string(150)}},'content':{'image/png':{'schema':{'type':'string','format':'binary'}},'image/jpeg':{'schema':{'type':'string','format':'binary'}},'image/webp':{'schema':{'type':'string','format':'binary'}},'video/mp4':{'schema':{'type':'string','format':'binary'}}}}
 op['responses'][code]['headers']['Cache-Control']={'schema':{'const':'private, no-store'}}
 if code=='200':del op['responses'][code]['headers']['Content-Range']
op['responses']['416']={'description':'Range not satisfiable','headers':{'Content-Range':{'schema':string(100,1)}}}
operation('/provider-models','get','listProviderModels','查询已登记的供应商和精确模型能力','ProviderModelPage',stage='M1',extra=[param('Limit'),param('Cursor')])
operation('/provider-bindings','get','listProviderBindings','读取供应商模型绑定版本','ProviderBindingPage',stage='M1',extra=[param('Limit'),param('Cursor')])
operation('/provider-bindings','post','createProviderBinding','按已登记模型创建绑定版本，不接受任意端点或密钥','ProviderBinding','CreateProviderBinding',201,stage='M1')
operation('/experiences','get','listExperiences','分页读取独立经历','ExperiencePage',stage='M1',extra=[param('Limit'),param('Cursor'),param('Deleted')])
operation('/experiences','post','createExperience','从固定设定创建经历；零模型调用','Experience','CreateExperience',201,etag=True,stage='M1')
operation('/experiences/{id}','get','getExperience','权威快照与同一数据库版本的事件cursor','Experience',etag=True,stage='M1',extra=[{'name':'includeDeleted','in':'query','schema':{'type':'boolean','default':False}}])
operation('/experiences/{id}','delete','deleteExperience','仅已暂停经历可逻辑删除，继续核对在途任务','Deletion',match=True,stage='M2')
operation('/experiences/{id}/restore','post','restoreExperience','恢复为暂停态，不恢复生成','Experience',etag=True,match=True,stage='M2')
operation('/experiences/{id}/control-lease','post','changeControlLease','获取/续租/显式接管控制权','ControlLease','LeaseRequest',stage='M2')
operation('/experiences/{id}/quotes','post','quoteAction','确定性费用上界和素材告知；不调用模型','Quote','QuoteRequest',201,stage='M2')
operation('/experiences/{id}/start','post','startExperience','明确费用确认后开始开场','TurnAccepted','StartRequest',202,stage='M2')
operation('/experiences/{id}/intents','post','submitIntent','片段结束后消费一个有效回应节点','TurnAccepted','IntentRequest',202,stage='M3')
operation('/experiences/{id}/response-draft','put','saveResponseDraft','独立草稿CAS；不消费节点、不生成','ResponseDraft','DraftUpdate',stage='M1')
operation('/experiences/{id}/interactions/{interactionId}/suggestions/retry','post','retrySuggestions','只从已持久提案重试本地建议解析；不新增模型调用','Interaction','RetrySuggestionsRequest',stage='M3')
operation('/experiences/{id}/pause','post','saveAndPause','原子保存草稿并阻止新增生成','Experience','PauseRequest',etag=True,stage='M2')
operation('/experiences/{id}/resume','post','resumeExperience','恢复控制与待处理工作，不重提未知任务','Experience','ResumeRequest',etag=True,stage='M2')
operation('/experiences/{id}/turns/{turnId}/retry','post','retryTurn','恢复原回合；新付费尝试需新的有效报价','TurnAccepted','RetryRequest',202,stage='M2')
operation('/operations/{id}','get','getOperation','读取任务/费用；所属经历删除后仍可核对','Operation',stage='M2')
operation('/operations/{id}/reconcile','post','reconcileOperation','仅查询/核对既有操作，不创建新视频','OperationAccepted',status=202,stage='M2')
operation('/experiences/{id}/playback-instances','post','createPlaybackInstance','取得当前片段播放实例，旧实例失效','PlaybackInstance','PlaybackStart',201,stage='M3')
operation('/experiences/{id}/playback','post','reportPlayback','序号幂等播放进度；完成证据不是直接写事实','PlaybackAck','PlaybackReport',stage='M3',idem=False)
op=operation('/experiences/{id}/events','get','streamExperienceEvents','可重放领域事件；不传视频帧',stage='M2',extra=[{'name':'after','in':'query','schema':CURSOR},{'name':'Last-Event-ID','in':'header','schema':CURSOR}])
op['responses']['200']={'description':'SSE: id=eventStreamId:sequence; event=domain; data=EventEnvelope. Non-durable stream.reset uses StreamReset without id. Heartbeats are comments.','content':{'text/event-stream':{'schema':{'type':'string'}}},'headers':{'Cache-Control':{'schema':{'const':'no-store'}},'X-Accel-Buffering':{'schema':{'const':'no'}}}}
op['x-event-schema']=ref('EventEnvelope');op['x-reset-schema']=ref('StreamReset')
doc={'openapi':'3.1.1','info':{'title':'未完 V1 API contract','version':'1.0.0','description':'Implementation baseline for review. None of these /api/v1 endpoints are claimed implemented. No physical DB foreign keys; reviewed true uniqueness. See CONTRACT.md.'},'servers':[{'url':'/api/v1'}],'security':[{'sessionCookie':[]},{'desktopBearer':[]}],'paths':paths,'components':{'schemas':S,'parameters':params,'securitySchemes':{'sessionCookie':{'type':'apiKey','in':'cookie','name':'weiwan_session'},'csrfToken':{'type':'apiKey','in':'header','name':'X-CSRF-Token'},'desktopBearer':{'type':'http','scheme':'bearer','description':'Host-issued short-lived application token, never a provider API key.'}}}}
(ROOT/'openapi.json').write_text(json.dumps(doc,ensure_ascii=False,indent=2)+'\n')
rows=['| 方法 | 路径（前缀 /api/v1） | 操作 | 阶段 |','|---|---|---|---|']
for p,methods in paths.items():
 for m,o in methods.items():rows.append(f'| {m.upper()} | `{p}` | {o["summary"]} | {o["x-stage"]} |')
(ROOT/'ENDPOINTS.md').write_text('# API接口清单\n\n由build_contract.py生成；全量机器定义见[OpenAPI](openapi.json)，语义见[契约](CONTRACT.md)。阶段是实施安排，不表示接口已存在。\n\n'+'\n'.join(rows)+'\n')
print(len(paths),'paths',sum(map(len,paths.values())),'operations',len(S),'schemas')
