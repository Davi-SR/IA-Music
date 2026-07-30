# MUSICAI — front-end

Interface consumidora da API FastAPI servida pelo próprio projeto. O usuário
pode enviar um MP3/WAV ou informar uma URL do YouTube; download, conversão,
separação e empacotamento acontecem somente no backend.

Execute a aplicação completa na raiz:

```powershell
uv run python main.py
```

Abra `http://127.0.0.1:8000/`.

O contrato usado pela interface é:

```text
POST /api/jobs
GET  /api/jobs/{job_id}
GET  /api/jobs/{job_id}/download
```

O POST multipart recebe exatamente um dos campos:

- `file`: MP3 ou WAV de até 500 MB;
- `youtube_url`: URL de um vídeo do YouTube.

Para visualizar estados simulados do fluxo de arquivo, acesse
`http://127.0.0.1:8000/?dev=states`.

