// A regular guest user runs one shell in its own process group. Output and lifetime
// are bounded in the guest, even if the host's container-exec connection disappears.
export const guestShell = `import os,sys,json,time,signal,subprocess,selectors
marker=sys.argv[1]
proc=subprocess.Popen(['/bin/sh','-lc',sys.argv[2]],stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
try:
 started=open('/proc/%s/stat'%proc.pid).read().rsplit(')',1)[1].split()[19]
 fd=os.open(marker,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'w') as f: json.dump(dict(pid=proc.pid,started=started),f)
 poll=selectors.DefaultSelector()
 poll.register(proc.stdout,selectors.EVENT_READ,0)
 poll.register(proc.stderr,selectors.EVENT_READ,1)
 output=[bytearray(),bytearray()]
 deadline=time.monotonic()+25
 timedout=False
 while poll.get_map():
  if time.monotonic()>deadline:
   try: os.killpg(proc.pid,signal.SIGKILL)
   except ProcessLookupError: pass
   timedout=True
   break
  for key,events in poll.select(.1):
   data=os.read(key.fileobj.fileno(),4096)
   if not data: poll.unregister(key.fileobj)
   else: output[key.data].extend(data[:max(0,65536-len(output[key.data]))])
 code=proc.wait(timeout=1)
 print(json.dumps(dict(stdout=output[0].decode('utf-8','replace'),stderr=output[1].decode('utf-8','replace')+('\\nTempo limite de 25 s.' if timedout else ''),code=code),ensure_ascii=False))
finally:
 try: os.killpg(proc.pid,signal.SIGKILL)
 except ProcessLookupError: pass
 try: os.unlink(marker)
 except FileNotFoundError: pass`

// Validate Linux process start time before killing the group so a reused PID is never targeted.
export const cancelGuestShell = `import os,sys,json,time,signal
for attempt in range(10):
 try:
  with open(sys.argv[1]) as f: job=json.load(f)
  pid=job['pid']
  started=open('/proc/%s/stat'%pid).read().rsplit(')',1)[1].split()[19]
  if started==job['started'] and os.getpgid(pid)==pid: os.killpg(pid,signal.SIGKILL)
  break
 except FileNotFoundError: time.sleep(.1)
 except ProcessLookupError: break
try: os.unlink(sys.argv[1])
except FileNotFoundError: pass`
