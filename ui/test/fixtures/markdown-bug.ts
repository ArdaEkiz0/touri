// Verbatim message from markdown-bug.png, with the original Markdown boundaries restored.
export const screenshotSegments = [
  "Vou inspecionar os links públicos e visitar duas rotas reais, capturando cada tela na VM.",
  "Os links legais existem, mas o clique automático falhou na verificação do alvo. Vou conferir pela tela.",
  "A captura do computador e o último clique ainda aguardam resposta da VM. Nenhum formulário foi enviado.",
  "O link do rodapé abriu /terms. Há uma divergência: a home anuncia chave própria; os termos descrevem créditos de IA vendidos pela plataforma.",
  "Visitei três rotas reais; as capturas de /terms e /privacy estão inline acima.\n\n| URL | Título | Primeiro botão |\n|---|---|---|\n| https://touri.ai/ | touri.ai — Sua equipe de IA, em um só lugar | Entrar na waitlist |\n| https://touri.ai/terms | Termos de Uso — Touri | Sem elemento button; primeira ação com aparência de botão: “Entrar” |\n| https://touri.ai/privacy | Política de Privacidade — Touri.ai | Sem elemento button; primeira ação com aparência de botão: “Entrar” |\n\nNavegação confirmada: home → “Termos de Uso” no rodapé → /terms → “Política de Privacidade” no texto → /privacy.\n\nProblemas observados:\n- Home anuncia chave própria e consumo pago diretamente ao provedor; termos descrevem venda de créditos e intermediação via OpenRouter.\n- Política repete Vercel na lista de terceiros.\n- Política declara ausência de analytics de terceiros; na home houve tentativa de carregar Cloudflare Insights, bloqueada pela CSP. Não confirmei coleta.\n- Cliques pela ferramenta de navegador falharam com TARGET_CHANGED; os mesmos links funcionaram pelo computador da VM. A aba permanece aberta em /privacy.\n\nNenhum formulário foi preenchido ou enviado; não fiz login nem escrevi o relatório.",
]

export const screenshotJoined = screenshotSegments.join("").replace(/\n- /g, " · ").replace(/\n+/g, " ")
