#!/usr/bin/env python3
"""Synthetic smoke client. Reads only a development integration key from the environment."""
import argparse, datetime, json, math, os, urllib.request, urllib.parse, uuid

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--base-url',default='http://127.0.0.1:8080')
    parser.add_argument('--encounter',required=True)
    parser.add_argument('--patient',required=True)
    parser.add_argument('--source',default='simulator-001')
    args=parser.parse_args()
    key=os.environ.get('SIMULATION_API_KEY')
    if not key: parser.error('Set SIMULATION_API_KEY in this process environment')
    def request(path,body=None):
        data=None if body is None else json.dumps(body).encode()
        req=urllib.request.Request(args.base_url.rstrip('/')+'/api/integrations/simulation/v1'+path,data=data,headers={'Content-Type':'application/json','X-Simulation-Key':key})
        with urllib.request.urlopen(req,timeout=30) as response: return json.load(response)
    def region(angle):
        rad=math.radians(angle)
        return dict(ax=0,ay=math.sin(rad),az=math.cos(rad),gx=0,gy=0,gz=0)
    start=datetime.datetime.now(datetime.timezone.utc)
    body=dict(schemaVersion=1,encounterId=args.encounter,sourceId=args.source,runId='smoke-'+str(uuid.uuid4()),timeScale=60,samples=[dict(eventId='sample-'+str(i),timestamp=(start+datetime.timedelta(seconds=i*2)).isoformat(),chest=region(i*40),pelvis=region(i*40)) for i in range(2)])
    ack=request('/observations',body)
    assert ack['patientId']==args.patient and ack['accepted']==2,ack
    replay=request('/observations',body)
    assert replay['duplicates']==2 and replay['accepted']==0,replay
    query=urllib.parse.urlencode(dict(encounterId=args.encounter,sourceId=args.source,after=0,limit=100))
    evidence=request('/processed?'+query)
    assert evidence['patientId']==args.patient,evidence
    receipts={r['id'] for r in evidence['items']}
    wanted={r['receiptId'] for r in ack['results']}
    while not wanted <= receipts and evidence['hasMore']:
        query=urllib.parse.urlencode(dict(encounterId=args.encounter,sourceId=args.source,after=evidence['nextAfter'],limit=500))
        evidence=request('/processed?'+query)
        receipts.update(r['id'] for r in evidence['items'])
    assert wanted <= receipts,'Processed receipts were not found'
    print(json.dumps(dict(patientId=ack['patientId'],encounterId=ack['encounterId'],runId=ack['runId'],accepted=ack['accepted'],replayedDuplicates=replay['duplicates'],processedRecords=len(evidence['items'])),indent=2))
if __name__=='__main__': main()
