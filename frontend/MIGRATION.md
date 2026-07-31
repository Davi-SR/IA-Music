# Migração do frontend para React

## Arquitetura

- `src/api`: cliente tipado dos contratos FastAPI existentes.
- `src/components`: shell compartilhado, navegação, cursor e ícones.
- `src/features/jobs`: upload, YouTube, validação, polling e estados dos jobs.
- `src/features/library`: biblioteca e mixer multifaixas.
- `src/pages`: entradas Home e Minhas Músicas.
- `src/styles`: CSS visual original preservado e complemento React mínimo.
- `tests/e2e`: fluxos críticos em Chromium desktop/mobile.

O Vite gera duas entradas em `Front/glass-effect2/`, mantendo as URLs públicas
e o diretório estático configurado no FastAPI. `design-system.html` não faz
parte do build e permanece inalterado.

## Inventário e decisão

| Grupo | Decisão | Motivo |
|---|---|---|
| `design-system.html`, `assets/` | MANTER | Referência visual e assets locais |
| `styles.css`, `navigation.css`, `youtube*.css`, `library.css` | MIGRAR | Copiados para `frontend/src/styles` e empacotados pelo Vite |
| `app.js`, `api.js`, `youtube-v2.js`, `library-v3.js`, `cursor.js` | MIGRAR | Responsabilidades reimplementadas com componentes e hooks tipados |
| `completion-link.js` | MESCLAR | Link do mixer passou a ser renderizado pelo estado de sucesso React |
| `youtube.js`, `library.js`, `library-v2.js` | DELETAR | Versões antigas já substituídas antes da migração |
| `config.js` | DELETAR | Configuração e carregamento tardio substituídos por imports estáticos |
| `index.html`, `musics.html` | MIGRAR | Viraram entradas Vite independentes |

## Validação visual

Foram capturados Home, YouTube, biblioteca e mixer antes/depois em 1440 px e
390 px. As evidências e diffs estão em `artifacts/visual/`.

Diferença pixel a pixel:

| Estado | Desktop | Mobile |
|---|---:|---:|
| Home | 0,0100% | 0,0673% |
| YouTube | 0,0178% | 0,0460% |
| Biblioteca | 0,0008% | 0,0035% |
| Mixer | 0,0007% | 0,0006% |

## Comandos de validação

```powershell
cd frontend
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:visual
```

Na raiz, a regressão do backend continua disponível com:

```powershell
uv run pytest
```
