# Painel administrativo — relatório de implementação

## Arquitetura e acesso

A aplicação existente usa Express 5, Prisma e PostgreSQL. A API administrativa já autentica JWT Bearer e valida se o administrador continua habilitado em cada solicitação. O painel é uma interface estática na mesma origem, servida pelo Express em `/admin/`. A raiz `/` redireciona para esse endereço. Não há segundo servidor de aplicação, CORS novo ou acesso direto ao banco pelo navegador.

Em desenvolvimento, execute `npm run dev`. Para executar o resultado compilado, use `npm run build` e `npm start`. Abra `/admin/` na URL da própria aplicação e entre com um administrador existente. Não foi criado administrador de produção.

O build compila o backend existente e copia HTML, CSS, JavaScript, Lucide e Inter para `dist/public/admin`. O hook `predev` também prepara os assets locais. Não há dependência de CDN para ícones ou fontes. As licenças dos assets acompanham os arquivos distribuídos.

## Funcionalidades e endpoints reais

Todos os caminhos abaixo usam o prefixo `/api/v1`.

| Função | Endpoint existente |
| --- | --- |
| Login administrativo | `POST /auth/login` |
| Dashboard e listagem de clientes | `GET /clients?page=…&limit=100` |
| Produtos para associação e elegibilidade | `GET /products?page=…&limit=100` |
| Listagem de instalações | `GET /installations?page=…&limit=100` |
| Criar instalação | `POST /installations` |
| Listagem de licenças | `GET /licenses?page=…&limit=100` |
| Criar licença | `POST /licenses` |
| Suspender licença | `POST /licenses/:id/suspend` |
| Reativar licença | `POST /licenses/:id/reactivate` |
| Renovar licença | `POST /licenses/:id/renew` |
| Auditoria | `GET /events` com paginação, tipo, UUID da instalação/licença e intervalo de datas |
| Logout | Descarte local da sessão; a API atual não possui endpoint de logout |

A sidebar contém Dashboard, Clientes, Instalações, Licenças e Auditoria. O dashboard apresenta totais, distribuição dos cinco status e vencimentos nos próximos sete dias. As listagens têm pesquisa, filtros e páginas de 20 registros. Licenças incluem detalhes, datas, observações e acesso à auditoria. A auditoria usa paginação e filtros no servidor, sem exibir metadata arbitrária.

Os formulários respeitam os campos e limites existentes: validade de 1 a 3650 dias, tolerância de 0 a 365 dias, identificador opcional da instalação, seleção de cliente/produto habilitado e instalações habilitadas sem licença para emissão. Erros de negócio continuam sendo decididos pela API. A interface bloqueia envio repetido enquanto uma operação está pendente.

## Status e regras preservadas

ACTIVE, GRACE, SUSPENDED, EXPIRED e REVOKED são visíveis. A listagem existente fornece status administrativo e datas, não o resultado atual da validação pública. Por isso, o painel identifica explicitamente seu status como estimado: aplica a prioridade REVOKED, suspensão administrativa ou cadastro desabilitado, início futuro, vencimento e tolerância. O status administrativo também é mostrado separadamente.

O cálculo usa o relógio do navegador e os dados da última atualização. A validação assinada do servidor permanece a autoridade. O painel não chama `/license/validate`, não precisa do segredo de instalações existentes e não gera eventos artificiais de validação. O cálculo visual é atualizado a cada minuto nas telas de dashboard/licenças.

Renovar uma licença suspensa mantém sua suspensão; reativar não altera suas datas. Estas regras continuam nos serviços existentes. Não foi implementada ação de revogação na interface.

## Segurança e sessão

- JWT apenas na memória da página; não é colocado em URL, localStorage, sessionStorage ou cookies.
- Logout, expiração, rejeição HTTP 401 e saída da página limpam sessão e dados locais. Reabrir/recarregar requer login.
- Não há revogação de JWT no logout: como na API original, um token já emitido permanece válido até expirar ou o administrador ser desabilitado.
- `installationSecret` de uma instalação nova aparece somente no diálogo imediatamente após sua criação. A propriedade é removida da resposta mantida pela interface, e fechar o diálogo, pressionar Escape, navegar, sair ou expirar a sessão remove seu conteúdo do DOM.
- O segredo não é incorporado às listas/cache, armazenamento, logs ou área de transferência automática. O usuário pode selecionar o texto para salvá-lo durante a exibição única.
- Não há leitura/exibição de segredo de instalações existentes, secretHash, chave privada, JWT_SECRET ou DATABASE_URL no painel.
- Valores da API são escapados antes de inserção no HTML. A auditoria exibe campos definidos, sem despejar metadata.
- Helmet, CSP, proteção Bearer, limites da API e `Cache-Control: no-store` permanecem ativos. Somente o diretório público do painel é servido; `.env`, chaves e fontes do servidor não são expostos.

## Interface

Fundo `#F7F9FC`, cards brancos, fonte Inter variável local e Lucide Icons locais. Layout com sidebar no desktop e menu recolhível no celular, cards adaptáveis, tabelas com rolagem horizontal, diálogos acessíveis e feedback de carregamento/erros. Sem gradientes, glow ou glassmorphism.

## Arquivos

- `src/app.ts`: apenas montagem dos arquivos públicos e redirecionamento da raiz.
- `public/admin/index.html`, `styles.css`, `app.js`: interface e integração com a API.
- `scripts/build-admin.mjs`: prepara e distribui assets locais.
- `tests/admin.test.ts`: testes de interface com respostas controladas e de montagem com Express/Supertest.
- `scripts/test-unit.mjs`: execução de testes sem PostgreSQL, com ambiente e chaves temporárias, sem carregar `.env` do projeto.
- `scripts/test-runner.mjs`: encaminha argumentos ao Vitest para excluir o caso de revogação durante esta validação.
- `package.json`, `package-lock.json`, `.gitignore`: dependências, scripts e assets gerados.

As alterações anteriores em `src/config/env.ts`, `src/config/startup.ts`, `tests/startup.test.ts` e `tests/database-env.test.ts` foram preservadas. Serviços de licença, schemas de banco, endpoints administrativos e código de assinatura não foram alterados.

## Verificação e limites

| Verificação | Resultado |
| --- | --- |
| `node --check public/admin/app.js` | Passou |
| `npm run typecheck` | Passou |
| `npm run build` | Passou; inclui os assets do painel |
| `npm run test:unit` | 69 testes passaram em 4 arquivos |
| `npm test -- --testNamePattern '^(?!.*REVOKED is permanent)'` | Tentado no sandbox e fora dele; bloqueado por `DOCKER_UNAVAILABLE` antes da criação do banco |
| Revisão visual em navegador | Não concluída: nenhum navegador conectado disponível |

Os testes novos verificam montagem pública segura, proteção da API, login, pesquisa, suspensão, reativação, renovação, criação de licença, os cinco status, logout, expiração por HTTP 401 e exibição/remoção do segredo da instalação. As respostas controladas existem apenas nos testes; o painel entregue chama a API real.

Uma execução direta inicial de testes de configuração falhou por ausência do ambiente de teste apropriado. A execução final usa o runner unitário com credenciais/chaves temporárias e passou. Testes de processo de startup e integração PostgreSQL não fazem parte do runner unitário; permanecem pendentes da suíte completa com Docker.

Não houve chamadas ao endpoint revoke, operações destrutivas na instalação de produção, migrations na base real, commit ou push. Após disponibilizar Docker, o comando acima permite completar a suíte existente sem executar o teste que chama revoke.

A pesquisa/dashboard carregam as páginas de clientes, produtos, instalações e licenças porque a API atual não oferece busca ou agregação no servidor. Bases grandes podem aumentar o tempo de carregamento ou atingir o rate limit; a interface informa falhas e permite tentar novamente. Os totais refletem a última coleta e não constituem um snapshot transacional entre todos os endpoints.
