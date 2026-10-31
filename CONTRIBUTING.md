# Contribuir

Obrigado por quereres melhorar o Palco. Este documento explica como.

## Reportar bugs

Abre uma issue com:

- **O que aconteceu** — descrição do comportamento observado
- **O que esperavas** — descrição do comportamento esperado
- **Como reproduzir** — passos concretos
- **Contexto** — navegador, sistema, e se é a versão pública ou local
- **Consola** — erros relevantes do DevTools (F12 → Console)

Se possível, inclui uma captura de ecrã ou um GIF curto.

## Sugerir funcionalidades

Abre uma issue com a etiqueta `enhancement`. Descreve:

- **O problema** que a funcionalidade resolve (não a solução)
- **Como é usado hoje** sem ela
- **Como imaginas a solução** (opcional, mas ajuda)

## Enviar alterações

1. Faz fork do repositório
2. Cria um branch com nome descritivo (`fix/timer-pause`, `feat/novo-tema`)
3. Segue o estilo do código existente (ver "Convenções" abaixo)
4. Corre os testes: `node tests/logic.test.js`
5. Abre um pull request com uma descrição clara

### Convenções

- **Sem build, sem bundler, sem transpilador.** O projeto usa JavaScript simples carregado por `<script>`. Não introduzas dependências que exijam build.
- **Funções puras sempre que possível.** Se estás a mexer em `Scenes`, não toques no DOM.
- **Não dupliques estado.** Se precisas de um dado, lê do `Store`.
- **A TV é "burra".** Se a tua alteração introduz regras de negócio na TV, confirma que não podem viver no `Store` ou no controlo.
- **Preserva a compatibilidade do formato dos dados.** Se o formato mudar, incrementa `Store.VERSION` e trata a migração em `Store.normalize()`.
- **Sem travessões (—) nem emojis excessivos nos textos visíveis.** A interface é sóbria de propósito.

### Estrutura do projeto

Ver [ARCHITECTURE.md](ARCHITECTURE.md) para uma descrição de cada módulo e das decisões de design.

## Testes

    node tests/logic.test.js

Os testes cobrem `Utils`, `Scenes` e `Store.normalize`. Se alterares alguma dessas camadas, acrescenta testes.

## Licença

Ao contribuíres, concordas que a tua contribuição é distribuída sob a licença MIT do projeto.
