// Constantes e helpers visuais do CRM de Leads (rótulos vêm de /crm/opcoes)

export const TEMPERATURA_STYLE: Record<string, { label: string; cls: string; dot: string }> = {
  quente: { label: "Quente", cls: "bg-red-50 text-red-700 border-red-200", dot: "bg-red-500" },
  morno:  { label: "Morno",  cls: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" },
  frio:   { label: "Frio",   cls: "bg-sky-50 text-sky-700 border-sky-200", dot: "bg-sky-500" },
};

export const STATUS_STYLE: Record<string, string> = {
  novo:               "bg-blue-50 text-blue-700 border-blue-200",
  tentativa_contato:  "bg-indigo-50 text-indigo-700 border-indigo-200",
  em_atendimento:     "bg-violet-50 text-violet-700 border-violet-200",
  aguardando_retorno: "bg-amber-50 text-amber-700 border-amber-200",
  aguardando_decisao: "bg-orange-50 text-orange-700 border-orange-200",
  matriculado:        "bg-green-50 text-green-700 border-green-200",
  perdido:            "bg-gray-100 text-gray-600 border-gray-300",
  sem_retorno:        "bg-gray-100 text-gray-500 border-gray-300",
};

export const ALERTA_INFO: Record<string, { label: string; cls: string }> = {
  novo_sem_atendimento: { label: "Novo sem atendimento", cls: "bg-red-100 text-red-700" },
  retorno_atrasado:     { label: "Retorno atrasado",     cls: "bg-red-100 text-red-700" },
  retorno_hoje:         { label: "Retorno hoje",         cls: "bg-amber-100 text-amber-800" },
  sem_vendedor:         { label: "Sem vendedor",         cls: "bg-gray-200 text-gray-700" },
};

export const CAMPO_LABEL: Record<string, string> = {
  criacao: "Lead criado",
  status: "Status",
  temperatura: "Temperatura",
  vendedor_id: "Vendedor",
  oferta_id: "Curso",
  campanha_id: "Campanha",
  observacoes: "Observações",
  ultimo_contato: "Último contato",
  proximo_retorno: "Próximo retorno",
  motivo_perda: "Motivo da perda",
  motivo_perda_comentario: "Comentário da perda",
  data_matricula: "Data da matrícula",
  nome: "Nome",
  telefone: "Telefone",
  email: "E-mail",
  nota: "Anotação",
};

/** '5562999990001' → '(62) 99999-0001' (mantém o original se não reconhecer). */
export function formatarTelefone(tel?: string | null) {
  if (!tel) return "—";
  const d = tel.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return tel;
}

/** Link do WhatsApp com DDI 55 quando o número vier sem ele. */
export function linkWhatsApp(tel?: string | null) {
  if (!tel) return null;
  const d = tel.replace(/\D/g, "");
  return `https://wa.me/${d.length <= 11 ? `55${d}` : d}`;
}

export function dataHora(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function data(iso?: string | null) {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

export function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export type CrmOpcoes = {
  status: { value: string; label: string; final: boolean }[];
  temperaturas: { value: string; label: string }[];
  motivos_perda: { value: string; label: string }[];
  vendedores: { id: number; nome: string }[];
  horas_alerta_novo: number;
};
