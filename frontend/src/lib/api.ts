import axios from "axios";
import Cookies from "js-cookie";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export const api = axios.create({
  baseURL: `${API_URL}/api/v1`,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  const token = Cookies.get("access_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) {
      Cookies.remove("access_token");
      if (typeof window !== "undefined") {
        localStorage.removeItem("current_user");
        // Preserva a rota atual para redirecionar após novo login
        const redirect = window.location.pathname;
        window.location.href = redirect && redirect !== "/login"
          ? `/login?redirect=${encodeURIComponent(redirect)}`
          : "/login";
      }
    }
    return Promise.reject(error);
  }
);

// Auth
export const authApi = {
  login: (email: string, senha: string) =>
    api.post("/auth/login", { email, senha }).then((r) => r.data),
  me: () => api.get("/auth/me").then((r) => r.data),
};

// Cursos
export const cursosApi = {
  listar: (ativo?: boolean) =>
    api.get("/cursos/", { params: { ativo } }).then((r) => r.data),
  criar: (data: any) => api.post("/cursos/", data).then((r) => r.data),
  atualizar: (id: number, data: any) =>
    api.put(`/cursos/${id}`, data).then((r) => r.data),
  deletar: (id: number) => api.delete(`/cursos/${id}`),
  ucs: (id: number) => api.get(`/cursos/${id}/ucs`).then((r) => r.data),
  criarUc: (cursoId: number, data: any) =>
    api.post(`/cursos/${cursoId}/ucs`, data).then((r) => r.data),
  atualizarUc: (cursoId: number, ucId: number, data: any) =>
    api.put(`/cursos/${cursoId}/ucs/${ucId}`, data).then((r) => r.data),
  deletarUc: (cursoId: number, ucId: number) =>
    api.delete(`/cursos/${cursoId}/ucs/${ucId}`),
  reordenarUcs: (cursoId: number, items: { id: number; sequencia: number; modulo_etapa?: string | null }[]) =>
    api.patch(`/cursos/${cursoId}/ucs/reorder`, items),
};

// Professores
export const professoresApi = {
  listar: (params?: { ativo?: boolean; tipo?: string }) =>
    api.get("/professores/", { params }).then((r) => r.data),
  obter: (id: number) => api.get(`/professores/${id}`).then((r) => r.data),
  detalhes: (id: number) => api.get(`/professores/${id}/detalhes`).then((r) => r.data),
  criar: (data: any) => api.post("/professores/", data).then((r) => r.data),
  atualizar: (id: number, data: any) =>
    api.put(`/professores/${id}`, data).then((r) => r.data),
  regencias: (params?: { data_inicio?: string; data_fim?: string }) =>
    api.get("/professores/regencia", { params }).then((r) => r.data),
  regencia: (id: number, params?: any) =>
    api.get(`/professores/${id}/regencia`, { params }).then((r) => r.data),
  adicionarDisponibilidade: (
    id: number,
    data: { dia_semana: number; horario_inicio: string; horario_fim: string; tipo: string }
  ) => api.post(`/professores/${id}/disponibilidades`, null, { params: data }).then((r) => r.data),
  removerDisponibilidade: (id: number, dispId: number) =>
    api.delete(`/professores/${id}/disponibilidades/${dispId}`),
  adicionarAtuacao: (id: number, disciplina: string, cursoId?: number, modalidade = "Habilitação Técnica") =>
    api
      .post(`/professores/${id}/atuacoes`, null, {
        params: { disciplina, curso_id: cursoId, modalidade, nivel: 3 },
      })
      .then((r) => r.data),
  removerAtuacao: (id: number, atuacaoId: number) =>
    api.delete(`/professores/${id}/atuacoes/${atuacaoId}`),
  disponibilidadeBulk: (
    id: number,
    slots: { dia_semana: number; horario_inicio: string; horario_fim: string; tipo: string }[]
  ) => api.put(`/professores/${id}/disponibilidades/bulk`, slots).then((r) => r.data),
  atualizarModalidade: (id: number, atuacaoId: number, modalidade: string) =>
    api
      .patch(`/professores/${id}/atuacoes/${atuacaoId}`, null, { params: { modalidade } })
      .then((r) => r.data),
};

// Eventos
export const eventosApi = {
  listar: (params?: any) =>
    api.get("/eventos/", { params }).then((r) => r.data),
  criar: (data: any) => api.post("/eventos/", data).then((r) => r.data),
  obter: (id: number) => api.get(`/eventos/${id}`).then((r) => r.data),
  atualizar: (id: number, data: any) =>
    api.put(`/eventos/${id}`, data).then((r) => r.data),
  gerarAulas: (id: number, substituir = false) =>
    api.post(`/eventos/${id}/gerar-aulas`, null, { params: { substituir } }).then((r) => r.data),
  deletar: (id: number) => api.delete(`/eventos/${id}`),
};

// Aulas
export const aulasApi = {
  listar: (params?: any) => api.get("/aulas/", { params }).then((r) => r.data),
  alterar: (id: number, data: any) =>
    api.put(`/aulas/${id}`, data).then((r) => r.data),
  alternativas: (id: number) =>
    api.get(`/aulas/${id}/alternativas`).then((r) => r.data),
};

// Dashboard
export const dashboardApi = {
  get: () => api.get("/dashboard/").then((r) => r.data),
};

// Ofertas / Eventos SENAI
export const ofertasApi = {
  listar: (params?: {
    semestre?: number; status?: string; modalidade?: string;
    area?: string; turno?: string; busca?: string; skip?: number; limit?: number;
  }) => api.get("/ofertas/", { params }).then((r) => r.data),
  stats: (semestre?: number) =>
    api.get("/ofertas/stats", { params: { semestre } }).then((r) => r.data),
  criar: (dados: Record<string, unknown>) =>
    api.post("/ofertas/", dados).then((r) => r.data),
  atualizar: (id: number, dados: Record<string, unknown>) =>
    api.patch(`/ofertas/${id}`, dados).then((r) => r.data),
  atualizarStatus: (id: number, status: string) =>
    api.patch(`/ofertas/${id}/status`, null, { params: { status } }).then((r) => r.data),
  importar: (file: File) => {
    const form = new FormData();
    form.append("arquivo", file);
    return api.post("/ofertas/importar", form, {
      transformRequest: (data, headers) => { if (headers) delete headers["Content-Type"]; return data; },
    }).then((r) => r.data);
  },
};

// Planejamento automático
export const planejamentoApi = {
  criarUcAvulsa: (eventoId: number, body: { nome: string; carga_horaria: number; modulo_etapa?: string }) =>
    api.post(`/planejamento/uc-avulsa/${eventoId}`, body).then((r) => r.data),
  fromOferta: (ofertaId: number, body: {
    horario_inicio?: string;
    horario_fim?: string;
    dias_semana?: number[];
    horas_semanais?: number;
  }) => api.post(`/planejamento/from-oferta/${ofertaId}`, body).then((r) => r.data),
  cronograma: (params?: {
    evento_id?: number; professor_id?: number; data_inicio?: string;
    data_fim?: string; status?: string; skip?: number; limit?: number;
  }) => api.get("/planejamento/cronograma", { params }).then((r) => r.data),
  modulos: (eventoId: number) =>
    api.get(`/planejamento/modulos/${eventoId}`).then((r) => r.data),
  ucs: (eventoId: number, modulo?: string) =>
    api.get(`/planejamento/ucs/${eventoId}`, { params: modulo ? { modulo } : undefined }).then((r) => r.data),
  candidatos: (eventoId: number, ucId: number) =>
    api.get(`/planejamento/candidatos/${eventoId}/${ucId}`).then((r) => r.data),
  gerar: (eventoId: number, ucs: { uc_id: number; ordem: number; professor_preferido_id?: number; data_inicio?: string }[]) =>
    api.post(`/planejamento/gerar/${eventoId}`, { ucs }).then((r) => r.data),
  confirmar: (eventoId: number, alocacoes: unknown[], substituirFuturas = true) =>
    api.post(`/planejamento/confirmar/${eventoId}`, { alocacoes, substituir_futuras: substituirFuturas }).then((r) => r.data),
  regenciaProjetada: (params?: { evento_id?: number; data_inicio?: string; data_fim?: string }) =>
    api.get("/planejamento/regencia-projetada", { params }).then((r) => r.data),
  datasDisponiveis: (aulaId: number) =>
    api.get(`/planejamento/datas-disponiveis/${aulaId}`).then((r) => r.data),
  remanejo: (aulaId: number, body: { tipo: string; professor_id?: number; nova_data?: string }) =>
    api.post(`/planejamento/remanejo/${aulaId}`, body).then((r) => r.data),
  apagarPlanejamento: (eventoId: number, ucId?: number) =>
    api.delete(`/planejamento/apagar/${eventoId}`, { params: ucId != null ? { uc_id: ucId } : undefined }).then((r) => r.data),
  importarHistorico: (file: File) => {
    const form = new FormData();
    form.append("arquivo", file);
    return api.post("/planejamento/importar-historico", form, {
      transformRequest: (data, headers) => { if (headers) delete headers["Content-Type"]; return data; },
    }).then((r) => r.data);
  },
};

// Importação
export const importacaoApi = {
  importarExcel: (file: File) => {
    const form = new FormData();
    form.append("arquivo", file);
    // transformRequest remove o Content-Type da instância (application/json) para que
    // o browser adicione automaticamente multipart/form-data com o boundary correto
    return api
      .post("/importacao/excel", form, {
        transformRequest: (data, headers) => {
          if (headers) delete headers["Content-Type"];
          return data;
        },
      })
      .then((r) => r.data);
  },
  template: () => api.get("/importacao/template").then((r) => r.data),
};

// Relatórios
export const relatoriosApi = {
  cronogramaProfessor: (id: number, dataInicio: string, dataFim: string) =>
    api.get(`/relatorios/cronograma-professor/${id}`, {
      params: { data_inicio: dataInicio, data_fim: dataFim },
      responseType: "blob",
    }),
  regencia: () =>
    api.get("/relatorios/regencia", { responseType: "blob" }),
  cronogramaTurma: (id: number) =>
    api.get(`/relatorios/cronograma-turma/${id}`, { responseType: "blob" }),
  dadosMestres: () =>
    api.get("/relatorios/dados-mestres", { responseType: "blob" }),
  ofertas: () =>
    api.get("/relatorios/ofertas", { responseType: "blob" }),
  historico: (params?: {
    evento_id?: number;
    professor_id?: number;
    data_inicio?: string;
    data_fim?: string;
  }) =>
    api.get("/relatorios/historico", {
      params,
      responseType: "blob",
    }),
};

// Administração / Limpeza de BD
export const adminApi = {
  limpar: (tipo: "aulas" | "planejamento" | "ofertas" | "importacao" | "tudo") =>
    api.delete(`/admin/limpar/${tipo}`).then((r) => r.data),
};

// IA
export const iaApi = {
  status: () => api.get("/ia/status").then((r) => r.data),
  analisar: (pergunta?: string) =>
    api.post("/ia/analisar", { pergunta }).then((r) => r.data),
  alternativas: (aulaId: number) =>
    api.post(`/ia/alternativas/${aulaId}`).then((r) => r.data),
  relatorio: (tipo = "mensal") =>
    api.get("/ia/relatorio", { params: { tipo } }).then((r) => r.data),
};

// Versões
export const versoesApi = {
  historico: (eventoId: number, params?: { skip?: number; limit?: number }) =>
    api.get(`/versoes/evento/${eventoId}`, { params }).then((r) => r.data),
  recentes: (params?: { evento_id?: number; tipo?: string; skip?: number; limit?: number }) =>
    api.get("/versoes/recentes", { params }).then((r) => r.data),
  comparar: (eventoId: number, antes: number, depois: number) =>
    api.get(`/versoes/comparar/${eventoId}`, { params: { versao_antes_id: antes, versao_depois_id: depois } }).then((r) => r.data),
  historicoAula: (aulaId: number) =>
    api.get(`/versoes/aula/${aulaId}`).then((r) => r.data),
};

// Usuários
export const usuariosApi = {
  listar: () => api.get("/usuarios/").then((r) => r.data),
  criar: (data: { nome: string; email: string; senha: string; perfil: string }) =>
    api.post("/usuarios/", data).then((r) => r.data),
  atualizar: (id: number, data: Partial<{ nome: string; email: string; perfil: string; ativo: boolean }>) =>
    api.put(`/usuarios/${id}`, data).then((r) => r.data),
  resetSenha: (id: number, nova_senha: string) =>
    api.post(`/usuarios/${id}/reset-senha`, { nova_senha }).then((r) => r.data),
  alterarSenha: (senha_atual: string, nova_senha: string) =>
    api.post("/auth/alterar-senha", { senha_atual, nova_senha }).then((r) => r.data),
};

export function downloadBlob(data: Blob, filename: string) {
  const url = window.URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.URL.revokeObjectURL(url);
}
