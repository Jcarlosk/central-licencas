# Central de Licenças

API independente para administrar clientes, produtos, instalações e licenças, com painel web administrativo em `/admin/` servido pela própria aplicação. Não integra nem altera o `sistema-senhas`. Express, TypeScript, PostgreSQL, Prisma, Zod, bcrypt, JWT e assinatura assimétrica Ed25519. Não há pagamentos, seed automático ou administrador padrão.

Para usar o painel, execute `npm run dev` ou `npm run build` seguido de `npm start`, abra `/admin/` na URL da aplicação e entre com um administrador existente. Consulte [o relatório do painel](ADMIN-PANEL-REPORT.md) para funcionalidades, segurança, endpoints e resultados de validação. `npm run test:unit` executa os testes que não dependem de PostgreSQL; a suíte completa continua usando o banco isolado em Docker. Para excluir o teste que chama revoke, use `npm test -- --testNamePattern '^(?!.*REVOKED is permanent)'`.

## Requisitos e instalação

Validado com Node **22.22.3** e npm **10.9.8**. Use Node 22.22.3+ e PostgreSQL 17. Docker Desktop com contêineres Linux é necessário somente para `npm test`; a API aceita PostgreSQL local ou remoto.

No PowerShell:

```powershell
cd 'D:\app senha\central-licencas'
node --version
npm --version
npm ci
Copy-Item .env.example .env
```

Edite `.env` antes de iniciar. Nunca versione esse arquivo.

| Variável | Configuração |
| --- | --- |
| `PORT` | Porta HTTP, padrão `3000` |
| `NODE_ENV` | `development`, `production` ou `test` |
| `DATABASE_URL` | `postgresql://USUARIO:SENHA@HOST:5432/central_licencas?schema=public` — substitua os marcadores e codifique caracteres especiais da senha na URL |
| `JWT_SECRET` | Segredo aleatório com pelo menos 32 caracteres; gere 48 bytes aleatórios |
| `JWT_EXPIRES_IN` | Ex.: `8h`; inteiro seguido de `s`, `m`, `h` ou `d` |
| `LICENSE_PRIVATE_KEY_PATH` | `keys/license-private.pem` ou caminho absoluto; obrigatório somente sem o par Base64 |
| `LICENSE_PUBLIC_KEY_PATH` | `keys/license-public.pem` ou caminho absoluto; obrigatório somente sem o par Base64 |
| `LICENSE_PRIVATE_KEY_BASE64` | Base64 padrão dos bytes do PEM privado; opcional, configurar junto com o público |
| `LICENSE_PUBLIC_KEY_BASE64` | Base64 padrão dos bytes do PEM público; opcional, configurar junto com o privado |
| `RATE_LIMIT_MAX` | Requisições de API por IP/minuto, padrão `300` |
| `VALIDATION_RATE_LIMIT_MAX` | Validações por IP/minuto, padrão `60` |
| `LOGIN_RATE_LIMIT_MAX` | Tentativas de login por IP/minuto, padrão `10` |

Exemplo para gerar um JWT_SECRET novo e gravá-lo diretamente no `.env`, sem exibi-lo no terminal (requer que `.env` exista):

```powershell
node --input-type=module -e 'import {randomBytes} from "node:crypto"; import {readFileSync,writeFileSync} from "node:fs"; const p=".env"; writeFileSync(p,readFileSync(p,"utf8").replace(/^JWT_SECRET=.*$/m,"JWT_SECRET="+randomBytes(48).toString("base64url")));'
```

Se seu PowerShell antigo não preservar aspas de comandos nativos, gere o segredo em um gerenciador de senhas e cole no `.env`.

## PostgreSQL e migrations

Crie um banco **novo** `central_licencas` e um usuário exclusivo com senha forte usando pgAdmin ou a administração do seu PostgreSQL. Configure a URL no `.env`. Não use o banco do sistema de senhas. Não há senha ou connection string pronta no projeto.

```powershell
npm run prisma:generate
npm run db:migrate
```

`db:migrate` aplica a migration versionada sem resetar o banco. Para evoluir o schema no desenvolvimento: `npm run db:migrate:dev -- --name nome_da_mudanca`; revise e versione o SQL gerado. Não use `migrate dev` em produção. A migration usa UUID, timestamps com timezone, índices, relações com `RESTRICT` e unicidade de licença por instalação.

O Prisma CLI e Client estão fixados em 6.12.0: a versão 6.19.3 inicialmente avaliada carregava uma dependência de desenvolvimento com alerta de segurança. `package-lock.json` fixa toda a árvore; `npm audit` faz parte da verificação de entrega. Documentação utilizada: [transações do Prisma 6](https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions) e [tratamento assíncrono de erros no Express 5](https://expressjs.com/en/5x/guide/error-handling/).

## Chaves e primeiro administrador

```powershell
npm run generate-keys
npm run create-admin
```

`generate-keys` gera um par Ed25519 real em `keys/license-private.pem` (PKCS#8) e `keys/license-public.pem` (SPKI). Recusa sobrescrever arquivos existentes. Nenhuma chave é fornecida pelo código. `.gitignore` bloqueia todos os PEMs e o conteúdo de `keys/`, exceto `.gitkeep`. O servidor confere tipo e correspondência das chaves ao iniciar.

Restrinja a chave privada, `.env` e backups à conta do serviço. Em Linux, a chave privada é criada com modo `0600`; em Windows, configure a ACL NTFS para sua conta/conta de serviço, pois modos POSIX não substituem ACLs. Guarde backup seguro; não regenere uma chave em uso sem planejar a distribuição da nova chave pública. O futuro Electron receberá **somente a chave pública**.

### Chaves por ambiente e Railway

Quando **ambas** `LICENSE_PRIVATE_KEY_BASE64` e `LICENSE_PUBLIC_KEY_BASE64` estiverem preenchidas, o servidor decodifica os PEMs em memória e usa esse par, com prioridade sobre os caminhos. Não cria arquivos temporários. Valida Base64 padrão canônico (sem espaços/quebras de linha, com padding quando necessário), PEM, algoritmo Ed25519 e correspondência das chaves. Valores maiores que 16 KiB por variável são rejeitados. Falhas retornam apenas erro genérico, sem conteúdo das chaves.

Se ambas estiverem ausentes ou vazias, o comportamento local permanece: carregar `LICENSE_PRIVATE_KEY_PATH` e `LICENSE_PUBLIC_KEY_PATH`. Se apenas uma Base64 estiver preenchida, ou o par for inválido, a inicialização falha; **não há fallback silencioso para arquivos**. Em produção é possível omitir completamente as duas variáveis `_PATH`. Base64 é uma codificação, não criptografia: proteja a variável privada como um segredo.

Converta os PEMs existentes no PowerShell, sem imprimir chaves ou Base64:

```powershell
$privateKeyBase64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path 'keys/license-private.pem').Path))
$publicKeyBase64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path 'keys/license-public.pem').Path))
# Cole o conteúdo de cada variável na variável correspondente do Railway.
# Set-Clipboard não imprime o valor; execute uma linha e cole antes da próxima.
Set-Clipboard -Value $privateKeyBase64
# Cole em LICENSE_PRIVATE_KEY_BASE64; depois:
Set-Clipboard -Value $publicKeyBase64
# Cole em LICENSE_PUBLIC_KEY_BASE64; depois limpe a sessão e a área de transferência:
Set-Clipboard -Value ''
Remove-Variable privateKeyBase64,publicKeyBase64
```

Não ative histórico/sincronização da área de transferência ao copiar segredos. Não use `Write-Output`, `echo`, logs ou arquivos versionados para esses valores. A conversão não gera novas chaves, preservando a chave pública distribuída.

Nas Variables do **serviço da API** no Railway, configure:

* `NODE_ENV=production`;
* `DATABASE_URL`: referência à URL do serviço PostgreSQL exclusivo da central;
* `JWT_SECRET`: segredo aleatório existente/gerado com pelo menos 32 caracteres;
* `JWT_EXPIRES_IN=8h` (ou a duração que já utiliza);
* `LICENSE_PRIVATE_KEY_BASE64` e `LICENSE_PUBLIC_KEY_BASE64`: conteúdo das variáveis PowerShell correspondentes;
* `PORT`: pode usar o valor fornecido pelo Railway; o servidor já o lê;
* opcionais: `RATE_LIMIT_MAX`, `VALIDATION_RATE_LIMIT_MAX`, `LOGIN_RATE_LIMIT_MAX` (padrões preservados).

Não é necessário enviar PEMs, criar volume de chaves ou definir `_PATH`. Marque a chave privada e o JWT_SECRET como sealed quando apropriado. Veja a [documentação de variáveis do Railway](https://docs.railway.com/variables) e de [Node.js e PORT](https://railway.com/deploy/nodejs-1).

Para a futura configuração do serviço (nenhum deploy é executado por este projeto): use a pasta `central-licencas` como raiz, Node 22.22.3+, Build Command `npm ci --include=dev && npm run prisma:generate && npm run build`, Pre-Deploy Command `npm run db:migrate`, Start Command `npm start` e health check `/health`. O build precisa das dependências de desenvolvimento para TypeScript e Prisma CLI. O comando de migration continua o mesmo e não reseta o banco. Consulte [Start Command](https://docs.railway.com/deployments/start-command). Não execute `generate-keys` ou seed automaticamente em produção.

`create-admin` pergunta nome, email e senha com entrada oculta. Exige ao menos 12 caracteres e no máximo 72 bytes UTF-8 (limite do bcrypt), aplica bcrypt custo 12 e não imprime senha/hash. Email é normalizado para minúsculas. Para automação também aceita JSON `{ "name", "email", "password" }` pelo stdin, fornecido por um gerenciador de segredos; evite argumentos de linha de comando e arquivos de senha. Não há credenciais padrão.

## Iniciar

Desenvolvimento:

```powershell
npm run dev
```

Produção, com `NODE_ENV=production` no `.env`:

```powershell
npm ci
npm run prisma:generate
npm run db:migrate
npm run build
npm start
```

Execute sempre da pasta raiz da central, para resolver os caminhos relativos. O entrypoint compilado é `dist/src/server.js`. A inicialização exige banco acessível, ENV válido e chaves válidas. SIGINT/SIGTERM encerram conexões de modo controlado.

Na publicação online, use HTTPS no proxy/serviço de hospedagem. A API não confia em `X-Forwarded-For`: `trust proxy=false`. Atrás de proxy, os limites serão compartilhados pelo IP do proxy até você configurar explicitamente proxies confiáveis e filtros no proxy. O limiter em memória é adequado a uma instância; múltiplas réplicas exigem um armazenamento compartilhado para limites globais. O IP não determina direito de uso. Nenhum request, token, senha, hash ou segredo é logado pela aplicação.

## Verificações e testes

```powershell
npm run typecheck
npm run build
npm test
npm audit
```

`npm test` cria seu próprio contêiner PostgreSQL 17 em porta aleatória de loopback, com nome e senha aleatórios; aplica a migration real e executa Vitest/Supertest contra esse banco. Usa chaves Ed25519 temporárias reais. **Não lê seu DATABASE_URL como destino de teste, não reseta bancos existentes e não usa mocks.** Remove apenas o contêiner e diretório temporário criados pela execução. Inicie Docker Desktop antes; no primeiro teste será necessário baixar `postgres:17-alpine`. Se Docker/banco/migration falhar, o comando falha explicitamente. Se o processo for encerrado à força, pode restar um contêiner `central-licencas-test-*`; remova somente o contêiner dessa execução.

Cobertura: login válido/inválido, JWT obrigatório/expirado/algoritmo/audience/admin inativo, CRUD, validação Zod, relações, hash do segredo, geração de ID, criação e unicidade da licença, cinco estados, entidades inativas, datas-limite, renovação válida/vencida/concorrente, suspensão, reativação, revogação definitiva, credenciais inválidas, Ed25519 e adulteração de cada campo, deduplicação concorrente de auditoria, paginação/filtros, limites de login/validação, JSON inválido/grande, health e headers de segurança.

## Endpoints

Prefixo `/api/v1`. Todas as rotas administrativas exigem `Authorization: Bearer <JWT>`. JSON é estrito: campos desconhecidos são rejeitados. UUID inválido retorna 400; registro ausente, 404; conflito, 409; autenticação inválida, 401; rate limit, 429. Erros retornam `{ "success": false, "error": "CODIGO" }`, sem stack trace nem dados internos.

| Método | Rota | Uso |
| --- | --- | --- |
| GET | `/health` | Público, sem dados do banco |
| POST | `/auth/login` | Público, email e senha; retorna `token` |
| GET, POST | `/clients` | Lista/cria clientes |
| GET, PATCH | `/clients/:id` | Consulta/atualiza cliente |
| GET, POST | `/products` | Lista/cria produtos |
| GET, PATCH | `/products/:id` | Consulta/atualiza produto |
| GET, POST | `/installations` | Lista/cria instalações |
| GET, PATCH | `/installations/:id` | Consulta/atualiza nome/active |
| GET, POST | `/licenses` | Lista/cria licenças |
| GET | `/licenses/:id` | Consulta licença |
| POST | `/licenses/:id/renew` | `{ "days": 30, "graceDays": 5 }` |
| POST | `/licenses/:id/suspend` | `{ "reason": "..." }` opcional |
| POST | `/licenses/:id/reactivate` | `{ "reason": "..." }` opcional |
| POST | `/licenses/:id/revoke` | `{ "reason": "..." }` opcional |
| GET | `/events` | Auditoria paginada e filtrada |
| POST | `/license/validate` | Público, credenciais da instalação; **sem JWT admin** |

Listagens: `?page=1&limit=20` (limite até 100). Eventos permitem `installationId` (UUID interno), `licenseId`, `type`, `from`, `to` (ISO UTC/offset). Resposta `{ success, data, pagination: { total, page, limit } }`. Não há DELETE.

## Criar BANABUIU-001 e validar (PowerShell)

Com a API iniciada e um admin criado, execute o roteiro abaixo. A senha é solicitada de forma oculta; não há senha padrão. Não ative transcript/logging de terminal ao manipular credenciais. Guarde o segredo retornado pela criação em seu gerenciador de segredos: ele não poderá ser consultado novamente. O roteiro mantém o segredo somente na memória da sessão para validar.

```powershell
$base = 'http://localhost:3000/api/v1'
$emailAdmin = Read-Host 'Email do admin'
$senhaSegura = Read-Host 'Senha do admin' -AsSecureString
$credential = [System.Management.Automation.PSCredential]::new($emailAdmin, $senhaSegura)
$loginBody = @{ email=$emailAdmin; password=$credential.GetNetworkCredential().Password } | ConvertTo-Json
$login = Invoke-RestMethod "$base/auth/login" -Method Post -ContentType 'application/json' -Body $loginBody
Remove-Variable loginBody,credential,senhaSegura
$headers = @{ Authorization="Bearer $($login.token)" }

$body = @{ name='Prefeitura Municipal de Banabuiú' } | ConvertTo-Json
$cliente = Invoke-RestMethod "$base/clients" -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body))

$body = @{ name='Sistema de Atendimento'; code='sistema-atendimento' } | ConvertTo-Json
$produto = Invoke-RestMethod "$base/products" -Method Post -Headers $headers -ContentType 'application/json' -Body $body

$body = @{ clientId=$cliente.data.id; productId=$produto.data.id; installationId='BANABUIU-001'; name='Servidor Banabuiú' } | ConvertTo-Json
$instalacao = Invoke-RestMethod "$base/installations" -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body))
# Preserve $instalacao.installationSecret em um gerenciador de segredos.
# O servidor não disponibiliza esse valor novamente.

$body = @{ installationId=$instalacao.data.id; days=30; graceDays=5 } | ConvertTo-Json
$licenca = Invoke-RestMethod "$base/licenses" -Method Post -Headers $headers -ContentType 'application/json' -Body $body

$body = @{ installationId='BANABUIU-001'; installationSecret=$instalacao.installationSecret } | ConvertTo-Json
$validacao = Invoke-RestMethod "$base/license/validate" -Method Post -ContentType 'application/json' -Body $body
$validacao | ConvertTo-Json -Depth 5
$validacao | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 response.json
Remove-Variable body,instalacao
npm run verify-license -- response.json keys/license-public.pem
```

Este roteiro é manual e destinado ao banco novo: rode uma vez. Produto/installationId repetidos retornam 409. Ao reutilizar dados, obtenha os UUIDs nas listagens em vez de recriar registros. O `installationId` de criação de licença é o **UUID interno** de `Installation`; o `installationId` de validação é o **código externo** `BANABUIU-001`. Cliente e produto não aparecem na resposta pública além do código do produto.

Operações sobre a licença criada (na mesma sessão PowerShell):

```powershell
$licenseId = $licenca.data.id
Invoke-RestMethod "$base/licenses/$licenseId/renew" -Method Post -Headers $headers -ContentType 'application/json' -Body '{"days":30,"graceDays":5}'
Invoke-RestMethod "$base/licenses/$licenseId/suspend" -Method Post -Headers $headers -ContentType 'application/json' -Body '{"reason":"Suspensao administrativa"}'
Invoke-RestMethod "$base/licenses/$licenseId/reactivate" -Method Post -Headers $headers -ContentType 'application/json' -Body '{}'
# Revogação é definitiva; execute somente quando desejar encerrar essa instalação.
# Invoke-RestMethod "$base/licenses/$licenseId/revoke" -Method Post -Headers $headers -ContentType 'application/json' -Body '{"reason":"Contrato encerrado"}'
Invoke-RestMethod "$base/events?licenseId=$licenseId&page=1&limit=20" -Headers $headers
```

## Exemplos curl

Em bash/zsh, crie `login.json` em local protegido com seu email/senha reais e `validation.json` com `installationId`/`installationSecret` obtidos na criação. Não versione nem registre esses arquivos. `TOKEN`, `CLIENT_ID`, `PRODUCT_ID` e `INSTALLATION_UUID` abaixo são variáveis preenchidas a partir das respostas anteriores; não são credenciais fornecidas pelo projeto.

```bash
curl -sS http://localhost:3000/health
curl -sS http://localhost:3000/api/v1/auth/login -H 'Content-Type: application/json' --data-binary @login.json
curl -sS http://localhost:3000/api/v1/clients -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"name":"Prefeitura Municipal de Banabuiú"}'
curl -sS http://localhost:3000/api/v1/products -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"name":"Sistema de Atendimento","code":"sistema-atendimento"}'
curl -sS http://localhost:3000/api/v1/installations -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"clientId\":\"$CLIENT_ID\",\"productId\":\"$PRODUCT_ID\",\"installationId\":\"BANABUIU-001\",\"name\":\"Servidor Banabuiú\"}"
curl -sS http://localhost:3000/api/v1/licenses -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"installationId\":\"$INSTALLATION_UUID\",\"days\":30,\"graceDays\":5}"
curl -sS http://localhost:3000/api/v1/license/validate -H 'Content-Type: application/json' --data-binary @validation.json -o response.json
npm run verify-license -- response.json keys/license-public.pem
```

No Windows, prefira o roteiro `Invoke-RestMethod` acima ou `curl.exe --data-binary @arquivo.json`; o alias `curl` e o tratamento de aspas do PowerShell variam.

## Regras de licença e assinatura

Há **uma licença por instalação**, mantida e renovada sem apagar histórico. Uma instalação revogada não aceita renovação, reativação, suspensão ou outra licença; um novo contrato definitivo deve ter nova instalação/código e novo segredo. Isso evita escolher arbitrariamente entre licenças sobrepostas.

* `ACTIVE`: administrativa ativa, entidades habilitadas e `startsAt <= agora <= expiresAt`.
* `GRACE`: `expiresAt < agora <= graceUntil`.
* `EXPIRED`: `agora > graceUntil`; também é o estado restritivo antes de `startsAt` (a API cria licenças com início imediato).
* `SUSPENDED`: suspensão administrativa ou instalação/cliente/produto inativo, com prioridade sobre datas.
* `REVOKED`: revogação administrativa definitiva, com prioridade máxima, inclusive sobre entidades inativas.

Os únicos estados administrativos são `ACTIVE`, `SUSPENDED`, `REVOKED`; `GRACE`/`EXPIRED` são calculados. O servidor usa seu próprio relógio em UTC; não aceita horário/status no request público. Configure sincronização de horário no servidor. Dias significam períodos de **24 horas exatas**, não fim de dia local. Criação: `startsAt=agora`, `expiresAt=agora+days`, `graceUntil=expiresAt+graceDays`. `days` entre 1 e 3650; `graceDays` entre 0 e 365, padrão 5.

Renovação: `base=max(expiresAt,agora)` e `expiresAt=base+days`; `graceUntil=novo expiresAt+graceDays`. **Toda licença vencida, inclusive em carência, renova a partir de agora.** Renovação mantém a suspensão; reativação remove só a suspensão administrativa, sem prolongar datas ou reabilitar cliente/produto/instalação. Pode continuar `EXPIRED` após reativação. A suspensão anterior permanece no evento histórico; `suspendedAt` indica apenas suspensão corrente.

Credenciais incorretas e instalação inexistente retornam o mesmo 401 `INVALID_INSTALLATION_CREDENTIALS`. Somente após validar o segredo, ausência de licença retorna 404 `LICENSE_NOT_FOUND`. Entidades inativas retornam resposta assinada `SUSPENDED`; licença revogada permanece `REVOKED`. Um 200 significa consulta autenticada e concluída, **não autorização de uso**: o consumidor deverá avaliar `license.status`.

Segredos de instalação têm 48 bytes aleatórios (64 caracteres base64url) e são mostrados apenas na resposta de criação. SHA-256 é apropriado aqui pela alta entropia do segredo; senhas humanas usam bcrypt. Os digests são comparados com `timingSafeEqual`, inclusive com digest substituto para IDs desconhecidos. Não se usa IP nem headers como identidade de instalação.

A assinatura Ed25519 abrange exatamente os seis campos de `license`: `installationId`, `product`, `status`, `issuedAt`, `expiresAt`, `graceUntil`. Protocolo v1: objeto plano, chaves ordenadas em ASCII (`expiresAt`, `graceUntil`, `installationId`, `issuedAt`, `product`, `status`), JSON compacto sem espaços, strings escapadas por `JSON.stringify`, codificação UTF-8. Não existe conversão de datas na canonicalização; assinam-se as strings UTC retornadas. A assinatura usa base64url sem padding. Ordem original de propriedades é irrelevante; campos extras são rejeitados.

`src/utils/signature.ts` exporta `canonicalizeLicense`, `signLicense`, `verifyLicense`. O script de verificação usa **somente a chave pública**. Alterar qualquer campo invalida a assinatura. A assinatura comprova autenticidade; não impede replay de uma resposta antiga: o futuro consumidor precisará de política de validade/frescor de `issuedAt` e armazenamento seguro. Essa integração não faz parte desta etapa.

## Auditoria e concorrência

Criação de instalação/licença e cada mudança administrativa geram evento na **mesma transação** que os dados, incluindo UUID do admin nos eventos administrativos. `LICENSE_VALIDATED` é gravado na primeira validação, em mudança do estado final, ou na primeira validação após 24 horas desde o último evento. `lastValidationAt` é atualizado em toda validação autenticada com licença. Falhas de credenciais não criam eventos; rate limit controla abuso. O último estado/evento fica na instalação para deduplicação sem varrer a tabela de eventos.

Renovação, suspensão, reativação, revogação e validação adquirem lock PostgreSQL na mesma instalação, impedindo perda de renovação e duplicação concorrente de eventos. Validação também mantém locks de leitura nos registros do cliente/produto durante o cálculo. Assinatura é produzida na transação; falha na assinatura desfaz a atualização de auditoria. Não há limpeza automática do histórico; em operação prolongada, planeje backup e arquivamento de eventos conforme necessidade.

## Estrutura

```text
src/
  app.ts, server.ts
  config/, middleware/, repositories/, routes/, services/, types/, utils/
prisma/
  schema.prisma, migrations/
scripts/
  create-admin.ts, generate-signing-keys.ts, verify-license.ts, test-runner.mjs
keys/.gitkeep
tests/
  api.test.ts, policy.test.ts
.env.example, package.json, package-lock.json, tsconfig.json
```

Não foram gerados admin, chaves ou `.env` de produção automaticamente. Esses valores pertencem ao ambiente de implantação. A API foi construída para funcionar isoladamente; a conexão ao Electron permanece fora do escopo.
