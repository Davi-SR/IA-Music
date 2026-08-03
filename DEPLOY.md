# MUSICAI — Docker

## Arquitetura

O serviço `frontend` é o Nginx público: ele serve o build React e encaminha `/api/*` ao `backend` pela rede interna. O backend mantém uma única instância/Uvicorn worker para preservar a compatibilidade com SQLite, BackgroundTasks e Demucs. `musicai_data` persiste banco, jobs, stems e ZIPs; `musicai_model_cache` persiste os modelos.

A lógica homologada do Demucs, incluindo `htdemucs_6s`, não é alterada. O backend inclui FFmpeg e roda como usuário não-root.

## Configuração

```bash
cp .env.example .env
```

Preencha Google OAuth e SMTP no `.env`. Em produção use callback HTTPS e `MUSICAI_SECURE_COOKIES=true`. Segredos nunca devem estar em `VITE_*`, Dockerfile ou Git.

## Execução

```bash
docker compose -f compose.yaml -f compose.dev.yaml up --build
docker compose -f compose.yaml -f compose.homolog.yaml up -d --build
docker compose -f compose.yaml -f compose.prod.yaml up -d --build
```

Desenvolvimento usa `http://127.0.0.1:5173`; produção publica apenas o Nginx. Coloque TLS no load balancer/proxy ou em um Nginx externo; certificados não entram na imagem.

## Operação

```bash
docker compose config
docker compose ps
docker compose logs -f backend
docker stats
docker system df
docker compose restart backend
```

Mantenha `AUDIO_MAX_CONCURRENT_JOBS=1` e não escale horizontalmente usando o mesmo SQLite.

## Backup

```bash
docker compose exec backend /app/scripts/backup-sqlite.sh
docker compose cp backend:/data/backups/musicai-YYYYMMDDTHHMMSSZ.db ./backup.db
```

Para restaurar um backup validado, pare o backend, copie o arquivo para `/tmp/backup.db`, suba o serviço e rode:

```bash
docker compose exec backend /app/scripts/restore-sqlite.sh /tmp/backup.db
```

Os scripts usam o backup nativo do SQLite e `integrity_check`. Não use `docker compose down -v` em deploy normal.

## Atualização e limitações

Faça backup, atualize a tag, reconstrua, valide `/api/health` e só depois remova imagens antigas. Rollback deve voltar à tag anterior sem remover volumes. Jobs em execução não são retomados automaticamente após reinício; o MVP é de instância única, com concorrência limitada e cache local do modelo.

## Validação funcional

Após `docker compose ... up -d`, teste página, login, upload MP3/WAV, URL do YouTube, Demucs, os seis stems, ZIP, download e persistência depois de reiniciar/recriar o container sem `-v`.
