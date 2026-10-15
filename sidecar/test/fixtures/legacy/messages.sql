PRAGMA journal_mode = WAL;
CREATE TABLE messages (
  thread_id TEXT NOT NULL,
  id TEXT NOT NULL,
  at INTEGER NOT NULL,
  role TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  json TEXT NOT NULL,
  PRIMARY KEY (thread_id, id)
);
CREATE TABLE thread_state (thread_id TEXT PRIMARY KEY, active_leaf_id TEXT NOT NULL);
INSERT INTO messages VALUES
('thread-mark-main-0000000000000000000001','m01',1760000000001,'user','text','Start the campaign','{"id":"m01","at":1760000000001,"parentId":null,"role":"user","kind":"text","text":"Start the campaign"}'),
('thread-mark-main-0000000000000000000001','m02',1760000000002,'bot','text','Campaign started','{"id":"m02","at":1760000000002,"parentId":"m01","role":"bot","kind":"text","text":"Campaign started"}'),
('thread-mark-main-0000000000000000000001','m03',1760000000003,'bot','digest','','{"id":"m03","at":1760000000003,"parentId":"m02","role":"bot","kind":"digest","digest":{"turnId":"turn-1","durationMs":20,"toolCalls":1,"reply":"Campaign started","usage":{"input":10,"output":4}}}'),
('thread-mark-main-0000000000000000000001','m04',1760000000004,'user','text','Use the red launch plan','{"id":"m04","at":1760000000004,"parentId":"m03","role":"user","kind":"text","text":"Use the red launch plan"}'),
('thread-mark-main-0000000000000000000001','m05',1760000000005,'bot','activity','','{"id":"m05","at":1760000000005,"parentId":"m04","role":"bot","kind":"activity","tool":{"name":"campaign_check","summary":"Checked campaign","input":"{}","ok":true,"output":"ok"}}'),
('thread-mark-main-0000000000000000000001','m06',1760000000006,'bot','options','','{"id":"m06","at":1760000000006,"parentId":"m04","role":"bot","kind":"options","options":["approve","deny"]}'),
('thread-mark-chat-0000000000000000000002','m07',1760000000007,'user','text','Continue the branch','{"id":"m07","at":1760000000007,"parentId":null,"role":"user","kind":"text","text":"Continue the branch"}'),
('thread-mark-chat-0000000000000000000002','m08',1760000000008,'bot','compaction','','{"id":"m08","at":1760000000008,"parentId":"m07","role":"bot","kind":"compaction","compaction":{"summary":"Branch summary","by":"system"}}'),
('thread-onb-main-0000000000000000000003','m09',1760000000009,'user','text','Hello onboarding','{"id":"m09","at":1760000000009,"parentId":null,"role":"user","kind":"text","text":"Hello onboarding"}'),
('thread-onb-main-0000000000000000000003','m10',1760000000010,'bot','text','Welcome aboard','{"id":"m10","at":1760000000010,"parentId":"m09","role":"bot","kind":"text","text":"Welcome aboard"}'),
('thread-panko-main-0000000000000000000004','m11',1760000000011,'user','text','Review this image','{"id":"m11","at":1760000000011,"parentId":null,"role":"user","kind":"text","text":"Review this image","attachments":[{"kind":"image","path":"attachments/valid.png","mime":"image/png"}]}'),
('thread-panko-main-0000000000000000000004','m12',1760000000012,'bot','text','Image reviewed','{"id":"m12","at":1760000000012,"parentId":"m11","role":"bot","kind":"text","text":"Image reviewed","attachments":[{"kind":"image","path":"/tmp/outside-attachment.png","mime":"image/png"}]}'),
('thread-panko-task-0000000000000000000005','m13',1760000000013,'bot','routine.run','','{"id":"m13","at":1760000000013,"parentId":null,"role":"bot","kind":"routine.run","routineRun":{"runId":"routine-run-mark-000000000000000000001","routineId":"routine-mark-0000000000000000000001","routineName":"Daily campaign check","status":"succeeded"}}'),
('thread-panko-task-0000000000000000000005','m14',1760000000014,'bot','options','','{"id":"m14","at":1760000000014,"parentId":"m13","role":"bot","kind":"options","options":["keep","discard"]}');
INSERT INTO thread_state VALUES
('thread-mark-main-0000000000000000000001','m05'),
('thread-mark-chat-0000000000000000000002','m08'),
('thread-onb-main-0000000000000000000003','m10'),
('thread-panko-main-0000000000000000000004','m12'),
('thread-panko-task-0000000000000000000005','m14');
