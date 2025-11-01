# 🤝 Contributing Guide

Este documento define o workflow de desenvolvimento para este projeto.

## 🗺️ Como Executar Tarefas do Roadmap

1.  **Identifique a Prioridade:** Consulte o `/.roadmap/README.md` para ver qual Plano de Produto está marcado como `[🔄]` (Em Andamento).
2.  **Abra o Arquivo da Tarefa:** Navegue até o arquivo de tarefa detalhado (ex: `tasks/01_PROJECT_SETUP.md`).
3.  **Selecione uma Tarefa:** Encontre um item com checkbox `[ ]`.
4.  **Crie uma Issue no GitHub:** Crie uma issue específica para esta tarefa técnica.
5.  **Execute o Fluxo Padrão:** Siga o fluxo de `branch -> código -> verificações -> PR`.

## 🔄 Workflow de Desenvolvimento

1. **Criar/Encontrar Issue (OBRIGATÓRIO)**: Nenhum trabalho começa sem uma issue.
2. **Criar Branch**: `gemini/<description>-<issue_number>`
3. **Desenvolver**: Faça commits atômicos e frequentes.
4. **Criar Pull Request**: Use o template e preencha todas as seções.
5. **Code Review**: Responda aos feedbacks e ajuste o código.
6. **Merge**: Após aprovação, faça o merge e delete a branch.

## 💾 Commits e Branches

### Commit Messages
Siga o padrão **Conventional Commits**: `<type>(<scope>): <subject>`

### Branch Naming
`gemini/<description>-<issue_number>`
