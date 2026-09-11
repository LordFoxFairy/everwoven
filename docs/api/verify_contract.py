"""Validate review artifacts, not live HTTP/DB/provider behavior.
Run with jsonschema and openapi-spec-validator installed in the review environment.
"""
import json
import subprocess
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker
from openapi_spec_validator import validate
ROOT=Path(__file__).resolve().parent
spec=json.loads((ROOT/'openapi.json').read_text())
validate(spec)
checks=0
def check(condition,message):
    global checks
    if not condition: raise AssertionError(message)
    checks+=1

def walk_refs(value):
    if isinstance(value,dict):
        if '$ref' in value:
            target=value['$ref']; check(target.startswith('#/'),'external reference')
            resolved=spec
            for segment in target[2:].split('/'):
                resolved=resolved[segment.replace('~1','/').replace('~0','~')]
        for child in value.values():walk_refs(child)
    elif isinstance(value,list):
        for child in value:walk_refs(child)
walk_refs(spec)
fixtures=json.loads((ROOT/'examples.json').read_text())
for example in fixtures:
    schema={'$ref':'#/components/schemas/'+example['schema'],'components':spec['components']}
    validator=Draft202012Validator(schema,format_checker=FormatChecker())
    errors=list(validator.iter_errors(example['data']))
    check((not errors)==example['valid'],f"{example['name']}: {[e.message for e in errors]}")
ids=set(); count=0
for path,methods in spec['paths'].items():
    for method,op in methods.items():
        count+=1
        check(op['operationId'] not in ids,'duplicate operationId');ids.add(op['operationId'])
        check(op['x-implemented'] is False,'unverified implementation claim')
        if method!='get' and op['operationId'] not in ['exchangeSession','reportPlayback']:
            check(any(p.get('$ref','').endswith('/IdempotencyKey') for p in op['parameters']),'mutation missing idempotency')
        if method=='delete':
            check('requestBody' not in op,'DELETE has body')
            check(any(p.get('$ref','').endswith('/IfMatch') for p in op['parameters']),'delete missing CAS')
        if method!='get' and op['operationId']!='exchangeSession':
            check(op['security']==[{'sessionCookie':[],'csrfToken':[]},{'desktopBearer':[]}],'write auth differs')
check(count==47 and len(spec['paths'])==36,'endpoint inventory drift: update reviewed counts')
check(spec['paths']['/provider-models']['get']['x-stage']=='M1','M1 binding missing catalog')
for name,schema in spec['components']['schemas'].items():
    if name not in ['ControlProof','ControlLease']:
        check('controlToken' not in schema.get('properties',{}),'control secret in unrelated response')
    check(not({'apiKey','ownerId','baseUrl','credentialValue'} & schema.get('properties',{}).keys()),'unapproved privileged field')
# Check authoring generation is deterministic and committed artifacts match the generator.
before={p:p.read_bytes() for p in [ROOT/'openapi.json',ROOT/'ENDPOINTS.md']}
subprocess.run(['python3',str(ROOT/'build_contract.py')],check=True)
for p,content in before.items():check(content==p.read_bytes(),f'generated artifact drift: {p.name}')
print(f'PASS OpenAPI {spec["openapi"]}; {len(fixtures)} schema fixtures; {count} operations; {checks} reference/structural assertions')
print('NOT VERIFIED: live routes, auth implementation, transactions, replay races, provider billing, player integration.')
