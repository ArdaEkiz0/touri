# MCP e permissões do bot

Em **Permissões do bot**, cada servidor MCP externo anuncia suas ferramentas. A
classificação pode ser **Leitura** ou **Escrita**, e a política pode ser **Sempre
permitir**, **Pedir aprovação** ou **Bloquear**. Ferramentas sem indicação de
leitura começam como escrita e pedem aprovação. A classificação anunciada pelo
servidor é uma sugestão; confira o comportamento da ferramenta antes de permitir
suas chamadas automaticamente.

O sidecar encaminha as ferramentas externas pelo servidor MCP do touri. Os CLIs
recebem somente esse servidor, inclusive em máquinas de bots. As políticas são
verificadas em cada chamada, após uma aprovação e depois da conexão,
imediatamente antes do envio. Uma aprovação aberta perde a validade quando
sua conexão ou política muda e não cria uma permissão permanente para a nova
configuração. Ferramentas
bloqueadas não são anunciadas; chamadas diretas também são recusadas. Bots
somente leitura não podem chamar ferramentas classificadas como escrita.

Os cartões no chat oferecem **Aprovar uma vez**, **Sempre para esta ferramenta
neste bot** e **Negar**. A concessão permanente pertence ao bot, ao tipo de
integração e à ferramenta; para MCP, também pertence ao servidor. Ela aparece em
**Permissões permanentes**, onde pode ser revogada. Alterar a política de uma
ferramenta revoga sua concessão. Desconectar ou substituir a conexão de um
servidor revoga suas concessões. Revalidar a mesma conexão preserva as políticas.

Controle do computador e pedidos de permissão do Claude usam a mesma ponte.
Perguntas do Claude não aceitam concessões permanentes. O controle do Mac mantém
os requisitos de Acessibilidade e Gravação de Tela, a janela de controle, a
exclusão entre bots e o interruptor de emergência. Uma concessão permanente não
reativa o controle após o interruptor de emergência.

Com acesso total, **Codex executa sem pedir aprovação e sem sandbox**:
`danger-full-access` com `approvalPolicy: never` no app-server, tanto ao criar
quanto ao retomar uma sessão. A opção de acesso total com aprovação está
disponível para Claude. Codex somente leitura continua em `read-only` com
sandbox. As políticas MCP e de controle do computador são aplicadas pelo touri
em todos os modos de acesso.

As políticas usam `bot_mcp_servers.config_json`; concessões usam entradas
privadas de `settings` por bot. Não há migração de banco. Aprovações pendentes
são transitórias e terminam com recusa ao cancelar ou encerrar a execução.
