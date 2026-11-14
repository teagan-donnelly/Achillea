export interface Patient {id:string;name:string;room:string;unit:string;summary:string;nurseId:string;repositionPlan:boolean}
export interface Task {id:string;patientId:string;title:string;type:string;status:string;priority:string;source:string;dueAt:string;verificationRequired:boolean;deferReason:string|null;order:number;completedAt:string|null;verifiedBy:string|null}
export interface Vital {id:string;patientId:string;metric:string;value:number;unit:string;observedAt:string;receivedAt:string;source:string;sourceEventId:string;quality:string}
export interface Movement {id:string;patientId:string;classification:string;quality:string;verificationStatus:string;reviewerId:string|null;reviewedAt:string|null;chestBefore:number;pelvisBefore:number;chestAfter:number;pelvisAfter:number;capturedAt:string;sampleIds:string[]}
export interface Chart {id:string;patientId:string;nurseId:string;type:string;text:string;status:string;linkedTaskId:string|null;linkedMovementId:string|null;linkedVitalIds:string[];authoredAt:string;confirmedAt:string|null;amendmentOfId:string|null;provenance:string}
export interface Event {id:string;patientId:string|null;type:string;source:string;details:string;timestamp:string}
export interface State {patients:Patient[];tasks:Task[];vitals:Vital[];movements:Movement[];charts:Chart[];events:Event[]}
export interface Round {task:Task;reason:string;rank:number}
