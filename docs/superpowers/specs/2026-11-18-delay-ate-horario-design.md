# Passo DELAY: esperar até uma data vinda de variável — desenho

Data: 18/11/2026. Pedido pela integração da loja BitGeek (repositório `bitgeekstore/loja`, desenho em `docs/superpowers/specs/2026-11-17-comunicacao-via-plunk-design.md` daquele repositório). A implementação é feita só neste repositório (Plunk), numa sessão própria.

## Por quê

A loja dispara eventos no Plunk e os workflows enviam e-mail e WhatsApp. As regras de proteção do WhatsApp — janela das 8h às 20h, intervalo entre mensagens ao mesmo número e opt-out — são da loja, não do Plunk. O workflow pergunta à loja por um passo `WEBHOOK` (com `saveResponseAs`) se e quando pode enviar, e a loja responde com um horário. Falta o workflow conseguir **esperar até esse horário**: hoje o `DELAY` só aceita um número fixo escrito no workflow.

Fluxo que precisa funcionar num único workflow:

```
order.delivered
 → DELAY 3 dias                          (modo atual, sem mudança)
 → WEBHOOK agendar_whatsapp, saveResponseAs: "whatsapp"
       loja responde {"permitido": true, "enviar_em": "2026-11-21T08:02:31-03:00"}
 → CONDITION event.whatsapp.permitido == true  (não → EXIT)
 → DELAY até "{{event.whatsapp.enviar_em}}"    (modo novo)
 → WEBHOOK confirmar_whatsapp → CONDITION      (reconferência na loja)
 → SEND_WHATSAPP
```

Alternativa descartada: `WAIT_FOR_EVENT` com um evento "liberado" mandado pela loja. `handleEvent` retoma todas as execuções do contato que esperam aquele nome de evento, então duas mensagens do mesmo contato sairiam juntas.

## O que muda

Uma capacidade genérica de workflow. **Nenhuma regra de negócio da loja entra no Plunk** (nada de janela de horário, fuso fixo, opt-out de WhatsApp ou intervalo por número).

### 1. Configuração do passo (`packages/shared/src/schemas/index.ts`, `WorkflowStepConfigSchemas.delay`)

Dois modos:

- **Duração** (atual): `{ amount, unit }`. Configuração sem `mode` continua sendo este modo — nenhum workflow existente muda.
- **Até uma data** (novo): `{ mode: "until", until: string }`. `until` é texto com a mesma linguagem de modelo dos outros passos (ex.: `"{{event.whatsapp.enviar_em}}"`) ou uma data literal.

Validação ao salvar: `until` não vazio; se não tiver `{{`, precisa ser uma data válida (abaixo). O limite de 365 dias continua valendo nos dois modos. Gerar o `dist` de `packages/shared` como o repositório já faz.

### 2. Execução (`apps/api/src/services/WorkflowExecutionService.ts`, `executeDelay`)

No modo `until`:

1. Renderizar `until` com o mesmo escopo de variáveis de `SEND_EMAIL`/`WEBHOOK` (contato, `data`, contexto da execução e `event` = contexto, onde fica a resposta guardada por `saveResponseAs`). Reaproveitar `renderTemplate`.
2. Interpretar o resultado como data ISO 8601 **com fuso** (`Z` ou `±HH:MM`). Sem fuso, é inválida — o Plunk não escolhe fuso por conta própria.
3. Data no passado ou agora → segue para o próximo passo sem esperar (atraso 0; `queueWorkflowDelayEnd` já aceita `Math.max(0, …)`).
4. Data vazia, inválida ou a mais de 365 dias → o passo falha e a execução vai para `FAILED` com uma mensagem clara (ex.: `DELAY until: "abc" não é uma data ISO 8601 com fuso`). **Nunca seguir em frente sem esperar quando a data é inválida**: isso enviaria a mensagem fora do horário que a loja calculou.
5. `output` do passo grava o texto renderizado e o `resumeAt`, como o modo atual grava `delayAmount`/`delayUnit`/`resumeAt`.

`processDelayEnd`, cancelamento, trava de workflow com execuções ativas e retomada continuam iguais — o modo novo só muda o cálculo de `delayMs`.

### 3. Editor (`apps/web/src/components/workflow-steps/DelayStepDialog.tsx`, `WorkflowVisualizer.tsx`, `WorkflowBuilder.tsx`)

- Escolha entre "Por um tempo" (campos atuais) e "Até a data em" (campo de texto com dica de variável, ex. `{{event.whatsapp.enviar_em}}`).
- O cartão do passo no desenho do workflow mostra "Até {{event.whatsapp.enviar_em}}" no modo novo.
- Textos da interface seguem a tradução pt-BR já existente no fork.

### 4. API e documentação

- `POST/PATCH /workflows/:id/steps` aceitam a configuração nova (vem do schema compartilhado).
- `apps/wiki/content/docs/concepts/workflows.mdx`: tabela de passos (`DELAY` com os dois modos) e um exemplo com `WEBHOOK` + `saveResponseAs` + `DELAY` até a data.

## Testes

Em `apps/api/src/services/__tests__/WorkflowExecutionService.delay.test.ts` (e testes do schema):

- data futura vinda de `saveResponseAs` → espera até ela (`resumeAt` correto, execução `WAITING`);
- data passada → segue na hora;
- variável ausente, texto inválido, data sem fuso → `FAILED` com a mensagem;
- data a mais de 365 dias → recusada;
- configuração antiga `{amount, unit}` sem `mode` → comportamento idêntico ao atual;
- schema: `until` literal inválido é recusado ao salvar; `until` com `{{…}}` é aceito.

## Fora do escopo

- Regras de horário, fuso, intervalo por número e opt-out (ficam na loja).
- Mudanças em `WAIT_FOR_EVENT`, `SEND_WHATSAPP` ou no envio direto `/v1/whatsapp/send`.

## Contrato combinado com a loja

A loja responde ao `WEBHOOK` com `enviar_em` sempre em ISO 8601 com fuso (ex.: `2026-11-21T08:02:31-03:00`). Quando não deve enviar, responde `permitido: false` e o workflow sai pelo `CONDITION`.
