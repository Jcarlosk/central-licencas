
<div align="center">

<img src="docs/images/logo.png" alt="Central de Licenças" width="100" />

# Central de Licenças

**Plataforma independente para gerenciamento e validação de licenças de software.**

Gerencie clientes, produtos, instalações e licenças em um painel administrativo centralizado, com autenticação segura, auditoria de operações e assinaturas digitais Ed25519.

![Node.js](https://img.shields.io/badge/Node.js-22-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=flat-square&logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-6.12.0-2D3748?style=flat-square&logo=prisma&logoColor=white)
![Security](https://img.shields.io/badge/Signature-Ed25519-2563EB?style=flat-square)

<br />

<img src="docs/images/dashboard.png" alt="Dashboard da Central de Licenças" width="100%" />

<br />

**[Visão geral](#visão-geral) · [Interface](#interface-administrativa) · [Instalação](#instalação) · [API](#referência-da-api) · [Segurança](#segurança) · [Deploy](#deploy-no-railway)**

</div>

---

## Visão geral

A **Central de Licenças** é uma API independente desenvolvida para administrar o ciclo de vida de licenças de software.

A aplicação oferece uma interface administrativa integrada, acessível em `/admin/`, além de uma API REST para gerenciamento e validação.

### Funcionalidades

| Módulo | Funcionalidades |
| --- | --- |
| Clientes | Cadastro, consulta e atualização de clientes |
| Produtos | Administração dos produtos licenciados |
| Instalações | Identificação e controle de instalações |
| Licenças | Emissão, renovação, suspensão, reativação e revogação |
| Validação | Consulta autenticada do estado de licenciamento |
| Auditoria | Histórico de eventos e alterações |
| Administração | Painel web com autenticação JWT |
| Segurança | bcrypt, rate limiting e assinatura Ed25519 |

> [!IMPORTANT]
> A Central de Licenças funciona de maneira independente. Não integra nem modifica o `sistema-senhas`. A integração com aplicações Electron será realizada separadamente.

O projeto não possui processamento de pagamentos, administrador padrão ou seed automático.

---

## Interface administrativa

O painel web é servido diretamente pela aplicação Express e está disponível em:

```text
http://localhost:3000/admin/
```

A autenticação exige um administrador previamente criado.

### Dashboard

Visão centralizada da administração e das informações do sistema.

<div align="center">
  <img src="docs/images/dashboard.png" width="100%" alt="Dashboard administrativo" />
</div>

### Gestão de clientes

Cadastro e gerenciamento dos clientes associados aos produtos e instalações.

<div align="center">
  <img src="docs/images/clientes.png" width="100%" alt="Gestão de clientes" />
</div>

### Produtos e instalações

Organização dos produtos cadastrados e das instalações vinculadas aos clientes.

<div align="center">
  <img src="docs/images/produtos.png" width="49%" alt="Produtos" />
  <img src="docs/images/instalacoes.png" width="49%" alt="Instalações" />
</div>

### Gerenciamento de licenças

Operações administrativas sobre o ciclo de vida das licenças.

<div align="center">
  <img src="docs/images/licencas.png" width="100%" alt="Gerenciamento de licenças" />
</div>

### Auditoria

Consulta ao histórico de eventos, validações e alterações administrativas.

<div align="center">
  <img src="docs/images/auditoria.png" width="100%" alt="Auditoria" />
</div>

### Autenticação

Acesso restrito aos administradores cadastrados.

<div align="center">
  <img src="docs/images/login.png" width="100%" alt="Tela de autenticação" />
</div>

Para detalhes sobre funcionalidades, segurança e resultados de validação do painel, consulte [ADMIN-PANEL-REPORT.md](ADMIN-PANEL-REPORT.md).

---

## Arquitetura

A solução utiliza uma API REST construída com Express e TypeScript, persistência PostgreSQL e Prisma ORM.

```mermaid
flowchart TB
    A["Painel administrativo /admin/"]
    B["API REST Express + TypeScript"]
    C["Autenticação JWT"]
    D["Serviços e regras de negócio"]
    E["Prisma ORM"]
    F[("PostgreSQL 17")]
    G["Validação de licença"]
    H["Assinatura Ed25519"]
    I["Consumidor externo futuro"]

    A --> B
    B --> C
    C --> D
    D --> E
    E --> F
    B --> G
    G --> H
    I --> G
```

### Tecnologias

| Camada | Tecnologia |
| --- | --- |
| Runtime | Node.js 22 |
| Linguagem | TypeScript |
| Servidor HTTP | Express |
| Banco de dados | PostgreSQL 17 |
| ORM | Prisma 6.12.0 |
| Validação | Zod |
| Senhas administrativas | bcrypt |
| Autenticação | JWT |
| Assinatura digital | Ed25519 |
| Testes | Vitest e Supertest |
| Ambiente de testes | Docker |
| Hospedagem planejada | Railway |

---

## Requisitos

Ambiente validado com:

- Node.js `22.22.3`
- npm `10.9.8`
- PostgreSQL `17`
- Docker Desktop com contêineres Linux, necessário para a suíte completa de testes

A API aceita PostgreSQL local ou remoto.

## Instalação

### 1. Acessar o projeto

No PowerShell:

```powershell
cd 'D:\app senha\central-licencas'
```

Confirme as versões:

```powershell
node --version
npm --version
```

### 2. Instalar dependências

```powershell
npm ci
```

### 3. Configurar ambiente

```powershell
Copy-Item .env.example .env
```

Edite o arquivo `.env` com as configurações do ambiente.

> [!CAUTION]
> Nunca publique o `.env`, senhas, tokens, chaves privadas ou credenciais do banco no GitHub.

### Variáveis de ambiente

| Variável | Descrição |
| --- | --- |
| `PORT` | Porta HTTP, padrão `3000` |
| `NODE_ENV` | `development`, `production` ou `test` |
| `DATABASE_URL` | URL de conexão PostgreSQL |
| `JWT_SECRET` | Segredo aleatório de pelo menos 32 caracteres |
| `JWT_EXPIRES_IN` | Duração do token, como `8h` |
| `LICENSE_PRIVATE_KEY_PATH` | Caminho da chave privada |
| `LICENSE_PUBLIC_KEY_PATH` | Caminho da chave pública |
| `LICENSE_PRIVATE_KEY_BASE64` | Chave privada PEM codificada em Base64 |
| `LICENSE_PUBLIC_KEY_BASE64` | Chave pública PEM codificada em Base64 |
| `RATE_LIMIT_MAX` | Requisições por IP/minuto, padrão `300` |
| `VALIDATION_RATE_LIMIT_MAX` | Validações por IP/minuto, padrão `60` |
| `LOGIN_RATE_LIMIT_MAX` | Tentativas de login por IP/minuto, padrão `10` |

Exemplo de URL de conexão:

```dotenv
DATABASE_URL=postgresql://USUARIO:SENHA@HOST:5432/central_licencas?schema=public
```

Substitua os marcadores por valores reais e codifique caracteres especiais da senha na URL.

### Gerar segredo JWT

Com o `.env` já criado:

```powershell
node --input-type=module -e 'import {randomBytes} from "node:crypto"; import {readFileSync,writeFileSync} from "node:fs"; const p=".env"; writeFileSync(p,readFileSync(p,"utf8").replace(/^JWT_SECRET=.*$/m,"JWT_SECRET="+randomBytes(48).toString("base64url")));'
```

O comando gera 48 bytes aleatórios e atualiza o valor existente de `JWT_SECRET` sem imprimir o segredo.

Caso o PowerShell não preserve corretamente as aspas, gere o segredo em um gerenciador de senhas e configure-o manualmente.

---

## Banco de dados

Crie um banco exclusivo chamado `central_licencas` e um usuário com senha forte.

Não compartilhe o banco com o sistema de senhas.

### Gerar Prisma Client

```powershell
npm run prisma:generate
```

### Aplicar migrations

```powershell
npm run db:migrate
```

O comando aplica as migrations versionadas sem resetar o banco.

Para desenvolver alterações no schema:

```powershell
npm run db:migrate:dev -- --name nome_da_mudanca
```

Revise o SQL gerado e versione as migrations.

> [!WARNING]
> Não execute `migrate dev` em produção. Utilize `npm run db:migrate`.

A estrutura utiliza UUID, timestamps com timezone, índices, relacionamentos com `RESTRICT` e unicidade de licença por instalação.

O Prisma CLI e Client estão fixados na versão `6.12.0`, com dependências controladas pelo `package-lock.json`.

---

## Chaves de assinatura

A Central utiliza assinaturas digitais assimétricas Ed25519.

### Gerar chaves

```powershell
npm run generate-keys
```

Arquivos gerados:

```text
keys/
├── license-private.pem
└── license-public.pem
```

- Chave privada: utilizada exclusivamente pela Central para assinar respostas.
- Chave pública: utilizada pelos consumidores para verificar assinaturas.

As chaves utilizam os formatos PKCS#8 e SPKI.

O comando não sobrescreve arquivos existentes.

> [!CAUTION]
> Nunca distribua a chave privada para aplicações cliente. O futuro aplicativo Electron deve receber somente a chave pública.

Mantenha backups protegidos. Trocar um par de chaves em uso exige planejamento para atualizar a chave pública dos consumidores.

Em Linux, a chave privada é criada com permissão `0600`. No Windows, configure as permissões NTFS adequadas.

### Chaves por variáveis de ambiente

Em hospedagens como Railway, é possível configurar:

```dotenv
LICENSE_PRIVATE_KEY_BASE64=
LICENSE_PUBLIC_KEY_BASE64=
```

Quando ambas estão preenchidas, a aplicação utiliza o par em memória, com prioridade sobre os caminhos dos arquivos.

A inicialização falha se apenas uma estiver configurada ou se o par for inválido.

Não há fallback silencioso para arquivos quando as variáveis Base64 estão parcialmente preenchidas.

O Base64 deve ser padrão e canônico. Cada variável possui limite de 16 KiB.

**Base64 não é criptografia.** Proteja a chave privada como um segredo.

### Converter PEM para Base64

No PowerShell:

```powershell
$privateKeyBase64 = [Convert]::ToBase64String(
  [IO.File]::ReadAllBytes(
    (Resolve-Path 'keys/license-private.pem').Path
  )
)

$publicKeyBase64 = [Convert]::ToBase64String(
  [IO.File]::ReadAllBytes(
    (Resolve-Path 'keys/license-public.pem').Path
  )
)
```

Copie uma variável por vez:

```powershell
Set-Clipboard -Value $privateKeyBase64
```

Configure `LICENSE_PRIVATE_KEY_BASE64` no Railway.

Depois:

```powershell
Set-Clipboard -Value $publicKeyBase64
```

Configure `LICENSE_PUBLIC_KEY_BASE64`.

Limpe a sessão:

```powershell
Set-Clipboard -Value ''
Remove-Variable privateKeyBase64,publicKeyBase64
```

Evite histórico e sincronização da área de transferência ao manipular segredos.

---

## Primeiro administrador

Execute:

```powershell
npm run create-admin
```

O assistente solicita:

- Nome
- Email
- Senha

A senha exige pelo menos 12 caracteres e no máximo 72 bytes UTF-8.

O armazenamento utiliza bcrypt com custo 12. A senha e seu hash não são exibidos no terminal.

O email é normalizado para minúsculas.

Também existe suporte a JSON via stdin para automações seguras:

```json
{
  "name": "Administrador",
  "email": "admin@exemplo.com",
  "password": "SENHA_FORNECIDA_COM_SEGURANCA"
}
```

Não passe senhas por argumentos de linha de comando nem salve credenciais em arquivos versionados.

**Não existem credenciais administrativas padrão.**

---

## Executando a aplicação

### Desenvolvimento

```powershell
npm run dev
```

Abra:

```text
http://localhost:3000/admin/
```

### Produção

Configure `NODE_ENV=production` e execute:

```powershell
npm ci
npm run prisma:generate
npm run db:migrate
npm run build
npm start
```

O entrypoint compilado é:

```text
dist/src/server.js
```

A aplicação verifica as configurações, as chaves e o acesso ao banco durante a inicialização.

O encerramento por SIGINT ou SIGTERM fecha as conexões de forma controlada.

---

## Referência da API

Prefixo:

```text
/api/v1
```

Rotas administrativas exigem:

```http
Authorization: Bearer <JWT>
```

### Autenticação e saúde

| Método | Endpoint | Acesso |
| --- | --- | --- |
| GET | `/health` | Público |
| POST | `/auth/login` | Público |

O endpoint `/health` fica fora do prefixo `/api/v1`.

### Clientes

| Método | Endpoint | Descrição |
| --- | --- | --- |
| GET | `/clients` | Listar clientes |
| POST | `/clients` | Criar cliente |
| GET | `/clients/:id` | Consultar cliente |
| PATCH | `/clients/:id` | Atualizar cliente |

### Produtos

| Método | Endpoint | Descrição |
| --- | --- | --- |
| GET | `/products` | Listar produtos |
| POST | `/products` | Criar produto |
| GET | `/products/:id` | Consultar produto |
| PATCH | `/products/:id` | Atualizar produto |

### Instalações

| Método | Endpoint | Descrição |
| --- | --- | --- |
| GET | `/installations` | Listar instalações |
| POST | `/installations` | Criar instalação |
| GET | `/installations/:id` | Consultar instalação |
| PATCH | `/installations/:id` | Atualizar nome ou status ativo |

### Licenças

| Método | Endpoint | Descrição |
| --- | --- | --- |
| GET | `/licenses` | Listar licenças |
| POST | `/licenses` | Criar licença |
| GET | `/licenses/:id` | Consultar licença |
| POST | `/licenses/:id/renew` | Renovar licença |
| POST | `/licenses/:id/suspend` | Suspender licença |
| POST | `/licenses/:id/reactivate` | Reativar licença |
| POST | `/licenses/:id/revoke` | Revogar definitivamente |

### Validação e auditoria

| Método | Endpoint | Descrição |
| --- | --- | --- |
| POST | `/license/validate` | Validação pública autenticada por instalação |
| GET | `/events` | Histórico de auditoria |

A validação não exige JWT administrativo. Utiliza as credenciais próprias da instalação.

### Paginação

Listagens aceitam:

```http
GET /api/v1/clients?page=1&limit=20
```

O limite máximo é 100 registros por página.

Exemplo de estrutura:

```json
{
  "success": true,
  "data": [],
  "pagination": {
    "total": 0,
    "page": 1,
    "limit": 20
  }
}
```

Os eventos podem ser filtrados por:

- `installationId`
- `licenseId`
- `type`
- `from`
- `to`

As datas utilizam ISO com UTC ou offset.

### Tratamento de erros

| HTTP | Significado |
| --- | --- |
| 400 | Requisição inválida |
| 401 | Autenticação inválida |
| 404 | Registro não encontrado |
| 409 | Conflito |
| 429 | Limite de requisições excedido |

Exemplo:

```json
{
  "success": false,
  "error": "INVALID_INSTALLATION_CREDENTIALS"
}
```

Campos JSON desconhecidos são rejeitados. A API não expõe stack traces ou dados internos nas respostas de erro.

Não existem endpoints DELETE.

---

## Ciclo de vida das licenças

Cada instalação possui uma única licença, preservada ao longo das renovações.

### Estados

| Estado | Significado |
| --- | --- |
| `ACTIVE` | Licença válida e entidades habilitadas |
| `GRACE` | Período de carência após vencimento |
| `EXPIRED` | Prazo de licença e carência encerrados |
| `SUSPENDED` | Suspensão administrativa ou entidade inativa |
| `REVOKED` | Revogação administrativa definitiva |

```mermaid
flowchart TD
    A["Licença criada"] --> B["ACTIVE"]
    B --> C["GRACE"]
    C --> D["EXPIRED"]
    B --> E["SUSPENDED"]
    C --> E
    D --> E
    E --> B
    E --> C
    E --> D
    B --> F["REVOKED"]
    C --> F
    D --> F
    E --> F
    F --> G["Estado terminal"]
```

O diagrama representa possibilidades gerais. Reativar uma licença suspensa não garante o retorno a `ACTIVE`: o estado resultante depende das datas e da situação das entidades vinculadas.

### Regras administrativas

Somente três estados são administrativos:

```text
ACTIVE
SUSPENDED
REVOKED
```

`GRACE` e `EXPIRED` são calculados conforme as datas.

Prioridade de estados:

1. Revogação definitiva.
2. Suspensão administrativa ou entidades inativas.
3. Datas de validade e carência.

### Criação

```text
startsAt = agora
expiresAt = agora + days
graceUntil = expiresAt + graceDays
```

Limites:

| Campo | Intervalo |
| --- | --- |
| `days` | 1 a 3650 |
| `graceDays` | 0 a 365 |
| Carência padrão | 5 dias |

Cada dia representa exatamente 24 horas.

O servidor utiliza seu próprio relógio em UTC.

### Renovação

A renovação utiliza:

```text
base = max(expiresAt, agora)
expiresAt = base + days
graceUntil = expiresAt + graceDays
```

Uma licença vencida é renovada a partir do momento atual.

A renovação não remove uma suspensão administrativa.

### Revogação

`REVOKED` é definitivo.

Uma instalação revogada não pode receber renovação, reativação, suspensão ou uma segunda licença.

Um novo contrato definitivo exige uma nova instalação, novo código e novo segredo.

---

## Validação de licenças

O endpoint:

```http
POST /api/v1/license/validate
```

Recebe:

```json
{
  "installationId": "BANABUIU-001",
  "installationSecret": "SEGREDO_REAL_DA_INSTALACAO"
}
```

O segredo é gerado com 48 bytes aleatórios e apresentado somente na criação da instalação.

Não existe endpoint para consultar o segredo novamente.

O banco armazena um digest SHA-256 do segredo de alta entropia, com comparação segura por `timingSafeEqual`.

Instalações desconhecidas e credenciais inválidas retornam o mesmo erro:

```text
401 INVALID_INSTALLATION_CREDENTIALS
```

Depois da autenticação, uma instalação sem licença retorna:

```text
404 LICENSE_NOT_FOUND
```

> [!IMPORTANT]
> Uma resposta HTTP 200 indica que a validação foi concluída. Não significa necessariamente que o software está autorizado a funcionar. O consumidor precisa verificar `license.status`.

### Assinatura digital

A assinatura Ed25519 protege exatamente estes campos:

```text
installationId
product
status
issuedAt
expiresAt
graceUntil
```

O protocolo v1 utiliza JSON compacto com chaves ordenadas em ASCII:

```text
expiresAt
graceUntil
installationId
issuedAt
product
status
```

As strings são codificadas em UTF-8 e escapadas segundo `JSON.stringify`.

A assinatura é representada em base64url sem padding.

A ordem original das propriedades não altera a verificação. Campos adicionais são rejeitados.

O módulo:

```text
src/utils/signature.ts
```

Exporta:

```typescript
canonicalizeLicense
signLicense
verifyLicense
```

### Verificar uma resposta

```powershell
npm run verify-license -- response.json keys/license-public.pem
```

A verificação utiliza exclusivamente a chave pública.

Alterar qualquer campo assinado invalida a assinatura.

A assinatura comprova autenticidade e integridade, mas não impede reutilização de uma resposta antiga. O consumidor futuro precisará implementar uma política de frescor de `issuedAt` e armazenamento seguro.

---

## Exemplo de operação

### 1. Autenticar administrador

```powershell
$base = 'http://localhost:3000/api/v1'

$emailAdmin = Read-Host 'Email do admin'
$senhaSegura = Read-Host 'Senha do admin' -AsSecureString

$credential = [System.Management.Automation.PSCredential]::new(
  $emailAdmin,
  $senhaSegura
)

$loginBody = @{
  email = $emailAdmin
  password = $credential.GetNetworkCredential().Password
} | ConvertTo-Json

$login = Invoke-RestMethod "$base/auth/login" `
  -Method Post `
  -ContentType 'application/json' `
  -Body $loginBody

Remove-Variable loginBody,credential,senhaSegura

$headers = @{
  Authorization = "Bearer $($login.token)"
}
```

### 2. Criar cliente

```powershell
$body = @{
  name = 'Prefeitura Municipal de Banabuiú'
} | ConvertTo-Json

$cliente = Invoke-RestMethod "$base/clients" `
  -Method Post `
  -Headers $headers `
  -ContentType 'application/json; charset=utf-8' `
  -Body ([Text.Encoding]::UTF8.GetBytes($body))
```

### 3. Criar produto

```powershell
$body = @{
  name = 'Sistema de Atendimento'
  code = 'sistema-atendimento'
} | ConvertTo-Json

$produto = Invoke-RestMethod "$base/products" `
  -Method Post `
  -Headers $headers `
  -ContentType 'application/json' `
  -Body $body
```

### 4. Criar instalação

```powershell
$body = @{
  clientId = $cliente.data.id
  productId = $produto.data.id
  installationId = 'BANABUIU-001'
  name = 'Servidor Banabuiú'
} | ConvertTo-Json

$instalacao = Invoke-RestMethod "$base/installations" `
  -Method Post `
  -Headers $headers `
  -ContentType 'application/json; charset=utf-8' `
  -Body ([Text.Encoding]::UTF8.GetBytes($body))
```

Guarde `installationSecret` em um gerenciador de segredos.

### 5. Criar licença

```powershell
$body = @{
  installationId = $instalacao.data.id
  days = 30
  graceDays = 5
} | ConvertTo-Json

$licenca = Invoke-RestMethod "$base/licenses" `
  -Method Post `
  -Headers $headers `
  -ContentType 'application/json' `
  -Body $body
```

Observe que a criação da licença utiliza o UUID interno da instalação.

### 6. Validar licença

```powershell
$body = @{
  installationId = 'BANABUIU-001'
  installationSecret = $instalacao.installationSecret
} | ConvertTo-Json

$validacao = Invoke-RestMethod "$base/license/validate" `
  -Method Post `
  -ContentType 'application/json' `
  -Body $body

$validacao | ConvertTo-Json -Depth 5 |
  Set-Content -Encoding UTF8 response.json

Remove-Variable body,instalacao

npm run verify-license -- response.json keys/license-public.pem
```

O código externo `BANABUIU-001` é utilizado na validação.

Esse roteiro é destinado a um banco novo e deve ser executado uma vez. Identificadores de produto e instalação repetidos retornam conflito 409.

O arquivo `response.json` contém uma resposta de validação e deve ser tratado conforme a política de segurança do ambiente.

### Operações administrativas

Renovar:

```powershell
$licenseId = $licenca.data.id

Invoke-RestMethod "$base/licenses/$licenseId/renew" `
  -Method Post `
  -Headers $headers `
  -ContentType 'application/json' `
  -Body '{"days":30,"graceDays":5}'
```

Suspender:

```powershell
Invoke-RestMethod "$base/licenses/$licenseId/suspend" `
  -Method Post `
  -Headers $headers `
  -ContentType 'application/json' `
  -Body '{"reason":"Suspensao administrativa"}'
```

Reativar:

```powershell
Invoke-RestMethod "$base/licenses/$licenseId/reactivate" `
  -Method Post `
  -Headers $headers `
  -ContentType 'application/json' `
  -Body '{}'
```

Consultar auditoria:

```powershell
Invoke-RestMethod "$base/events?licenseId=$licenseId&page=1&limit=20" `
  -Headers $headers
```

A revogação é definitiva e deve ser utilizada somente quando houver intenção de encerrar permanentemente a licença.

---

## Auditoria e concorrência

As operações administrativas e a criação de entidades relevantes geram eventos de auditoria na mesma transação que os dados.

Os eventos administrativos registram o UUID do administrador responsável.

### Validação auditada

O evento `LICENSE_VALIDATED` é registrado:

- Na primeira validação.
- Quando o estado final muda.
- Na primeira validação após 24 horas do último evento correspondente.

O campo `lastValidationAt` é atualizado em toda validação autenticada com licença.

Credenciais inválidas não geram eventos de validação.

### Consistência transacional

A aplicação utiliza locks PostgreSQL associados à instalação para coordenar:

- Renovação.
- Suspensão.
- Reativação.
- Revogação.
- Validação.

Isso evita perda de atualizações concorrentes e duplicação indevida de eventos.

A assinatura é produzida dentro da transação. Uma falha na assinatura desfaz a atualização de auditoria correspondente.

Não existe limpeza automática do histórico.

---

## Segurança

A aplicação implementa controles em diferentes camadas.

| Proteção | Implementação |
| --- | --- |
| Senhas administrativas | bcrypt custo 12 |
| Sessões administrativas | JWT |
| Assinatura de licenças | Ed25519 |
| Credenciais de instalação | Segredos aleatórios de alta entropia |
| Comparação de digests | `timingSafeEqual` |
| Validação de entrada | Zod |
| Limitação de requisições | Rate limiting |
| Integridade de operações | Transações PostgreSQL |
| Auditoria | Eventos persistentes |
| Segredos de produção | Variáveis protegidas ou arquivos restritos |

A API não registra intencionalmente senhas, tokens, hashes, segredos ou corpos de requisições.

As respostas de erro não expõem stack traces internos.

### HTTPS e proxies

Em produção, utilize HTTPS na plataforma de hospedagem ou proxy.

A configuração atual utiliza:

```text
trust proxy = false
```

A aplicação não confia automaticamente em `X-Forwarded-For`.

Atrás de um proxy, os limites podem ser compartilhados pelo IP desse proxy até que uma configuração explícita de proxies confiáveis seja adotada.

O limiter em memória é apropriado a uma instância. Para múltiplas réplicas, considere armazenamento compartilhado para limites globais.

O endereço IP não define o direito de utilização de uma licença.

---

## Testes e qualidade

### Verificação de tipos

```powershell
npm run typecheck
```

### Build

```powershell
npm run build
```

### Testes unitários

```powershell
npm run test:unit
```

Os testes unitários não exigem PostgreSQL.

### Suíte completa

```powershell
npm test
```

A suíte completa utiliza PostgreSQL 17 isolado em Docker.

O runner:

1. Cria um contêiner temporário.
2. Seleciona uma porta aleatória de loopback.
3. Gera credenciais temporárias.
4. Aplica a migration real.
5. Executa os testes.
6. Remove os recursos temporários criados.

Não utiliza o `DATABASE_URL` do ambiente como destino dos testes.

Não reseta bancos existentes.

Se o Docker ou a migration falhar, o teste falha explicitamente.

Se houver encerramento forçado, verifique contêineres temporários com prefixo `central-licencas-test-` antes de removê-los.

### Verificação de dependências

```powershell
npm audit
```

### Executar sem o teste de revogação permanente

```powershell
npm test -- --testNamePattern '^(?!.*REVOKED is permanent)'
```

### Cobertura funcional

Os testes incluem autenticação, JWT inválido e expirado, permissões administrativas, CRUD, validação Zod, integridade relacional, licenciamento, estados administrativos, renovação concorrente, revogação definitiva, assinatura Ed25519, adulteração de respostas, auditoria, paginação, rate limiting, erros HTTP e headers de segurança.

---

## Deploy no Railway

A publicação pode utilizar Railway com PostgreSQL exclusivo.

A configuração abaixo descreve o procedimento planejado; não significa que o deploy já tenha sido executado.

### Configuração do serviço

| Campo | Valor |
| --- | --- |
| Root Directory | `central-licencas` |
| Runtime | Node.js 22.22.3+ |
| Build Command | `npm ci --include=dev && npm run prisma:generate && npm run build` |
| Pre-Deploy Command | `npm run db:migrate` |
| Start Command | `npm start` |
| Health Check | `/health` |

### Variáveis

Configure no serviço da API:

```text
NODE_ENV
DATABASE_URL
JWT_SECRET
JWT_EXPIRES_IN
LICENSE_PRIVATE_KEY_BASE64
LICENSE_PUBLIC_KEY_BASE64
```

O Railway pode fornecer a variável `PORT` automaticamente.

As configurações de rate limiting são opcionais.

Use a referência à URL do PostgreSQL exclusivo da Central.

Proteja especialmente `JWT_SECRET` e `LICENSE_PRIVATE_KEY_BASE64`, utilizando controles de segredo da plataforma quando apropriado.

Não é necessário enviar arquivos PEM nem criar volume para as chaves quando ambas são fornecidas em Base64.

Não execute automaticamente:

```text
generate-keys
create-admin
```

Essas operações exigem controle administrativo.

### Documentação

- [Variáveis do Railway](https://docs.railway.com/variables)
- [Start Command](https://docs.railway.com/deployments/start-command)
- [Transações Prisma 6](https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions)
- [Tratamento de erros Express 5](https://expressjs.com/en/5x/guide/error-handling/)

---

## Estrutura do projeto

```text
central-licencas/
│
├── docs/
│   └── images/
│       ├── logo.png
│       ├── dashboard.png
│       ├── clientes.png
│       ├── produtos.png
│       ├── instalacoes.png
│       ├── licencas.png
│       ├── auditoria.png
│       └── login.png
│
├── src/
│   ├── app.ts
│   ├── server.ts
│   ├── config/
│   ├── middleware/
│   ├── repositories/
│   ├── routes/
│   ├── services/
│   ├── types/
│   └── utils/
│
├── prisma/
│   ├── schema.prisma
│   └── migrations/
│
├── scripts/
│   ├── create-admin.ts
│   ├── generate-signing-keys.ts
│   ├── verify-license.ts
│   └── test-runner.mjs
│
├── keys/
│   └── .gitkeep
│
├── tests/
│   ├── api.test.ts
│   └── policy.test.ts
│
├── .env.example
├── package.json
├── package-lock.json
├── tsconfig.json
├── ADMIN-PANEL-REPORT.md
└── README.md
```

A pasta `docs/images/` é a estrutura sugerida para as capturas de tela. Os arquivos de imagem precisam ser adicionados manualmente.

O diretório `keys/` não deve conter chaves privadas versionadas.

---

## Limites do projeto

A Central de Licenças é responsável pelo gerenciamento e validação do licenciamento.

Não fazem parte desta etapa:

- Integração direta com o `sistema-senhas`.
- Alterações no aplicativo Electron.
- Processamento de pagamentos.
- Criação automática de administradores.
- Distribuição automática de chaves públicas.
- Política de cache ou funcionamento offline do consumidor.

Essas funcionalidades dependem de etapas específicas de integração.

---

## Documentação complementar

Consulte [ADMIN-PANEL-REPORT.md](ADMIN-PANEL-REPORT.md) para informações adicionais sobre o painel administrativo, endpoints, segurança e validações realizadas.

---

<div align="center">

**Central de Licenças**

Infraestrutura independente para gerenciamento seguro de licenças de software.

<sub>Node.js · TypeScript · PostgreSQL · Prisma · Ed25519</sub>

</div>
