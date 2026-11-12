// API e helpers visuais da Gestão da Não Regência Docente
import { api } from "@/lib/api";

export type NrFiltros = {
  ini?: string;
  fim?: string;
  professor_id?: number | "";
  unidade?: string;
  categoria_id?: number | "";
  projeto_id?: number | "";
  responsavel_id?: number | "";
  situacao?: string;
};

function limpar(p: Record<string, any> = {}) {
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== "" && v !== null && v !== undefined));
}

async function baixar(url: string, params: Record<string, any>, nomePadrao: string) {
  const resp = await api.get(url, { params: limpar(params), responseType: "blob" });
  const cd: string = resp.headers["content-disposition"] || "";
  const nome = cd.match(/filename="?([^"]+)"?/)?.[1] || nomePadrao;
  const href = URL.createObjectURL(resp.data);
  const a = document.createElement("a");
  a.href = href;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(href);
}

export const nrApi = {
  opcoes: () => api.get("/nao-regencia/opcoes").then((r) => r.data),
  config: () => api.get("/nao-regencia/config").then((r) => r.data),
  salvarConfig: (dados: Record<string, string>) => api.put("/nao-regencia/config", dados).then((r) => r.data),
  criarCategoria: (nome: string) => api.post("/nao-regencia/categorias", { nome }).then((r) => r.data),
  editarCategoria: (id: number, dados: any) => api.put(`/nao-regencia/categorias/${id}`, dados).then((r) => r.data),

  dashboard: (f: NrFiltros) => api.get("/nao-regencia/dashboard", { params: limpar(f) }).then((r) => r.data),
  visaoProfessor: (id: number, ini?: string, fim?: string) =>
    api.get(`/nao-regencia/professores/${id}/visao`, { params: limpar({ ini, fim }) }).then((r) => r.data),

  projetos: (p: Record<string, any> = {}) => api.get("/nao-regencia/projetos", { params: limpar(p) }).then((r) => r.data),
  projeto: (id: number) => api.get(`/nao-regencia/projetos/${id}`).then((r) => r.data),
  criarProjeto: (dados: any) => api.post("/nao-regencia/projetos", dados).then((r) => r.data),
  editarProjeto: (id: number, dados: any) => api.put(`/nao-regencia/projetos/${id}`, dados).then((r) => r.data),
  excluirProjeto: (id: number) => api.delete(`/nao-regencia/projetos/${id}`),

  criarVinculos: (projetoId: number, vinculos: any[]) =>
    api.post(`/nao-regencia/projetos/${projetoId}/vinculos`, { vinculos }).then((r) => r.data),
  editarVinculo: (id: number, dados: any) => api.put(`/nao-regencia/vinculos/${id}`, dados).then((r) => r.data),
  aprovarVinculo: (id: number, justificativa?: string) =>
    api.post(`/nao-regencia/vinculos/${id}/aprovar`, { justificativa }).then((r) => r.data),
  encerrarVinculo: (id: number, justificativa: string, data_fim?: string) =>
    api.post(`/nao-regencia/vinculos/${id}/encerrar`, { justificativa, data_fim: data_fim || null }).then((r) => r.data),
  vinculos: (p: Record<string, any>) => api.get("/nao-regencia/vinculos", { params: limpar(p) }).then((r) => r.data),
  disponibilidade: (professorIds: number[], ini: string, fim: string, horasPor: Record<number, number>, excluirVinculoId?: number) =>
    api.get("/nao-regencia/disponibilidade", {
      params: limpar({
        professor_ids: professorIds.join(","), ini, fim, excluir_vinculo_id: excluirVinculoId,
        horas_por: Object.entries(horasPor).map(([k, v]) => `${k}:${v}`).join(","),
      }),
    }).then((r) => r.data),

  entregas: (p: Record<string, any> = {}) => api.get("/nao-regencia/entregas", { params: limpar(p) }).then((r) => r.data),
  criarEntrega: (projetoId: number, dados: any) => api.post(`/nao-regencia/projetos/${projetoId}/entregas`, dados).then((r) => r.data),
  editarEntrega: (id: number, dados: any) => api.put(`/nao-regencia/entregas/${id}`, dados).then((r) => r.data),
  excluirEntrega: (id: number) => api.delete(`/nao-regencia/entregas/${id}`),
  submeterEntrega: (id: number, dados: any) => api.post(`/nao-regencia/entregas/${id}/submeter`, dados).then((r) => r.data),
  avaliarEntrega: (id: number, aprovar: boolean, parecer?: string) =>
    api.post(`/nao-regencia/entregas/${id}/avaliar`, { aprovar, parecer }).then((r) => r.data),

  apontamentos: (p: Record<string, any> = {}) => api.get("/nao-regencia/apontamentos", { params: limpar(p) }).then((r) => r.data),
  criarApontamento: (dados: any) => api.post("/nao-regencia/apontamentos", dados).then((r) => r.data),
  editarApontamento: (id: number, dados: any) => api.put(`/nao-regencia/apontamentos/${id}`, dados).then((r) => r.data),
  excluirApontamento: (id: number) => api.delete(`/nao-regencia/apontamentos/${id}`),
  enviarApontamento: (id: number) => api.post(`/nao-regencia/apontamentos/${id}/enviar`).then((r) => r.data),
  validarApontamentos: (ids: number[], aprovar: boolean, parecer?: string) =>
    api.post("/nao-regencia/apontamentos/validar", { ids, aprovar, parecer }).then((r) => r.data),

  enviarAnexo: (projetoId: number, arquivo: File, extra: { entrega_id?: number; apontamento_id?: number } = {}) => {
    const fd = new FormData();
    fd.append("projeto_id", String(projetoId));
    if (extra.entrega_id) fd.append("entrega_id", String(extra.entrega_id));
    if (extra.apontamento_id) fd.append("apontamento_id", String(extra.apontamento_id));
    fd.append("arquivo", arquivo);
    return api.post("/nao-regencia/anexos", fd, { headers: { "Content-Type": "multipart/form-data" } }).then((r) => r.data);
  },
  baixarAnexo: (id: number, nome: string) => baixar(`/nao-regencia/anexos/${id}`, {}, nome),
  excluirAnexo: (id: number) => api.delete(`/nao-regencia/anexos/${id}`),

  afastamentos: (professorId?: number) =>
    api.get("/nao-regencia/afastamentos", { params: limpar({ professor_id: professorId }) }).then((r) => r.data),
  criarAfastamento: (dados: any) => api.post("/nao-regencia/afastamentos", dados).then((r) => r.data),
  excluirAfastamento: (id: number) => api.delete(`/nao-regencia/afastamentos/${id}`),
  outrasAlocacoes: (professorId?: number) =>
    api.get("/nao-regencia/outras-alocacoes", { params: limpar({ professor_id: professorId }) }).then((r) => r.data),
  criarOutraAlocacao: (dados: any) => api.post("/nao-regencia/outras-alocacoes", dados).then((r) => r.data),
  excluirOutraAlocacao: (id: number) => api.delete(`/nao-regencia/outras-alocacoes/${id}`),

  historico: (p: Record<string, any> = {}) => api.get("/nao-regencia/historico", { params: limpar(p) }).then((r) => r.data),
  exportar: (formato: "xlsx" | "pdf", tipo: string, f: NrFiltros) =>
    baixar("/nao-regencia/relatorios/exportar", { formato, tipo, ...f }, `nao_regencia_${tipo}.${formato}`),
};

export type NrOpcoes = {
  categorias: { id: number; nome: string; ativa: boolean }[];
  situacoes_projeto: { value: string; label: string }[];
  prioridades: { value: string; label: string }[];
  situacoes_vinculo: { value: string; label: string }[];
  situacoes_entrega: { value: string; label: string }[];
  situacoes_apontamento: { value: string; label: string }[];
  tipos_afastamento: string[];
  professores: { id: number; nome: string; foto?: string | null; tipo: string; horas_semanais: number; ativo: boolean }[];
  usuarios: { id: number; nome: string; perfil: string; gestao: boolean }[];
  unidades: string[];
  eu: { id: number; nome: string; perfil: string; gestao: boolean; admin: boolean; professor_id: number | null; coordena: number[] };
};

export const SITUACAO_PROJETO_STYLE: Record<string, string> = {
  rascunho: "bg-gray-100 text-gray-600 border-gray-300",
  planejado: "bg-sky-50 text-sky-700 border-sky-200",
  em_andamento: "bg-blue-50 text-blue-700 border-blue-200",
  suspenso: "bg-amber-50 text-amber-800 border-amber-200",
  concluido: "bg-green-50 text-green-700 border-green-200",
  cancelado: "bg-red-50 text-red-700 border-red-200",
};

export const SITUACAO_VINCULO_STYLE: Record<string, string> = {
  proposta: "bg-amber-50 text-amber-800 border-amber-200",
  aprovada: "bg-green-50 text-green-700 border-green-200",
  encerrada: "bg-gray-100 text-gray-600 border-gray-300",
  cancelada: "bg-red-50 text-red-700 border-red-200",
};

export const SITUACAO_ENTREGA_STYLE: Record<string, string> = {
  nao_iniciada: "bg-gray-100 text-gray-600 border-gray-300",
  em_andamento: "bg-blue-50 text-blue-700 border-blue-200",
  submetida: "bg-violet-50 text-violet-700 border-violet-200",
  aprovada: "bg-green-50 text-green-700 border-green-200",
  devolvida: "bg-amber-50 text-amber-800 border-amber-200",
};

export const SITUACAO_APONTAMENTO_STYLE: Record<string, string> = {
  rascunho: "bg-gray-100 text-gray-600 border-gray-300",
  enviado: "bg-violet-50 text-violet-700 border-violet-200",
  aprovado: "bg-green-50 text-green-700 border-green-200",
  devolvido: "bg-amber-50 text-amber-800 border-amber-200",
};

export const PRIORIDADE_STYLE: Record<string, string> = {
  baixa: "text-gray-500",
  media: "text-amber-700",
  alta: "text-red-700 font-semibold",
};

export const ALERTA_NIVEL_STYLE: Record<string, string> = {
  alto: "border-red-200 bg-red-50 text-red-800",
  medio: "border-amber-200 bg-amber-50 text-amber-900",
  baixo: "border-gray-200 bg-gray-50 text-gray-700",
};

/** 12.5 → "12,5h" */
export function horas(v?: number | null, casas = 1) {
  if (v == null || Number.isNaN(v)) return "—";
  return `${v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: casas })}h`;
}

export function dataBR(iso?: string | null) {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

export function isoLocal(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function mesAtual() {
  const h = new Date();
  return { ini: isoLocal(new Date(h.getFullYear(), h.getMonth(), 1)), fim: isoLocal(new Date(h.getFullYear(), h.getMonth() + 1, 0)) };
}

export function erroApi(e: any, padrao = "Erro ao salvar") {
  const d = e?.response?.data?.detail;
  return typeof d === "string" ? d : Array.isArray(d) ? d.map((x: any) => x.msg).join("; ") : padrao;
}

/** "1.500,5" ou "1500.5" → número; vazio → null */
export function lerNumero(t: string | number | null | undefined) {
  if (t === null || t === undefined) return null;
  const s = String(t).trim();
  if (!s) return null;
  return Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
}
