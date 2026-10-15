export const pairingPageHtml = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>touri - conectar este dispositivo</title>
<style>
:root{color-scheme:light dark;--bg:#fafaf9;--fg:#1c1917;--muted:#78716c;--card:#fff;--line:#e7e5e4;--red:#dc2626}
@media (prefers-color-scheme:dark){:root{--bg:#0c0a09;--fg:#fafaf9;--muted:#a8a29e;--card:#1c1917;--line:#292524}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{width:min(26rem,calc(100vw - 2rem));background:var(--card);border:1px solid var(--line);border-radius:14px;padding:2rem}
h1{margin:0 0 .25rem;font-size:1.5rem;letter-spacing:-.02em}
h1 span{color:var(--red)}
p{margin:.25rem 0 1.25rem;color:var(--muted);font-size:.95rem}
label{display:block;font-size:.8rem;font-weight:600;margin-bottom:.4rem}
input{width:100%;padding:.75rem .9rem;font:600 1.2rem ui-monospace,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg)}
input:focus-visible{outline:2px solid var(--red);outline-offset:1px}
button{margin-top:1rem;width:100%;padding:.75rem;border:0;border-radius:8px;background:var(--red);color:#fff;font:600 1rem system-ui,sans-serif;cursor:pointer}
button:disabled{opacity:.6;cursor:wait}
.err{margin-top:.9rem;color:var(--red);font-size:.9rem;min-height:1.3rem}
code{font:.85rem ui-monospace,Menlo,monospace;background:var(--bg);padding:.1rem .35rem;border-radius:4px}
</style>
</head>
<body>
<main>
<h1>touri<span>.</span></h1>
<p>Digite o código de pareamento para usar este servidor neste navegador. No servidor, rode <code>touri pair</code> (o código vale 5 minutos e só pode ser usado uma vez).</p>
<form id="f" autocomplete="off">
<label for="code">Código de pareamento</label>
<input id="code" name="code" inputmode="text" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX" maxlength="14" required autofocus>
<button id="b" type="submit">Conectar este dispositivo</button>
<div class="err" id="e" role="alert"></div>
</form>
</main>
<script>
var f=document.getElementById("f"),c=document.getElementById("code"),b=document.getElementById("b"),e=document.getElementById("e");
f.addEventListener("submit",function(ev){
ev.preventDefault();b.disabled=true;e.textContent="";
fetch("/pair",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({code:c.value,name:navigator.userAgent.slice(0,80)})})
.then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j}})})
.then(function(x){if(x.ok){location.replace("/");return}e.textContent=x.j.error||"Não foi possível conectar";b.disabled=false})
.catch(function(){e.textContent="Não foi possível falar com o servidor";b.disabled=false});
});
</script>
</body>
</html>
`
