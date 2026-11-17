"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Layers, Loader2, Lock, RefreshCw, Save, Unlock, Users,
} from "lucide-react";
import { api, cursosApi } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";

// ── Tipos ──────────────────────────────────────────────────────────────────────

type EtapaPlanejada = { etapa: string; aulas: number; ultima_aula: string | null };
type EventoCurso = {
  id: number; nome_turma: string; disciplina: string | null; tipo_modalidade: string | null; status: string | null;
  data_inicio: string | null; data_fim: string | null; dias_semana: number[];
  horario_inicio: string | null; horario_fim: string | null;
  etapas_planejadas: EtapaPlanejada[]; etapa_sugerida: string | null;
};
type Config = { selecionado: boolean; modulo: string; data_inicio: string; modo_superior: boolean; clipar_semestre: boolean };
type Candidato = { professor_id: number; nome: string; tipo: string; disponivel: boolean };
type Alocacao = {
  uc_id: number; uc_nome: string; uc_codigo: string; etapa: string | null; carga_horaria: number;
  professor_id: number | null; professor_nome: string | null; aulas_necessarias: number; datas_aulas: string[];
  justificativa: string; alerta: string | null; score: number; travado: boolean; candidatos: Candidato[];
  primeira_aula: string | null; ultima_aula: string | null;
};
type EventoProposta = { evento_id: number; nome_turma: string; modulo: string | null; alocacoes: Alocacao[] };
type Proposta = {
  status: string;
  eventos: EventoProposta[];
  erros: { evento_id: number; erro: string }[];
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
  const [cursoId, setCursoId] = useState<number | null>(null);
  const [config, setConfig] = useState<Record<number, Config>>({});
  const [travas, setTravas] = useState<Record<string, number>>({}); // "evento:uc" → professor
  const [proposta, setProposta] = useState<Proposta | null>(null);
  const [desatualizada, setDesatualizada] = useState(false);
  const [abertos, setAbertos] = useState<Set<number>>(new Set());
  const [gravados, setGravados] = useState<Record<number, "ok" | string>>({});

  const { data: cursos = [] } = useQuery({
    queryKey: ["cursos-lote"],
    queryFn: () => cursosApi.listar(true),
    staleTime: 300_000,
  });
  const cursosFiltrados = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return (cursos as any[]).filter((c) => !b || c.nome.toLowerCase().includes(b) || String(c.codigo).toLowerCase().includes(b)).slice(0, 50);
  }, [cursos, busca]);
  const cursoSel = (cursos as any[]).find((c) => c.id === cursoId);

  const { data: dadosCurso, isLoading: carregandoEventos } = useQuery({
    queryKey: ["lote-eventos", cursoId],
    queryFn: () => api.get(`/planejamento-lote/eventos/${cursoId}`).then((r) => r.data as { etapas: string[]; eventos: EventoCurso[] }),
    enabled: !!cursoId,
  });

  // Configuração padrão de cada evento ao carregar o curso
  useEffect(() => {
    if (!dadosCurso) return;
    const novo: Record<number, Config> = {};
    for (const ev of dadosCurso.eventos) {
      const superior = grupoModalidade(ev.tipo_modalidade) === "superior";
      novo[ev.id] = {
        selecionado: false,
        modulo: ev.etapa_sugerida ?? "",
        data_inicio: "",
        modo_superior: superior,
        clipar_semestre: superior,
      };
    }
    setConfig(novo);
    setProposta(null);
    setTravas({});
    setGravados({});
  }, [dadosCurso]);

  const selecionados = (dadosCurso?.eventos ?? []).filter((e) => config[e.id]?.selecionado);

  const gerar = useMutation({
    mutationFn: (travasAtuais: Record<string, number>) =>
      api.post("/planejamento-lote/preview", {
        curso_id: cursoId,
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
      }, { timeout: 180_000 }).then((r) => r.data as Proposta),
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
        description="Planeje todos os eventos de um curso de uma vez: os professores são escolhidos em conjunto, para não faltar docente nas últimas turmas."
      >
        <Link href="/eventos" className="btn-secondary text-sm">Planejar um evento</Link>
      </PageHeader>

      {/* 1. Curso */}
      <div className="card p-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-800">1. Curso</h2>
        <div className="flex flex-wrap items-center gap-2">
          <input className="input max-w-sm" placeholder="Buscar curso por nome ou código…" value={busca}
                 onChange={(e) => setBusca(e.target.value)} />
          <select className="input max-w-xl" value={cursoId ?? ""}
                  onChange={(e) => setCursoId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Selecione o curso…</option>
            {cursoSel && !cursosFiltrados.some((c: any) => c.id === cursoSel.id) && (
              <option value={cursoSel.id}>{cursoSel.codigo} — {cursoSel.nome}</option>
            )}
            {cursosFiltrados.map((c: any) => <option key={c.id} value={c.id}>{c.codigo} — {c.nome}</option>)}
          </select>
        </div>
      </div>

      {/* 2. Eventos */}
      {cursoId && (
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
            <h2 className="mr-auto text-sm font-semibold text-gray-800">2. Eventos do curso e etapa a planejar</h2>
            {dadosCurso && dadosCurso.eventos.length > 0 && (
              <button className="text-xs text-primary hover:underline"
                      onClick={() => {
                        const todos = dadosCurso.eventos.filter((e) => !GRUPOS_INDIVIDUAIS.has(grupoModalidade(e.tipo_modalidade)));
                        const marcar = !todos.every((e) => config[e.id]?.selecionado);
                        todos.forEach((e) => setCfg(e.id, { selecionado: marcar }));
                      }}>
                Marcar / desmarcar todos
              </button>
            )}
          </div>
          {carregandoEventos ? (
            <div className="flex items-center gap-2 p-6 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Carregando eventos…</div>
          ) : !dadosCurso?.eventos.length ? (
            <p className="p-6 text-sm text-gray-500">Nenhum evento ativo encontrado para este curso.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs text-gray-500">
                  <tr>
                    <th className="px-3 py-2 w-8" />
                    <th className="px-3 py-2">Turma</th>
                    <th className="px-3 py-2">Horário</th>
                    <th className="px-3 py-2">Já planejado</th>
                    <th className="px-3 py-2">Etapa a planejar</th>
                    <th className="px-3 py-2">Início da etapa</th>
                    <th className="px-3 py-2">Ensino Superior</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {dadosCurso.eventos.map((ev) => {
                    const c = config[ev.id];
                    if (!c) return null;
                    const grupo = grupoModalidade(ev.tipo_modalidade);
                    const individual = GRUPOS_INDIVIDUAIS.has(grupo);
                    return (
                      <tr key={ev.id} className={cn(c.selecionado && "bg-blue-50/40", individual && "opacity-60")}>
                        <td className="px-3 py-2 align-top">
                          <input type="checkbox" disabled={individual} checked={c.selecionado}
                                 onChange={(e) => setCfg(ev.id, { selecionado: e.target.checked })} />
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div className="font-medium text-gray-800">{ev.nome_turma}</div>
                          <div className="text-[11px] text-gray-400">
                            #{ev.id} · {fmt(ev.data_inicio)} → {fmt(ev.data_fim)}{ev.tipo_modalidade ? ` · ${ev.tipo_modalidade}` : ""}
                          </div>
                          {individual && <div className="text-[11px] text-amber-700">Planeje este evento pela tela individual (fluxo próprio da modalidade).</div>}
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
                          <select className="input h-8 py-0 text-xs" value={c.modulo} disabled={individual}
                                  onChange={(e) => setCfg(ev.id, { modulo: e.target.value })}>
                            {dadosCurso.etapas.length === 0 && <option value="">Todas as UCs</option>}
                            {dadosCurso.etapas.map((et) => <option key={et} value={et}>{et}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <input type="date" className="input h-8 py-0 text-xs" value={c.data_inicio} disabled={individual}
                                 onChange={(e) => setCfg(ev.id, { data_inicio: e.target.value })} />
                          {!c.data_inicio && <div className="text-[10px] text-gray-400">vazio = início do evento</div>}
                        </td>
                        <td className="px-3 py-2 align-top text-xs">
                          <label className="flex items-center gap-1">
                            <input type="checkbox" checked={c.modo_superior} disabled={individual}
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
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
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
            <p className="px-4 pb-3 text-xs text-gray-500">Calculando datas e escolhendo os professores de todas as turmas juntas… pode levar até 1 minuto.</p>
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
                      <span className="text-xs text-gray-400">{ev.modulo ?? "todas as etapas"} · {ev.alocacoes.length} UC(s)</span>
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
                                      {a.candidatos.map((c) => (
                                        <option key={c.professor_id} value={c.professor_id}>
                                          {c.nome} ({c.tipo}){c.disponivel ? "" : " · sem disponibilidade"}
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
            <button className="btn-primary ml-auto inline-flex items-center gap-2 text-sm"
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
