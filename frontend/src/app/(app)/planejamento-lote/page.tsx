"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle, CheckCircle2, FileText, Printer, Search, X, ChevronDown, ChevronRight, Layers, Loader2, Lock, RefreshCw, Save, Unlock, Users,
} from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";

// ── Tipos ──────────────────────────────────────────────────────────────────────

type EtapaPlanejada = { etapa: string; aulas: number; ultima_aula: string | null };
type EventoCurso = {
  id: number; nome_turma: string; disciplina: string | null; tipo_modalidade: string | null; status: string | null;
  data_inicio: string | null; data_fim: string | null; dias_semana: number[];
  horario_inicio: string | null; horario_fim: string | null;
  curso_id: number | null; curso_nome: string | null; curso_codigo: string | null; etapas: string[];
  etapas_planejadas: EtapaPlanejada[]; etapa_sugerida: string | null;
};
type Config = { modulo: string; data_inicio: string; modo_superior: boolean; clipar_semestre: boolean };
type Candidato = { professor_id: number; nome: string; tipo: string; disponivel: boolean; conflito?: boolean };
type Alocacao = {
  uc_id: number; uc_nome: string; uc_codigo: string; etapa: string | null; carga_horaria: number;
  professor_id: number | null; professor_nome: string | null; aulas_necessarias: number; datas_aulas: string[];
  justificativa: string; alerta: string | null; score: number; travado: boolean; candidatos: Candidato[];
  primeira_aula: string | null; ultima_aula: string | null;
};
type EventoProposta = { evento_id: number; nome_turma: string; modulo: string | null; motor?: "otimizado" | "padrao"; alocacoes: Alocacao[] };
type Proposta = {
  status: string;
  eventos: EventoProposta[];
  erros: { evento_id: number; erro: string }[];
  avisos?: { evento_id: number; aviso: string }[];
  sem_professor: { evento_id: number; nome_turma: string; uc_id: number; uc_nome: string; aulas: number; horas: number; motivo: string; habilitados: string[] }[];
  professores: { professor_id: number; nome: string; tipo: string; horas_contratadas: number; horas_lote: number; ucs: number; pico_semanal: number; regencia_atual: number }[];
  resumo: { eventos: number; ucs: number; cobertas: number; aulas: number; aulas_cobertas: number; horas_sem_professor: number };
};

const DIAS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const fmt = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");
const erroApi = (e: any) => e?.response?.data?.detail || e?.message || "Erro inesperado";

/** Mesmo agrupamento da tela de planejamento. */
function grupoModalidade(tipo: string | null): string {
  if (!tipo) return "outros";
  const t = tipo.toUpperCase();
  const codigo = parseInt(t.split(/[\s\-–]/)[0], 10);
  if (!isNaN(codigo)) {
    if ([3, 11, 21, 51, 53, 54].includes(codigo)) return "fic";
    if (codigo === 31) return "tecnico";
    if (codigo === 33) return "ead";
    if (codigo === 35) return "seduc";
    if ([41, 81].includes(codigo)) return "superior";
    if (codigo === 91) return "pos";
  }
  if (t.includes("PÓS") || t.includes("POS") || t.includes("ESPECIALIZA")) return "pos";
  if (t.includes("SUPERIOR") || t.includes("GRADUA") || t.includes("LICENCIATURA") || t.includes("BACHARELADO") || t.includes("TECNOLOG")) return "superior";
  if (t.includes("EAD") || t.includes("DISTÂNCIA") || t.includes("DISTANCIA") || t.includes("SEMIPRESENCIAL")) return "ead";
  if (t.includes("SEDUC") || t.includes("ENSINO MÉDIO") || t.includes("ENSINO MEDIO")) return "seduc";
  if (t.includes("TÉCNICO") || t.includes("TECNICO") || t.includes("SUBSEQUENTE") || t.includes("CONCOMITANTE") || t.includes("INTEGRADO")) return "tecnico";
  if (t.includes("QUALIFICA") || t.includes("FIC") || t.includes("APERFEI") || t.includes("FORMAÇ") || t.includes("FORMAC")) return "fic";
  return "outros";
}
// Fluxos especiais (sábados FIC/EaD, pós, Seduc) continuam na tela individual
const GRUPOS_INDIVIDUAIS = new Set(["fic", "ead", "pos", "seduc"]);

// ── Página ─────────────────────────────────────────────────────────────────────

export default function PlanejamentoLotePage() {
  const [busca, setBusca] = useState("");
  const [soPendentes, setSoPendentes] = useState(false);
  const [config, setConfig] = useState<Record<number, Config>>({}); // eventos selecionados
  const [travas, setTravas] = useState<Record<string, number>>({}); // "evento:uc" → professor
  const [proposta, setProposta] = useState<Proposta | null>(null);
  const [desatualizada, setDesatualizada] = useState(false);
  const [abertos, setAbertos] = useState<Set<number>>(new Set());
  const [gravados, setGravados] = useState<Record<number, "ok" | string>>({});
  const [relatorio, setRelatorio] = useState(false);

  const { data: dados, isLoading: carregandoEventos } = useQuery({
    queryKey: ["lote-eventos-todos"],
    queryFn: () => api.get("/planejamento-lote/eventos", { timeout: 120_000 }).then((r) => r.data as { eventos: EventoCurso[] }),
    staleTime: 60_000,
  });
  const todosEventos = dados?.eventos ?? [];

  const resultados = useMemo(() => {
    const termos = busca.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return todosEventos.filter((ev) => {
      if (config[ev.id]) return false;
      if (soPendentes && ev.etapas.length > 0 && ev.etapas.every((et) => ev.etapas_planejadas.some((p) => p.etapa === et))) return false;
      if (!termos.length) return true;
      const texto = `${ev.id} ${ev.nome_turma} ${ev.disciplina ?? ""} ${ev.curso_nome ?? ""} ${ev.curso_codigo ?? ""} ${ev.tipo_modalidade ?? ""}`.toLowerCase();
      return termos.every((t) => texto.includes(t));
    });
  }, [todosEventos, busca, soPendentes, config]);
  const RESULTADOS_MAX = 80;

  function bloqueio(ev: EventoCurso): string | null {
    if (GRUPOS_INDIVIDUAIS.has(grupoModalidade(ev.tipo_modalidade))) return "Planeje pela tela individual (fluxo próprio da modalidade).";
    if (!ev.curso_id) return "Evento sem curso cadastrado.";
    return null;
  }

  function limparProposta() {
    setProposta(null);
    setTravas({});
    setGravados({});
  }

  function selecionar(evs: EventoCurso[]) {
    const livres = evs.filter((ev) => !bloqueio(ev));
    if (!livres.length) return;
    setConfig((prev) => {
      const next = { ...prev };
      for (const ev of livres) {
        const superior = grupoModalidade(ev.tipo_modalidade) === "superior";
        next[ev.id] = { modulo: ev.etapa_sugerida ?? "", data_inicio: "", modo_superior: superior, clipar_semestre: superior };
      }
      return next;
    });
    limparProposta();
  }

  function remover(id: number) {
    setConfig((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    limparProposta();
  }

  const selecionados = todosEventos.filter((e) => config[e.id]);
  const nCursos = new Set(selecionados.map((e) => e.curso_id)).size;

  const gerar = useMutation({
    mutationFn: (travasAtuais: Record<string, number>) =>
      api.post("/planejamento-lote/preview", {
        eventos: selecionados.map((e) => ({
          evento_id: e.id,
          modulo: config[e.id].modulo || null,
          data_inicio: config[e.id].data_inicio || null,
          modo_superior: config[e.id].modo_superior,
          clipar_semestre: config[e.id].modo_superior && config[e.id].clipar_semestre,
        })),
        travas: Object.entries(travasAtuais).map(([k, professor_id]) => {
          const [evento_id, uc_id] = k.split(":").map(Number);
          return { evento_id, uc_id, professor_id };
        }),
      }, { timeout: 600_000 }).then((r) => r.data as Proposta),
    onSuccess: (p) => {
      setProposta(p);
      setDesatualizada(false);
      setGravados({});
      if (p.erros.length) toast.warning(`${p.erros.length} evento(s) não puderam ser planejados — veja os avisos.`);
    },
    onError: (e) => toast.error(erroApi(e)),
  });

  const gravar = useMutation({
    mutationFn: async () => {
      const res: Record<number, "ok" | string> = {};
      for (const ev of proposta!.eventos) {
        if (gravados[ev.evento_id] === "ok") { res[ev.evento_id] = "ok"; continue; }
        try {
          await api.post(`/planejamento/confirmar/${ev.evento_id}`, {
            alocacoes: ev.alocacoes.map(({ candidatos, travado, primeira_aula, ultima_aula, ...a }) => a),
            substituir_futuras: true,
          });
          res[ev.evento_id] = "ok";
        } catch (e) {
          res[ev.evento_id] = erroApi(e);
        }
        setGravados({ ...res });
      }
      return res;
    },
    onSuccess: (res) => {
      const ok = Object.values(res).filter((v) => v === "ok").length;
      const falhas = Object.keys(res).length - ok;
      if (falhas) toast.error(`${ok} evento(s) gravado(s), ${falhas} com erro.`);
      else toast.success(`Planejamento gravado em ${ok} evento(s).`);
    },
  });

  function setCfg(id: number, patch: Partial<Config>) {
    setConfig((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function trocarProfessor(eventoId: number, ucId: number, profId: number | null) {
    setTravas((prev) => {
      const next = { ...prev };
      if (profId) next[`${eventoId}:${ucId}`] = profId; else delete next[`${eventoId}:${ucId}`];
      return next;
    });
    setDesatualizada(true);
  }

  function alternar(id: number) {
    setAbertos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const nTravas = Object.keys(travas).length;
  const todosGravados = !!proposta && proposta.eventos.length > 0 && proposta.eventos.every((e) => gravados[e.evento_id] === "ok");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Planejamento em lote"
        description="Escolha os eventos e planeje todos de uma vez: os professores são escolhidos em conjunto, para não faltar docente nas últimas turmas."
      >
        <Link href="/eventos" className="btn-secondary text-sm">Planejar um evento</Link>
      </PageHeader>

      {/* 1. Buscar eventos */}
      <div className="card overflow-hidden">
        <div className="space-y-3 border-b p-4">
          <h2 className="text-sm font-semibold text-gray-800">1. Escolha os eventos</h2>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-full max-w-lg">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
              <input className="input pl-8" placeholder="Buscar por turma, curso, código ou nº do evento…" value={busca}
                     onChange={(e) => setBusca(e.target.value)} />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-gray-600">
              <input type="checkbox" checked={soPendentes} onChange={(e) => setSoPendentes(e.target.checked)} />
              só eventos com etapa a planejar
            </label>
            {resultados.length > 0 && busca.trim() && (
              <button className="ml-auto text-xs text-primary hover:underline" onClick={() => selecionar(resultados.slice(0, RESULTADOS_MAX))}>
                Adicionar {Math.min(resultados.length, RESULTADOS_MAX)} resultado(s)
              </button>
            )}
          </div>
        </div>
        {carregandoEventos ? (
          <div className="flex items-center gap-2 p-6 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Carregando eventos…</div>
        ) : !busca.trim() ? (
          <p className="px-4 py-3 text-xs text-gray-500">Digite para buscar entre {todosEventos.length} eventos ativos. Você pode misturar turmas de cursos diferentes.</p>
        ) : !resultados.length ? (
          <p className="px-4 py-3 text-xs text-gray-500">Nenhum evento encontrado.</p>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y">
                {resultados.slice(0, RESULTADOS_MAX).map((ev) => {
                  const motivo = bloqueio(ev);
                  return (
                    <tr key={ev.id} className={cn(motivo ? "opacity-60" : "cursor-pointer hover:bg-blue-50/40")}
                        onClick={() => !motivo && selecionar([ev])}>
                      <td className="px-4 py-2">
                        <div className="font-medium text-gray-800">{ev.nome_turma}</div>
                        <div className="text-[11px] text-gray-400">
                          #{ev.id} · {ev.curso_codigo ? `${ev.curso_codigo} — ${ev.curso_nome}` : "sem curso"} · {fmt(ev.data_inicio)} → {fmt(ev.data_fim)}
                        </div>
                        {motivo && <div className="text-[11px] text-amber-700">{motivo}</div>}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-600 whitespace-nowrap">
                        {ev.dias_semana.map((d) => DIAS[d]).join(", ")}<br />{ev.horario_inicio}–{ev.horario_fim}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-500">
                        {ev.etapas_planejadas.length ? `${ev.etapas_planejadas.length}/${ev.etapas.length} etapa(s) planejada(s)` : "nada planejado"}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {!motivo && <span className="text-xs text-primary">+ adicionar</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {resultados.length > RESULTADOS_MAX && (
              <p className="px-4 py-2 text-[11px] text-gray-400">Mostrando {RESULTADOS_MAX} de {resultados.length}. Refine a busca.</p>
            )}
          </div>
        )}
      </div>

      {/* 2. Eventos selecionados */}
      {selecionados.length > 0 && (
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
            <h2 className="mr-auto text-sm font-semibold text-gray-800">
              2. Eventos no lote e etapa a planejar
              <span className="ml-2 font-normal text-gray-400">{selecionados.length} evento(s) · {nCursos} curso(s)</span>
            </h2>
            <button className="text-xs text-red-600 hover:underline" onClick={() => { setConfig({}); limparProposta(); }}>
              Remover todos
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2">Turma</th>
                  <th className="px-3 py-2">Horário</th>
                  <th className="px-3 py-2">Já planejado</th>
                  <th className="px-3 py-2">Etapa a planejar</th>
                  <th className="px-3 py-2">Início da etapa</th>
                  <th className="px-3 py-2">Ensino Superior</th>
                  <th className="px-3 py-2 w-8" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {selecionados.map((ev) => {
                  const c = config[ev.id];
                  return (
                    <tr key={ev.id}>
                      <td className="px-3 py-2 align-top">
                        <div className="font-medium text-gray-800">{ev.nome_turma}</div>
                        <div className="text-[11px] text-gray-400">#{ev.id} · {ev.curso_codigo} — {ev.curso_nome}</div>
                        <div className="text-[11px] text-gray-400">{fmt(ev.data_inicio)} → {fmt(ev.data_fim)}</div>
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-gray-600 whitespace-nowrap">
                        {ev.dias_semana.map((d) => DIAS[d]).join(", ")}<br />{ev.horario_inicio}–{ev.horario_fim}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="flex flex-wrap gap-1">
                          {ev.etapas_planejadas.length === 0 ? <span className="text-xs text-gray-400">nada ainda</span> :
                            ev.etapas_planejadas.map((p) => (
                              <span key={p.etapa} title={`${p.aulas} aula(s), última em ${fmt(p.ultima_aula)}`}
                                    className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">
                                {p.etapa} · até {fmt(p.ultima_aula)}
                              </span>
                            ))}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <select className="input h-8 py-0 text-xs" value={c.modulo}
                                onChange={(e) => setCfg(ev.id, { modulo: e.target.value })}>
                          {ev.etapas.length === 0 && <option value="">Todas as UCs</option>}
                          {ev.etapas.map((et) => <option key={et} value={et}>{et}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <input type="date" className="input h-8 py-0 text-xs" value={c.data_inicio}
                               onChange={(e) => setCfg(ev.id, { data_inicio: e.target.value })} />
                        {!c.data_inicio && <div className="text-[10px] text-gray-400">vazio = início do evento</div>}
                      </td>
                      <td className="px-3 py-2 align-top text-xs">
                        <label className="flex items-center gap-1">
                          <input type="checkbox" checked={c.modo_superior}
                                 onChange={(e) => setCfg(ev.id, { modo_superior: e.target.checked, clipar_semestre: e.target.checked })} />
                          dia fixo por UC
                        </label>
                        {c.modo_superior && (
                          <label className="mt-1 flex items-center gap-1 text-gray-500">
                            <input type="checkbox" checked={c.clipar_semestre}
                                   onChange={(e) => setCfg(ev.id, { clipar_semestre: e.target.checked })} />
                            limitar ao semestre
                          </label>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <button title="Remover do lote" onClick={() => remover(ev.id)} className="text-gray-400 hover:text-red-600">
                          <X className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t px-4 py-3">
            <span className="text-xs text-gray-500">{selecionados.length} evento(s) selecionado(s)</span>
            <button className="btn-primary ml-auto inline-flex items-center gap-2 text-sm"
                    disabled={!selecionados.length || gerar.isPending}
                    onClick={() => { setTravas({}); gerar.mutate({}); }}>
              {gerar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Layers className="h-4 w-4" />}
              Gerar proposta do lote
            </button>
          </div>
          {gerar.isPending && (
            <p className="px-4 pb-3 text-xs text-gray-500">Organizando as datas de cada turma com o OR-Tools e escolhendo os professores de todas as turmas juntas… pode levar alguns minutos.</p>
          )}
        </div>
      )}

      {/* 3. Proposta */}
      {proposta && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile titulo="UCs com professor" valor={`${proposta.resumo.cobertas} de ${proposta.resumo.ucs}`}
                  ok={proposta.resumo.cobertas === proposta.resumo.ucs} />
            <Tile titulo="Aulas com professor" valor={`${proposta.resumo.aulas_cobertas} de ${proposta.resumo.aulas}`}
                  ok={proposta.resumo.aulas_cobertas === proposta.resumo.aulas} />
            <Tile titulo="Horas sem professor" valor={`${proposta.resumo.horas_sem_professor}h`}
                  ok={proposta.resumo.horas_sem_professor === 0} />
            <Tile titulo="Professores no lote" valor={String(proposta.professores.length)} ok />
          </div>

          {proposta.erros.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <p className="mb-1 font-semibold">Eventos fora da proposta</p>
              {proposta.erros.map((e) => (
                <p key={e.evento_id}>#{e.evento_id}: {e.erro}</p>
              ))}
            </div>
          )}
          {(proposta.avisos?.length ?? 0) > 0 && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
              <p className="mb-1 font-semibold">Avisos</p>
              {proposta.avisos!.map((a) => (
                <p key={a.evento_id}>#{a.evento_id}: {a.aviso}</p>
              ))}
            </div>
          )}

          {desatualizada && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
              <Lock className="h-4 w-4" />
              Você escolheu {nTravas} professor(es) manualmente. Recalcule para reorganizar as demais UCs respeitando essas escolhas.
              <button className="btn-primary ml-auto inline-flex items-center gap-1 text-xs" disabled={gerar.isPending}
                      onClick={() => gerar.mutate(travas)}>
                {gerar.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Recalcular
              </button>
            </div>
          )}

          {proposta.sem_professor.length > 0 && (
            <div className="card overflow-hidden">
              <div className="flex items-center gap-2 border-b px-4 py-3">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <h3 className="text-sm font-semibold text-gray-800">UCs sem professor ({proposta.sem_professor.length})</h3>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs text-gray-500">
                  <tr><th className="px-4 py-2">Turma</th><th className="px-4 py-2">UC</th><th className="px-4 py-2 text-right">Horas</th><th className="px-4 py-2">Motivo</th></tr>
                </thead>
                <tbody className="divide-y">
                  {proposta.sem_professor.map((s) => (
                    <tr key={`${s.evento_id}:${s.uc_id}`}>
                      <td className="px-4 py-2 text-xs">{s.nome_turma}</td>
                      <td className="px-4 py-2 font-medium text-gray-800">{s.uc_nome}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{s.horas}h</td>
                      <td className="px-4 py-2 text-xs text-gray-600">
                        {s.motivo}
                        {s.habilitados.length > 0 && <div className="text-gray-400">Habilitados: {s.habilitados.join(", ")}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="card overflow-hidden">
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <Users className="h-4 w-4 text-gray-400" />
              <h3 className="text-sm font-semibold text-gray-800">Carga dos professores no lote</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs text-gray-500">
                  <tr>
                    <th className="px-4 py-2">Professor</th><th className="px-4 py-2">Tipo</th>
                    <th className="px-4 py-2 text-right">UCs</th><th className="px-4 py-2 text-right">Horas no lote</th>
                    <th className="px-4 py-2 text-right">Semana mais cheia</th><th className="px-4 py-2 text-right">Regência atual</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {proposta.professores.map((p) => {
                    const pct = p.horas_contratadas ? (p.pico_semanal / p.horas_contratadas) * 100 : 0;
                    return (
                      <tr key={p.professor_id}>
                        <td className="px-4 py-2 font-medium text-gray-800">{p.nome}</td>
                        <td className="px-4 py-2 text-xs text-gray-500">{p.tipo}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{p.ucs}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{p.horas_lote}h</td>
                        <td className={cn("px-4 py-2 text-right tabular-nums", pct >= 95 ? "text-amber-700 font-medium" : "text-gray-700")}>
                          {p.pico_semanal}h / {p.horas_contratadas}h
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{p.regencia_atual.toFixed(1)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="border-b px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-800">Proposta por turma</h3>
              <p className="mt-0.5 text-xs text-gray-500">Troque o professor de uma UC para travá-lo e clique em Recalcular para reorganizar o resto.</p>
            </div>
            <div className="divide-y">
              {proposta.eventos.map((ev) => {
                const aberto = abertos.has(ev.evento_id);
                const sem = ev.alocacoes.filter((a) => !a.professor_id && a.datas_aulas.length).length;
                const g = gravados[ev.evento_id];
                return (
                  <div key={ev.evento_id}>
                    <button className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-gray-50" onClick={() => alternar(ev.evento_id)}>
                      {aberto ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                      <span className="font-medium text-gray-800">{ev.nome_turma}</span>
                      <span className="text-xs text-gray-400">{ev.modulo ?? "todas as etapas"} · {ev.alocacoes.length} UC(s){ev.motor === "padrao" ? " · datas: padrão" : " · datas: OR-Tools"}</span>
                      {sem > 0 ? <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700">{sem} sem professor</span>
                               : <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">completo</span>}
                      {g === "ok" && <span className="ml-auto inline-flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> gravado</span>}
                      {g && g !== "ok" && <span className="ml-auto text-xs text-red-600">erro: {g}</span>}
                    </button>
                    {aberto && (
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-left text-xs text-gray-500">
                          <tr><th className="px-4 py-2">UC</th><th className="px-4 py-2">Período</th><th className="px-4 py-2 text-right">Aulas</th><th className="px-4 py-2">Professor</th></tr>
                        </thead>
                        <tbody className="divide-y">
                          {ev.alocacoes.map((a) => {
                            const chave = `${ev.evento_id}:${a.uc_id}`;
                            const valor = travas[chave] ?? a.professor_id ?? "";
                            return (
                              <tr key={a.uc_id} className={cn(!a.professor_id && a.datas_aulas.length > 0 && "bg-amber-50/40")}>
                                <td className="px-4 py-2">
                                  <div className="font-medium text-gray-800">{a.uc_nome}</div>
                                  {a.alerta && <div className="text-[11px] text-amber-700">{a.alerta}</div>}
                                </td>
                                <td className="px-4 py-2 text-xs text-gray-600 whitespace-nowrap">{fmt(a.primeira_aula)} → {fmt(a.ultima_aula)}</td>
                                <td className="px-4 py-2 text-right tabular-nums">{a.datas_aulas.length}</td>
                                <td className="px-4 py-2">
                                  <div className="flex items-center gap-1">
                                    <select className="input h-8 py-0 text-xs" value={valor}
                                            onChange={(e) => trocarProfessor(ev.evento_id, a.uc_id, e.target.value ? Number(e.target.value) : null)}>
                                      <option value="">— sem professor —</option>
                                      {[...a.candidatos].sort((p, q) => Number(!!p.conflito) - Number(!!q.conflito)).map((c) => (
                                        <option key={c.professor_id} value={c.professor_id}>
                                          {c.nome} ({c.tipo}){c.conflito ? " · já tem aula neste horário" : c.disponivel ? "" : " · sem disponibilidade"}
                                        </option>
                                      ))}
                                    </select>
                                    {travas[chave] ? (
                                      <button title="Destravar" onClick={() => trocarProfessor(ev.evento_id, a.uc_id, null)}
                                              className="text-blue-600 hover:text-blue-800"><Lock className="h-3.5 w-3.5" /></button>
                                    ) : a.travado ? <Lock className="h-3.5 w-3.5 text-blue-400" /> : <Unlock className="h-3.5 w-3.5 text-gray-200" />}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card flex flex-wrap items-center gap-3 p-4">
            <p className="text-xs text-gray-600">
              Ao gravar, cada turma recebe as aulas da proposta. As aulas futuras dessas UCs que não foram alteradas à mão
              são substituídas, como no planejamento por evento (dá para reverter turma a turma pela tela de Planejamento).
            </p>
            <button className="btn-secondary ml-auto inline-flex items-center gap-2 text-sm"
                    disabled={!proposta.eventos.length} onClick={() => setRelatorio(true)}>
              <FileText className="h-4 w-4" /> Relatório
            </button>
            <button className="btn-primary inline-flex items-center gap-2 text-sm"
                    disabled={gravar.isPending || desatualizada || todosGravados || !proposta.eventos.length}
                    title={desatualizada ? "Recalcule antes de gravar" : undefined}
                    onClick={() => {
                      if (confirm(`Gravar o planejamento de ${proposta.eventos.length} turma(s)?`)) gravar.mutate();
                    }}>
              {gravar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {todosGravados ? "Gravado" : "Gravar planejamento"}
            </button>
          </div>
        </div>
      )}

      {relatorio && proposta && (
        <RelatorioLote proposta={proposta} eventos={todosEventos} configs={config}
                       desatualizada={desatualizada} onClose={() => setRelatorio(false)} />
      )}
    </div>
  );
}

// ── Relatório da proposta (antes de gravar) ────────────────────────────────────

const CSS_IMPRESSAO = `
  body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:24px;font-size:12px}
  h1{font-size:18px;margin:0 0 4px} h2{font-size:14px;margin:20px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px}
  h3{font-size:12px;margin:14px 0 4px} table{width:100%;border-collapse:collapse;margin-bottom:8px}
  th,td{border:1px solid #ddd;padding:4px 6px;text-align:left;vertical-align:top} th{background:#f3f4f6}
  .num{text-align:right} .muted{color:#666} .alerta{color:#b45309} .sem{background:#fffbeb}
  .tiles{display:flex;gap:16px;margin:10px 0} .tile{border:1px solid #ddd;padding:6px 10px;border-radius:4px}
`;

function RelatorioLote({ proposta, eventos, configs, desatualizada, onClose }: {
  proposta: Proposta; eventos: EventoCurso[]; configs: Record<number, Config>; desatualizada: boolean; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const evMap = new Map(eventos.map((e) => [e.id, e]));
  const r = proposta.resumo;
  const geradoEm = new Date().toLocaleString("pt-BR");

  // Professor → UCs que recebeu no lote
  const porProfessor = new Map<number, { turma: string; uc: string; periodo: string; aulas: number }[]>();
  for (const ev of proposta.eventos) {
    for (const a of ev.alocacoes) {
      if (!a.professor_id) continue;
      const lista = porProfessor.get(a.professor_id) ?? [];
      lista.push({ turma: ev.nome_turma, uc: a.uc_nome, periodo: `${fmt(a.primeira_aula)} a ${fmt(a.ultima_aula)}`, aulas: a.datas_aulas.length });
      porProfessor.set(a.professor_id, lista);
    }
  }

  function imprimir() {
    const w = window.open("", "_blank", "width=1000,height=800");
    if (!w || !ref.current) return;
    w.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>Relatório - Planejamento em lote</title>` +
      `<style>${CSS_IMPRESSAO}</style></head><body>${ref.current.innerHTML}</body></html>`,
    );
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-5xl rounded-lg bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b px-5 py-3">
          <FileText className="h-4 w-4 text-gray-500" />
          <h2 className="mr-auto text-sm font-semibold text-gray-800">Relatório da proposta (ainda não gravada)</h2>
          <button className="btn-secondary inline-flex items-center gap-1 text-xs" onClick={imprimir}>
            <Printer className="h-3.5 w-3.5" /> Imprimir / PDF
          </button>
          <button className="text-gray-400 hover:text-gray-700" onClick={onClose} title="Fechar"><X className="h-5 w-5" /></button>
        </div>
        {desatualizada && (
          <p className="mx-5 mt-3 rounded border border-blue-200 bg-blue-50 p-2 text-xs text-blue-900">
            Há trocas manuais de professor ainda não recalculadas. O relatório mostra a última proposta calculada.
          </p>
        )}
        <div ref={ref} className="space-y-4 p-5 text-sm [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:bg-gray-50 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_table]:w-full">
          <div>
            <h1 className="text-lg font-bold">Planejamento em lote - proposta</h1>
            <p className="muted text-xs text-gray-500">Gerado em {geradoEm} · {r.eventos} turma(s) · situação: ainda não gravado</p>
          </div>
          <div className="tiles flex flex-wrap gap-3 text-xs">
            <div className="tile rounded border px-3 py-2">UCs com professor: <b>{r.cobertas} de {r.ucs}</b></div>
            <div className="tile rounded border px-3 py-2">Aulas com professor: <b>{r.aulas_cobertas} de {r.aulas}</b></div>
            <div className="tile rounded border px-3 py-2">Horas sem professor: <b>{r.horas_sem_professor}h</b></div>
            <div className="tile rounded border px-3 py-2">Professores envolvidos: <b>{proposta.professores.length}</b></div>
          </div>

          <h2 className="border-b pb-1 text-base font-semibold">Por turma</h2>
          {proposta.eventos.map((ev) => {
            const info = evMap.get(ev.evento_id);
            const cfg = configs[ev.evento_id];
            return (
              <div key={ev.evento_id} style={{ breakBefore: "page" }}>
                <h3 className="font-semibold">{ev.nome_turma}</h3>
                <p className="muted mb-1 text-xs text-gray-500">
                  #{ev.evento_id}{info?.curso_nome ? ` · ${info.curso_codigo} - ${info.curso_nome}` : ""} · etapa {ev.modulo ?? "todas"}
                  {info ? ` · ${info.dias_semana.map((d) => DIAS[d]).join(", ")} ${info.horario_inicio}-${info.horario_fim}` : ""}
                  {cfg?.data_inicio ? ` · início da etapa ${fmt(cfg.data_inicio)}` : ""}
                </p>
                <table className="text-xs">
                  <thead><tr><th>UC</th><th className="num">CH</th><th>Professor</th><th>Período</th><th className="num">Aulas</th><th>Observação</th></tr></thead>
                  <tbody>
                    {ev.alocacoes.map((a) => (
                      <tr key={a.uc_id} className={cn(!a.professor_id && "sem bg-amber-50")}>
                        <td>{a.uc_nome}</td>
                        <td className="num text-right">{a.carga_horaria}h</td>
                        <td>{a.professor_nome ?? <span className="alerta text-amber-700">sem professor</span>}</td>
                        <td className="whitespace-nowrap">{fmt(a.primeira_aula)} a {fmt(a.ultima_aula)}</td>
                        <td className="num text-right">{a.datas_aulas.length}</td>
                        <td className="alerta text-amber-700">{a.alerta?.replace("⚠ Sem professor: ", "") ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <CalendarioTurma alocacoes={ev.alocacoes} />
              </div>
            );
          })}

          <h2 className="border-b pb-1 text-base font-semibold">Por professor</h2>
          <table className="text-xs">
            <thead><tr><th>Professor</th><th>Tipo</th><th>Turmas / UCs</th><th className="num">Horas no lote</th><th className="num">Semana mais cheia</th><th className="num">Regência atual</th></tr></thead>
            <tbody>
              {proposta.professores.map((p) => (
                <tr key={p.professor_id}>
                  <td className="font-medium">{p.nome}</td>
                  <td>{p.tipo}</td>
                  <td>
                    {(porProfessor.get(p.professor_id) ?? []).map((u, i) => (
                      <div key={i}>{u.turma} - {u.uc} <span className="muted text-gray-500">({u.periodo}, {u.aulas} aulas)</span></div>
                    ))}
                  </td>
                  <td className="num text-right">{p.horas_lote}h</td>
                  <td className="num text-right">{p.pico_semanal}h / {p.horas_contratadas}h</td>
                  <td className="num text-right">{p.regencia_atual.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>

          {proposta.sem_professor.length > 0 && (
            <>
              <h2 className="border-b pb-1 text-base font-semibold">UCs sem professor ({proposta.sem_professor.length})</h2>
              <table className="text-xs">
                <thead><tr><th>Turma</th><th>UC</th><th className="num">Horas</th><th>Motivo</th><th>Habilitados</th></tr></thead>
                <tbody>
                  {proposta.sem_professor.map((s) => (
                    <tr key={`${s.evento_id}:${s.uc_id}`}>
                      <td>{s.nome_turma}</td><td>{s.uc_nome}</td><td className="num text-right">{s.horas}h</td>
                      <td>{s.motivo}</td><td className="muted text-gray-500">{s.habilitados.join(", ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Calendário da turma (mesmo visual da impressão do Cronograma) ──────────────
// Estilos inline para que a impressão (que copia o HTML) mantenha o layout.

const MESES_PT = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const DIAS_CURTOS = ["D", "S", "T", "Q", "Q", "S", "S"];
const CORES_FUNDO = ["#dbeafe", "#dcfce7", "#fef9c3", "#fce7f3", "#ede9fe", "#ffedd5", "#cffafe", "#d1fae5",
  "#fef3c7", "#e0e7ff", "#fee2e2", "#f0fdf4", "#f0f9ff", "#fdf4ff", "#fff7ed", "#ecfdf5"];
const CORES_TEXTO = ["#1e40af", "#15803d", "#92400e", "#9d174d", "#6d28d9", "#c2410c", "#0e7490", "#065f46",
  "#b45309", "#3730a3", "#b91c1c", "#166534", "#0369a1", "#7e22ce", "#c2410c", "#047857"];

function CalendarioTurma({ alocacoes }: { alocacoes: Alocacao[] }) {
  const porData = new Map<string, { a: Alocacao; idx: number }[]>();
  alocacoes.forEach((a, idx) => {
    for (const d of a.datas_aulas) {
      const lista = porData.get(d) ?? [];
      lista.push({ a, idx: idx % CORES_FUNDO.length });
      porData.set(d, lista);
    }
  });
  const datas = Array.from(porData.keys()).sort();
  if (!datas.length) return null;

  const meses: { ano: number; mes: number }[] = [];
  let [y, m] = datas[0].split("-").map(Number);
  const [fy, fm] = datas[datas.length - 1].split("-").map(Number);
  while (y < fy || (y === fy && m <= fm)) {
    meses.push({ ano: y, mes: m });
    m++; if (m > 12) { m = 1; y++; }
  }

  const grade: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 };
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", margin: "6px 0 12px" }}>
        {alocacoes.filter((a) => a.datas_aulas.length).map((a) => {
          const idx = alocacoes.indexOf(a) % CORES_FUNDO.length;
          return (
            <span key={a.uc_id} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10 }}>
              <span style={{ width: 12, height: 12, borderRadius: 2, background: CORES_FUNDO[idx], border: `1px solid ${CORES_TEXTO[idx]}40` }} />
              <span style={{ color: CORES_TEXTO[idx], fontWeight: 600 }}>
                {a.uc_nome} — {a.professor_nome ?? "sem professor"}
              </span>
            </span>
          );
        })}
      </div>
      {meses.map(({ ano, mes }) => {
        const primeiro = new Date(ano, mes - 1, 1).getDay();
        const nDias = new Date(ano, mes, 0).getDate();
        return (
          <div key={`${ano}-${mes}`} style={{ marginBottom: 16, breakInside: "avoid" }}>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "#1d4ed8",
                          borderBottom: "2px solid #1d4ed8", paddingBottom: 3, marginBottom: 6 }}>
              {MESES_PT[mes - 1]} {ano}
            </div>
            <div style={grade}>
              {DIAS_CURTOS.map((d, i) => (
                <div key={`h${i}`} style={{ textAlign: "center", fontSize: 9, fontWeight: 700, color: "#6b7280", padding: "3px 0" }}>{d}</div>
              ))}
              {Array.from({ length: primeiro }, (_, i) => (
                <div key={`v${i}`} style={{ minHeight: 56, background: "#f9fafb", borderRadius: 3 }} />
              ))}
              {Array.from({ length: nDias }, (_, i) => {
                const dia = i + 1;
                const dow = (primeiro + i) % 7;
                const chave = `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
                const aulas = porData.get(chave) ?? [];
                return (
                  <div key={chave} style={{ minHeight: 56, border: "1px solid #e5e7eb", borderRadius: 3, padding: 3,
                                            background: dow === 0 || dow === 6 ? "#f9fafb" : "#fff" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#374151", marginBottom: 2 }}>{dia}</div>
                    {aulas.map(({ a, idx }) => (
                      <div key={a.uc_id} style={{ background: CORES_FUNDO[idx], color: CORES_TEXTO[idx], borderRadius: 2,
                                                  padding: "2px 4px", marginBottom: 2, fontSize: 9, lineHeight: 1.35 }}>
                        <div style={{ fontWeight: 700, wordBreak: "break-word" }}>{a.uc_nome}</div>
                        <div style={{ color: a.professor_nome ? "#374151" : "#b45309", wordBreak: "break-word" }}>
                          {a.professor_nome ?? "sem professor"}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Tile({ titulo, valor, ok }: { titulo: string; valor: string; ok: boolean }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-gray-500">{titulo}</p>
      <p className={cn("mt-1 text-2xl font-bold tabular-nums", ok ? "text-gray-900" : "text-amber-600")}>{valor}</p>
    </div>
  );
}
