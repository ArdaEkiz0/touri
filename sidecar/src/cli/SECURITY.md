# Acesso servido

O pareamento e o acesso remoto exigem HTTPS. Uma conexão HTTP recebida fora de loopback retorna `426 HTTPS_REQUIRED`; cabeçalhos de proxy enviados diretamente pela rede não habilitam HTTPS.

Use `touri serve --host 127.0.0.1 --tailscale` para publicar com Tailscale Serve. Para outro proxy HTTPS confiável, use `touri serve --host 127.0.0.1 --trust-proxy`. O proxy deve substituir `Host`, `X-Forwarded-Host`, `X-Forwarded-Proto` e `X-Forwarded-For` por valores verificados (um único IP de origem). Apenas peers de loopback podem fornecer esses cabeçalhos. Proteja a configuração e o acesso local ao proxy; processos locais continuam no limite de confiança do host. O servidor deve permanecer inacessível diretamente pela rede.

Cookies usam `Secure` em HTTPS. Tokens de dispositivo expiram no servidor após 30 dias, incluindo tokens antigos. `POST /api/v1/session/rotate` renova um token ainda válido e invalida o anterior atomicamente. Navegadores recebem o novo cookie; clientes bearer recebem o novo token no JSON e devem salvá-lo. Ao expirar, pareie novamente. Revogação, expiração e rotação encerram conexões e sessões associadas em até 250 ms, inclusive quando a revogação vem de outro processo CLI.

WebSockets usam tickets de uso único, válidos por 15 segundos e restritos ao endpoint. A UI obtém um ticket novo por conexão via `POST /api/v1/ws-ticket`. Cookies de dispositivos continuam aceitos para clientes servidos. Credenciais reutilizáveis em query strings são recusadas.

Uploads recebem `{ name, dataBase64 }`, com limite de 15 MB. Caminhos do host não são aceitos pela API: a seleção no navegador/WebView envia bytes. Arrastar caminhos pelo evento nativo antigo requer uma futura integração de grants emitidos pelo shell. Arquivos não raster são baixados com sandbox, nosniff e no-store; o MIME informado por fontes de importação não é confiável.
