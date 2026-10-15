# Conta web no sandbox

Use `TOURI_CLOUD_ENABLED=1`, `TOURI_CLOUD_BASE_URL` (origin cloud sandbox) e `TOURI_CLOUD_WEB_ORIGIN` (padrão `https://staging.touri.ai`). Também configuráveis nas preferências `cloud`, `cloudBaseUrl`, `cloudWebOrigin`. HTTP só em loopback. A API permanece no origin cloud; os links públicos são `/parear?code=…` e `/conta` no origin web configurado. Nunca configure um origin de produção.

Entrar abre o navegador do sistema, mostra somente o código curto e consulta a autorização a cada cinco segundos. A conta/assinatura é atualizada a cada cinco segundos enquanto a tela está aberta. Sair revoga o dispositivo antes de apagar os tokens do Keychain. O modo headless existente usa armazenamento AES-GCM; o Mac usa Keychain.

Provisionamento e ciclo de vida usam as APIs v1 existentes. Capacidades sem runtime/desktop/exec escondem tela e terminal e mostram “Execução na nuvem chega em breve”. Não há execução simulada.

O harness local e as instruções de preview ficam no repositório do serviço web correspondente.

A consulta de operações usa backoff de 250 ms até dois segundos, para respeitar o orçamento de leitura durante provisionamentos demorados.
