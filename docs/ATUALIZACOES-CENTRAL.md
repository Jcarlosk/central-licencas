# Atualizações pela Central de Licenças

A Central controla quais versões oferece. O GitHub futuramente armazenará os binários. Esta entrega funciona exclusivamente em **DRY-RUN**: não há publicação real, token real, deploy, commit ou push. O Sistema de Atendimento não foi alterado.

## Arquitetura e banco

Express 5, TypeScript, PostgreSQL e Prisma 6. O painel existente em `/admin/` usa os mesmos componentes, JWT mantido em memória e autorização do administrador ativo no backend. Cliente e Produto possuem instalações; cada instalação tem uma licença e um hash do segredo existente.

`Product.releases` relaciona `UpdateRelease` ao produto. O modelo guarda versão, canal, tipo obrigatório/opcional, título, notas, status, tag, identificador GitHub, URLs, SHA-256, autor técnico, datas e resumo da simulação. Unicidade por **produto + versão**, inclusive entre canais; uma versão beta pode usar `1.1.0-beta.1`, e a estável `1.1.0`. Build metadata (`+build`) é rejeitado para impedir versões diferentes com a mesma precedência. Stable não aceita prereleases.

A migration `prisma/migrations/202610090001_updates/migration.sql` cria dois enums e a tabela de releases e adiciona à instalação `updateChannel` (padrão `stable`), `reportedVersion` e `lastUpdateCheckAt`. Não apaga nem recria clientes, licenças ou instalações. As relações usam `RESTRICT`. `createdBy` registra UUID técnico do Admin sem copiar dados ou segredos.

Não há release inicial fictícia nem produto criado automaticamente. Sem uma publicação real, a versão estável exibida é `—`, e não uma versão inventada `1.0.0`.

## Painel

O menu **Atualizações** permite selecionar o produto, consultar estável/beta/última publicação, histórico e telemetria das instalações. **Publicar nova versão** abre o formulário com versão, canal, tipo, título, notas e três arquivos. **Salvar draft** não exige arquivos. **Publicar (dry-run)** salva o draft e simula a publicação. Erro no upload preserva o draft para correção; o formulário pode ser reenviado sem criar outra versão duplicada.

Drafts permitem editar todos os metadados, mantendo o produto original. Alterar um draft invalida hash e simulação anteriores. Releases publicadas/desabilitadas não podem ser editadas ou republicadas por essas rotas. **Desabilitar distribuição** apenas muda o status para `DISABLED`; não há DELETE nem chamada para excluir GitHub Release. O histórico é preservado.

O Admin também pode habilitar beta ou voltar a stable por instalação. A versão informada e o último check aparecem ao lado do canal.

## Endpoints

Prefixo real do projeto: `/api/v1`. Todos os endpoints abaixo, exceto `check`, exigem `Authorization: Bearer <JWT Admin>` e Admin ativo no banco.

| Método | Endpoint | Corpo / comportamento |
| --- | --- | --- |
| GET | `/api/v1/updates` | Paginação `page`, `limit` e filtro opcional `productId` |
| POST | `/api/v1/updates` | Cria `DRAFT` com JSON completo de metadados |
| PATCH | `/api/v1/updates/:id` | JSON completo; edita somente draft sem ID GitHub |
| POST | `/api/v1/updates/:id/publish` | Multipart com `installer`, `metadata`, `blockmap`; exclusivamente dry-run |
| POST | `/api/v1/updates/:id/disable` | JSON `{}`; desabilita draft ou publicada |
| PATCH | `/api/v1/installations/:id` | Padrão existente ampliado com `updateChannel: "stable" ou "beta"` |
| POST | `/api/v1/updates/check` | Credenciais existentes da instalação e parâmetros da consulta |

JSON administrativo:

```json
{
  "productId": "UUID do produto existente",
  "version": "1.1.0",
  "channel": "stable",
  "mandatory": false,
  "title": "Melhorias de atendimento",
  "notes": "Descrição das alterações"
}
```

Consulta do sistema:

```json
{
  "product": "sistema-atendimento",
  "currentVersion": "1.0.0",
  "installationId": "CODIGO-EXTERNO-DA-INSTALACAO",
  "installationSecret": "segredo existente da instalação",
  "channel": "stable"
}
```

`product` é o código do produto; `installationId` é o código externo, não o UUID interno. O segredo vem no corpo JSON via HTTPS, conforme `/license/validate`; não vai em query string. Não existe segundo installationSecret.

Sem atualização, retorna exatamente `{"updateAvailable":false}`. Com atualização:

```json
{
  "updateAvailable": true,
  "version": "1.1.0",
  "channel": "stable",
  "mandatory": false,
  "title": "Melhorias de atendimento",
  "notes": "Descrição das alterações",
  "downloadUrl": "https://github.com/OWNER/sistema-atendimento-updates/releases/download/v1.1.0/Setup.exe",
  "sha256": "64 caracteres hexadecimais"
}
```

O payload público não inclui identificadores administrativos, logs de publicação, dados de clientes ou segredos. `mandatory` é somente informação; bloqueios e instalação pertencem ao futuro consumidor.

## Autenticação e política de licença

O check reutiliza `validateLicense`: comparação constante do hash do segredo, política existente, assinatura e auditoria de licenciamento. Credencial incorreta ou instalação inexistente: 401 `INVALID_INSTALLATION_CREDENTIALS`; sem licença: 404 `LICENSE_NOT_FOUND`. Produto diferente: 403 `PRODUCT_MISMATCH`. Estados `SUSPENDED`, `REVOKED` ou `EXPIRED`: 403 `LICENSE_<STATUS>`, sem `updateAvailable:false`. **ACTIVE e GRACE** podem consultar e receber atualização, preservando a tolerância existente.

Após a validação inicial, o serviço bloqueia a instalação e os registros relacionados e reconfere licença, entidades e produto em uma transação. Isso evita oferecer atualização usando licença que foi suspensa entre as duas etapas. Usa horário do servidor. Telemetria é registrada somente após autorização de produto, licença e canal: código informado da versão e instante do check. Não registra dados de cidadãos. A auditoria da validação existente continua sendo realizada, inclusive se a checagem adicional de produto/canal falhar.

## Stable, beta e seleção

Todas as instalações existentes recebem `updateChannel=stable`. Pedido beta por instalação stable retorna 403 `UPDATE_CHANNEL_NOT_ALLOWED`. Instalação habilitada para beta pode consultar beta ou stable explicitamente; não há fallback implícito entre canais.

O check considera exclusivamente o mesmo produto e o canal pedido, releases `PUBLISHED`, `dryRun=false`, URL HTTPS e hash válido. Seleciona a maior versão por comparação SemVer, não por data nem ordem textual. Não oferece a mesma versão nem downgrade. Drafts, dry-run e disabled são excluídos.

## Rollout

Nesta entrega a distribuição é **GLOBAL POR PRODUTO**, respeitando o canal permitido. A seleção fica em `selectUpdate` e o check mantém o contexto da instalação. A evolução pode acrescentar escopo `GLOBAL/INSTALLATIONS` e uma relação entre release e instalações antes dessa seleção, sem mudar o contrato público, o segredo ou o licenciamento. Não há seleção individual de clientes implementada nesta etapa.

## Arquivos, validações e temporários

Uploads multipart exigem exatamente um arquivo em cada campo. Nomes ASCII simples, até 160 caracteres; caminhos, barras, dois pontos, controles e `..` são rejeitados. O parser preserva o nome original para verificar traversal, e grava o conteúdo com UUID gerado pelo servidor em diretório privado temporário, fora de `/admin`.

Limites: instalador `.exe` até **250 MiB**, `latest.yml` até **64 KiB**, `.exe.blockmap` até **10 MiB**. O parser limita quantidade, partes e campos; metadados não são aceitos como campos multipart. MIME é validado por lista adequada ao tipo; MIME é apenas uma verificação adicional. Arquivos vazios são rejeitados. O instalador deve começar com `MZ`; isso não substitui assinatura Authenticode nem análise antivírus. Nenhum arquivo é executado.

O blockmap deve se chamar exatamente `<nome do instalador>.blockmap`. O YAML deve conter a mesma `version` e exatamente um item em `files`, com `url` igual ao nome do instalador, `size` igual ao tamanho e `sha512` igual ao hash calculado. `path` e `sha512` de topo, quando presentes, também devem corresponder. Parsing rejeita erros, chaves duplicadas e expansão de aliases. O blockmap é validado por nome, MIME e tamanho, sem validar seu conteúdo interno.

SHA-256 e SHA-512 são calculados por streaming; não carrega o instalador inteiro em memória. O diretório temporário é removido em `finally` em sucesso ou falha. A release guarda hash e um resumo de nomes/tamanhos/etapas, sem conteúdo ou caminho local. É preciso reenviar arquivos para nova simulação. Render não é armazenamento permanente; não há downloads de instaladores servidos pela Central.

Encerramento abrupto do processo pode impedir `finally`; o filesystem efêmero não deve ser reutilizado como repositório. Antes de habilitar uploads reais em escala, dimensionar disco temporário, concorrência e limites no proxy. Os limites menores de YAML/blockmap são conferidos após o upload; o parser aplica 250 MiB como teto por arquivo durante o recebimento.

## Dry-run e GitHub

As rotas instanciam **sempre `DryRunPublisher`**. Nem adicionar `GITHUB_TOKEN` nem mudar ambiente habilita publicação real. As etapas retornadas são simulações de criação draft GitHub, upload dos três arquivos e publicação; o banco permanece `DRAFT`, `publishedAt=null` e sem URLs/ID GitHub.

`ReleasePublisher` desacopla o fluxo. `GitHubReleasePublisher` e `GitHubHttpTransport` estão preparados e desconectados das rotas. O transport usa endpoints oficiais, streaming para upload, timeout, bloqueio de redirects e erros genéricos sem conteúdo da resposta. O fluxo cria release GitHub como draft, envia todos os arquivos e só então publica. Em falha, `PartialPublicationError` informa somente ID técnico e etapa para futura reconciliação; não publica antes de todos os uploads. Nenhuma exclusão automática é realizada.

Referências: [Releases API](https://docs.github.com/en/rest/releases/releases) e [Release assets API](https://docs.github.com/en/rest/releases/assets).

### O que falta para habilitar GitHub real

Esta entrega para **antes de pedir/configurar token**. Em etapa futura autorizada:

1. Confirmar dono, repositório, acesso aos downloads e mapeamento por produto. A Central já isola produtos; um único repositório e tags `v<versão>` podem conflitar entre produtos. Inicialmente usar esse repositório exclusivamente para Sistema de Atendimento.
2. Conectar o transport às rotas por configuração explícita do backend, com dry-run como padrão seguro e confirmação operacional da habilitação.
3. Persistir tentativa/ID GitHub antes das etapas externas, garantir exclusão mútua de publicação e implementar reconciliação/retry de publicação parcial ou falha entre GitHub e gravação no banco. Atualizar URLs, ID e `PUBLISHED` somente após confirmação de todos os uploads/publicação. Uma resposta perdida após sucesso remoto exige reconciliação, não republicação cega.
4. Validar arquivos reais assinados, beta e stable com o consumidor separadamente e testar o transport em repositório de homologação autorizado.
5. Configurar as variáveis **somente** no backend/Render; nunca no frontend ou banco. Nenhuma dessas etapas foi executada aqui.

O repositório público oferece downloads públicos: a licença controla a oferta pela Central, não revoga acesso a URLs já conhecidas. Um repositório privado exige uma estratégia de download autenticado que não revele o token ao sistema; isso ainda não está implementado.

## Render e ambiente

Não havia arquivo específico de configuração Render no projeto. Configuração futura sugerida: Node compatível com `package.json`, build `npm ci --include=dev && npm run prisma:generate && npm run build`, start `npm start`, health `/health`. Aplicar `npm run db:migrate` somente no banco de homologação confirmado ou no procedimento futuro de deploy autorizado. Não aplicar migration de teste sobre produção.

Manter variáveis atuais da Central (PostgreSQL, JWT, chaves Ed25519, limites e PORT). Variáveis reservadas em `.env.example`, sem valores sensíveis:

| Variável | Uso futuro |
| --- | --- |
| `GITHUB_TOKEN` | Credencial exclusivamente no backend; vazia nesta etapa |
| `GITHUB_OWNER` | Proprietário a confirmar; vazio nesta etapa |
| `GITHUB_UPDATES_REPO` | Reposit?rio de updates a confirmar na etapa futura |

Não há flag de ambiente capaz de ligar GitHub real nesta entrega. O módulo atual de ENV não lê o token. Não foi configurado Render, deploy ou variável real.

## Segurança e verificações

JWT obrigatório para todas as alterações; Admin inativo perde acesso. Validação Zod estrita no backend, conflito por constraint de banco e estados comparados no UPDATE. Publicação de teste usa `updatedAt` como controle de concorrência, evitando sobrescrever edição ou desabilitação. Check herda rate limit global e específico de validação. Logs existentes seguem genéricos; uploads, tokens, Authorization, cookies e installationSecret não são registrados.

Executar `npm run typecheck`, `npm run build`, `npx prisma validate` e `npm run test:unit`. `npm test` mantém o executor Docker existente, que cria seu próprio PostgreSQL. Alternativa sem Docker, usando **apenas binários** PostgreSQL já instalados:

```powershell
node scripts/test-local-postgres.mjs 'C:\Program Files\PostgreSQL\17\bin'
```

A alternativa inicializa cluster próprio em diretório temporário, porta loopback e credenciais aleatórias, aplica migrations e verifica drift, executa a suíte e encerra/remove sua instância. Não usa o `DATABASE_URL` do `.env` nem bancos/serviços já existentes. Não passar diretório de dados existente.

Os testes novos cobrem painel, autorização, draft/edição, duplicação, produto, SemVer, canais, mandatory, nomes/traversal, MIME/extensões, quantidade, limites, hashes, metadata, dry-run sem rede, seleção SemVer, ausência de update, licenças inválidas/carência, produtos isolados, beta opt-in, disabled e telemetria. O transport GitHub é testado com HTTP simulado; nenhum GitHub real é utilizado.

### Integra??o no projeto oficial

C?digo integrado seletivamente de `C:\Users\hardc\Downloads\central-licencas-updates-teste` para `D:\app senha\central-licencas`. Configura??es oficiais, chaves e dados reais foram preservados. Valida??o executada no projeto oficial em 09/10/2026: Prisma Client gerado localmente; schema validado; `npm.cmd run typecheck` e `npm.cmd run build` passaram; `npm.cmd run test:unit` passou com **93 testes em 5 arquivos**; `npm.cmd audit` retornou **0 vulnerabilidades**. As migrations inicial e de updates passaram no cluster PostgreSQL tempor?rio, com **No difference detected** na verifica??o de drift. A su?te completa passou com **159 testes em 9 arquivos**, executada por `node scripts/test-local-postgres.mjs "C:\Program Files\PostgreSQL\17\bin"`. O executor terminou com c?digo 0 ap?s encerrar e remover seu cluster tempor?rio. O adaptador GitHub foi exercitado apenas com HTTP simulado; nenhuma chamada real foi feita.

A migration de produ??o **n?o foi executada**. Em uma etapa futura autorizada, no diret?rio oficial e com o ambiente de produ??o previamente confirmado, o comando ser?:

```powershell
npm.cmd run db:migrate
```

Esse script executa `prisma migrate deploy` e aplica migrations pendentes; n?o deve ser executado em produ??o durante esta integra??o.

## Arquivos desta entrega

- Banco: `prisma/schema.prisma` e `prisma/migrations/202610090001_updates/migration.sql`.
- Backend: `src/app.ts`, `src/routes/updates.routes.ts`, `src/services/updates.ts`, `src/services/update-files.ts`, `src/services/github-releases.ts`, `src/utils/update-schemas.ts`, `src/utils/schemas.ts`, `src/repositories/database.ts`.
- Painel: `public/admin/app.js`, mantendo HTML/CSS e Design System existentes.
- Configuração/dependências: `package.json`, `package-lock.json` (multer, semver, yaml e tipos).
- Testes: `tests/updates-unit.test.ts`, `tests/updates-api.test.ts`, `tests/admin.test.ts`, `scripts/test-unit.mjs`, `scripts/test-local-postgres.mjs`.
- Documentação: `docs/ATUALIZACOES-CENTRAL.md`.

Build gera `dist` e assets vendor pelos scripts existentes. Nenhum commit, push ou deploy é necessário para revisar esta implementação.
