# Sistema Inteligente de Planejamento Acadêmico com IA — SENAI

Sistema completo para gerenciamento de cronogramas acadêmicos com geração automática de horários, controle de regência docente e análise por Inteligência Artificial.

---

## Stack Tecnológica

| Camada | Tecnologia |
|--------|-----------|
| Frontend | Next.js 14 (App Router) + TypeScript + Tailwind CSS |
| Backend | FastAPI (Python 3.12) + SQLAlchemy 2.0 async |
| Banco de Dados | PostgreSQL 16 |
| IA | Anthropic Claude Opus 4.8 |
| Fila | Celery + Redis |
| Containers | Docker Compose |

---

## Pré-requisitos

- **Docker Desktop** instalado e em execução
- **Git**
- Chave de API da Anthropic (opcional — IA não funciona sem ela)

---

## Setup Rápido (Docker)

```bash
# 1. Clone e entre no projeto
cd Projeto_Claude

# 2. Copie e configure o .env
cp .env.example .env
# Edite .env e defina ANTHROPIC_API_KEY=sk-ant-...

# 3. Suba todos os serviços
docker compose up -d

# 4. Aguarde os containers iniciarem (≈30s) e acesse:
#    Frontend: http://localhost:3000
#    Backend API: http://localhost:8000
#    Docs Swagger: http://localhost:8000/docs
```

---

## Setup Local (sem Docker)

### Backend

```bash
cd backend

# Crie e ative virtualenv
python -m venv venv
source venv/bin/activate      # Linux/Mac
venv\Scripts\activate         # Windows

# Instale dependências
pip install -r requirements.txt

# Configure .env (copie de ../.env.example)
cp ../.env.example .env
# Edite DATABASE_URL para apontar para seu PostgreSQL local

# Execute migrações
alembic upgrade head

# Inicie o servidor
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
# Acesse http://localhost:3000
```

---

## Primeiro Acesso

1. Acesse [http://localhost:3000](http://localhost:3000)
2. Será redirecionado para `/login`
3. Registre o primeiro usuário via API:
   ```bash
   curl -X POST http://localhost:8000/api/v1/auth/registrar \
     -H "Content-Type: application/json" \
     -d '{"nome": "Admin", "email": "admin@senai.br", "senha": "senha123", "perfil": "admin"}'
   ```
4. Faça login com o email e senha criados

---

## Importação de Dados

1. Acesse **Importar Dados** no menu lateral
2. Prepare sua planilha Excel com as seguintes abas:
   - **CURSOS**: `codigo, nome, carga_horaria_total, modalidade, area`
   - **PROFESSORES**: `nome, cpf, email, tipo (Mensalista/Horista), horas_contratadas, valor_hora`
   - **ATUAÇÃO**: `professor, disciplina, curso (código), nivel_competencia (1-5)`
   - **DISPONIBILIDADE DETALHADA**: `professor, dia_semana, horario_inicio, horario_fim, tipo_disponibilidade`
   - **CALENDÁRIO ACADÊMICO**: `data (dd/mm/aaaa), tipo (Aula/Feriado/Recesso), descricao, periodo`
3. Arraste o arquivo ou clique para selecionar
4. A importação é **incremental** — nenhum dado é deletado

---

## Funcionalidades Principais

### Dashboard
- KPIs globais: professores ativos, turmas, aulas da semana
- **Regência por professor** com barra de progresso visual
- Alertas automáticos para professores abaixo da meta (70%)
- Progresso de cada turma

### Turmas / Eventos
- Cadastro de turmas com todos os parâmetros
- **Geração automática de aulas** respeitando restrições:
  - Sem conflito de professor
  - Sem conflito de sala
  - Respeitada disponibilidade do professor
  - Excluídos feriados/recessos do calendário
- Edição manual de aulas com **replanejamento inteligente automático**

### Professores
- Cadastro de professores (Mensalistas e Horistas)
- Cálculo de regência: `horas_ministradas / horas_contratadas`
- Meta: 70% para mensalistas
- Status visual: OK / Alerta / Crítico / Sobrecarga

### Cronograma Semanal
- Visão semanal com navegação entre semanas
- Filtro por professor
- Código de cores por status da aula

### Replanejamento Inteligente
Quando o coordenador altera uma aula:
1. A aula é alterada com registro do motivo
2. As aulas futuras são recalculadas automaticamente
3. O mesmo professor é mantido (se não houver conflito)
4. Se houver conflito, sugere professores alternativos
5. Todo o histórico antes/depois é salvo

### Análise com IA (Claude Opus 4.8)
- Análise narrativa do cronograma baseada nos dados reais
- Sugestão de redistribuição de carga
- Relatório executivo (mensal/semanal/semestral)
- **A IA nunca inventa dados** — usa exclusivamente o banco

---

## Estrutura do Projeto

```
Projeto_Claude/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app
│   │   ├── config.py            # Configurações
│   │   ├── database.py          # SQLAlchemy async
│   │   ├── models/              # Modelos do banco
│   │   ├── schemas/             # Schemas Pydantic
│   │   ├── api/v1/              # Rotas REST
│   │   ├── services/            # Lógica de negócio
│   │   │   ├── excel_import.py  # Importação Excel
│   │   │   ├── excel_export.py  # Exportação Excel
│   │   │   ├── regencia.py      # Cálculo de regência
│   │   │   ├── replanejamento.py # Replanejamento inteligente
│   │   │   └── ia_service.py   # Integração Claude AI
│   │   └── algorithms/
│   │       └── constraint_solver.py  # Geração de cronograma (CSP)
│   ├── alembic/                 # Migrações de banco
│   └── requirements.txt
├── frontend/
│   └── src/app/
│       ├── (app)/               # Páginas autenticadas
│       │   ├── dashboard/
│       │   ├── eventos/
│       │   ├── professores/
│       │   ├── cursos/
│       │   ├── cronograma/
│       │   ├── importacao/
│       │   ├── relatorios/
│       │   ├── historico/
│       │   └── ia/
│       └── login/
├── docker-compose.yml
└── .env.example
```

---

## API REST — Endpoints Principais

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | `/api/v1/auth/login` | Login JWT |
| POST | `/api/v1/importacao/excel` | Importar planilha |
| GET | `/api/v1/dashboard` | KPIs gerais |
| GET/POST | `/api/v1/eventos` | Turmas |
| POST | `/api/v1/eventos/{id}/gerar-aulas` | Gerar aulas automaticamente |
| GET/PUT | `/api/v1/aulas/{id}` | Alterar aula + replanejamento |
| GET | `/api/v1/professores/regencia` | Regência de todos os professores |
| POST | `/api/v1/ia/analisar` | Análise com Claude AI |
| GET | `/api/v1/relatorios/regencia` | Export Excel regência |
| GET | `/api/v1/versoes/evento/{id}` | Histórico de alterações |

Documentação completa: [http://localhost:8000/docs](http://localhost:8000/docs)

---

## Variáveis de Ambiente

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `ANTHROPIC_API_KEY` | Chave API Claude (obrigatória para IA) | — |
| `DATABASE_URL` | URL PostgreSQL | `postgresql+asyncpg://...` |
| `SECRET_KEY` | Chave JWT (mude em produção!) | — |
| `REDIS_URL` | URL Redis para Celery | `redis://localhost:6379/0` |
| `CORS_ORIGINS` | Origens CORS permitidas | `http://localhost:3000` |
