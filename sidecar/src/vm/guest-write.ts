// All path operations stay relative to pinned directory fds, including cleanup.
export const GUEST_WRITE_COMMAND = `import os,sys,stat,secrets
root,path=sys.argv[1:3]
if '\\x00' in path or not path.startswith(root+'/') or any(p in ('','.', '..') for p in path[len(root)+1:].split('/')): raise ValueError('invalid path')
flags=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW
fd=os.open('/',flags)
tmp=None
backup=None
try:
 for part in root.strip('/').split('/')+path[len(root)+1:].split('/')[:-1]:
  try: os.mkdir(part,0o700,dir_fd=fd);os.fsync(fd)
  except FileExistsError: pass
  nextfd=os.open(part,flags,dir_fd=fd)
  os.close(fd);fd=nextfd
 name=path.rsplit('/',1)[1]
 def validate():
  try:
   st=os.stat(name,dir_fd=fd,follow_symlinks=False)
   if not stat.S_ISREG(st.st_mode) or st.st_nlink!=1: raise ValueError('unsafe target')
  except FileNotFoundError: pass
 # Image 6 staged credentials as a symlink into a read-only host mount.
 if path in ('/workspace/.home/.codex/auth.json','/workspace/.home/.claude/.credentials.json'):
  try:
   legacy=os.readlink(name,dir_fd=fd)
   expected='/run/touri-auth/'+('codex' if '/.codex/' in path else 'opencode' if '/opencode/' in path else 'claude')+'.json'
   if legacy==expected: os.unlink(name,dir_fd=fd)
  except OSError: pass
 validate()
 tmp='.touri-'+secrets.token_hex(16)+'.tmp'
 out=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=fd)
 try:
  while True:
   data=sys.stdin.buffer.read(65536)
   if not data: break
   view=memoryview(data)
   while view:
    written=os.write(out,view)
    if written<=0: raise OSError('short write')
    view=view[written:]
  os.fsync(out)
 finally: os.close(out)
 validate();os.fsync(fd)
 try:
  old=os.stat(name,dir_fd=fd,follow_symlinks=False)
  backup='.touri-'+secrets.token_hex(16)+'.bak'
  os.link(name,backup,src_dir_fd=fd,dst_dir_fd=fd,follow_symlinks=False)
  saved=os.stat(backup,dir_fd=fd,follow_symlinks=False)
  if (old.st_dev,old.st_ino)!=(saved.st_dev,saved.st_ino): raise ValueError('target changed')
 except FileNotFoundError: pass
 os.rename(tmp,name,src_dir_fd=fd,dst_dir_fd=fd);tmp=None
 try: os.fsync(fd)
 except OSError:
  if backup is not None: os.rename(backup,name,src_dir_fd=fd,dst_dir_fd=fd);backup=None
  else: os.unlink(name,dir_fd=fd)
  raise
finally:
 if tmp is not None: os.unlink(tmp,dir_fd=fd)
 if backup is not None: os.unlink(backup,dir_fd=fd)
 os.close(fd)`
