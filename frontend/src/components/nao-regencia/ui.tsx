"use client";

import Link from "next/link";
import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { NrFiltros, NrOpcoes, PERFIS_RESPONSAVEL } from "@/lib/nao-regencia";

export function Selo({ cls, children, title }: { cls?: string; children: React.ReactNode; title?: string }) {
  return <span title={title} className={cn("badge border whitespace-nowrap", cls)}>{children}</span>;
}

export function Campo({ label, children, obrigatorio, dica, className }: {
  label: string; children: React.ReactNode; obrigatorio?: boolean; dica?: string; className?: string;
}) {
  return (
    <label className={cn("block space-y-1", className)}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        {label}{obrigatorio && <span className="text-red-500"> *</span>}
      </span>
      {children}
      {dica && <span className="block text-[11px] text-gray-400">{dica}</span>}
    </label>
  );
}

export function Modal({ titulo, subtitulo, onClose, children, rodape, largura = "max-w-2xl" }: {
  titulo: string; subtitulo?: string; onClose: () => void; children: React.ReactNode; rodape?: React.ReactNode; largura?: string;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className={cn("relative my-8 w-full rounded-lg bg-white shadow-xl", largura)}>
        <div className="flex items-start gap-3 border-b px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-gray-900">{titulo}</h2>
            {subtitulo && <p className="mt-0.5 text-sm text-gray-500">{subtitulo}</p>}
          </div>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600" title="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {rodape && <div className="flex items-center justify-end gap-2 border-t px-5 py-3">{rodape}</div>}
      </div>
    </div>
  );
}

export function Vazio({ icone: Icon, titulo, texto, children }: {
  icone: React.ElementType; titulo: string; texto?: string; children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      <Icon className="h-8 w-8 text-gray-300" />
      <p className="text-sm font-semibold text-gray-700">{titulo}</p>
      {texto && <p className="max-w-md text-sm text-gray-500">{texto}</p>}
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}

export function Tile({ icon: Icon, label, valor, detalhe, onClick, tom }: {
  icon: React.ElementType; label: string; valor: React.ReactNode; detalhe?: React.ReactNode; onClick?: () => void;
  tom?: "alerta" | "sucesso" | "atencao";
}) {
  const cor = tom === "alerta" ? "text-red-500" : tom === "sucesso" ? "text-green-600" : tom === "atencao" ? "text-amber-500" : "text-gray-400";
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
            className={cn("card h-full p-4 text-left transition-colors", onClick && "hover:border-primary/40")}>
      <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
        <Icon className={cn("h-4 w-4 shrink-0", cor)} />
        <span className="truncate">{label}</span>
      </div>
      <p className={cn("mt-2 text-2xl font-bold tabular-nums text-gray-900", tom === "alerta" && "text-red-700")}>{valor}</p>
      {detalhe && <p className="mt-1 text-xs text-gray-500">{detalhe}</p>}
    </button>
  );
}

export function Avatar({ nome, foto, tamanho = "h-7 w-7" }: { nome?: string | null; foto?: string | null; tamanho?: string }) {
  const ini = (nome || "?").split(" ").filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
  return foto
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={foto} alt={nome || ""} className={cn("shrink-0 rounded object-cover object-top", tamanho)} />
    : <span className={cn("flex shrink-0 items-center justify-center rounded bg-primary/10 text-[10px] font-bold text-primary", tamanho)}>{ini}</span>;
}

export function LinkProfessor({ id, nome }: { id: number; nome: string }) {
  return <Link href={`/nao-regencia/professor/${id}`} className="font-medium text-gray-900 hover:text-primary hover:underline">{nome}</Link>;
}

/** Barra de filtros compartilhada entre dashboard, tabelas e relatórios. */
export function BarraFiltros({ filtros, setFiltros, opcoes, campos = ["periodo", "professor", "unidade", "categoria", "projeto", "responsavel", "situacao"], projetos }: {
  filtros: NrFiltros; setFiltros: (f: NrFiltros) => void; opcoes?: NrOpcoes; campos?: string[];
  projetos?: { id: number; codigo: string; nome: string }[];
}) {
  const set = (k: keyof NrFiltros, v: any) => setFiltros({ ...filtros, [k]: v === "" ? "" : v });
  const tem = (c: string) => campos.includes(c);
  const sel = "input h-8 w-auto min-w-[9rem] py-0 text-xs";
  return (
    <div className="card mb-4 flex flex-wrap items-end gap-2 p-3">
      {tem("periodo") && (
        <>
          <Campo label="De"><input type="date" className={sel} value={filtros.ini || ""} onChange={(e) => set("ini", e.target.value)} /></Campo>
          <Campo label="Até"><input type="date" className={sel} value={filtros.fim || ""} onChange={(e) => set("fim", e.target.value)} /></Campo>
        </>
      )}
      {tem("professor") && !!opcoes?.eu.gestao && (
        <Campo label="Professor">
          <select className={sel} value={filtros.professor_id ?? ""} onChange={(e) => set("professor_id", e.target.value ? +e.target.value : "")}>
            <option value="">Todos</option>
            {opcoes?.professores.filter((p) => p.ativo).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </Campo>
      )}
      {tem("unidade") && (
        <Campo label="Unidade/setor">
          <select className={sel} value={filtros.unidade || ""} onChange={(e) => set("unidade", e.target.value)}>
            <option value="">Todas</option>
            {opcoes?.unidades.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </Campo>
      )}
      {tem("categoria") && (
        <Campo label="Categoria">
          <select className={sel} value={filtros.categoria_id ?? ""} onChange={(e) => set("categoria_id", e.target.value ? +e.target.value : "")}>
            <option value="">Todas</option>
            {opcoes?.categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </Campo>
      )}
      {tem("projeto") && projetos && (
        <Campo label="Projeto">
          <select className={cn(sel, "max-w-[14rem]")} value={filtros.projeto_id ?? ""} onChange={(e) => set("projeto_id", e.target.value ? +e.target.value : "")}>
            <option value="">Todos</option>
            {projetos.map((p) => <option key={p.id} value={p.id}>{p.codigo} {p.nome}</option>)}
          </select>
        </Campo>
      )}
      {tem("responsavel") && (
        <Campo label="Responsável">
          <select className={sel} value={filtros.responsavel_id ?? ""} onChange={(e) => set("responsavel_id", e.target.value ? +e.target.value : "")}>
            <option value="">Todos</option>
            {opcoes?.usuarios.filter((u) => PERFIS_RESPONSAVEL.includes(u.perfil)).map((u) => (
              <option key={u.id} value={u.id}>{u.nome.toUpperCase()}</option>
            ))}
          </select>
        </Campo>
      )}
      {tem("situacao") && (
        <Campo label="Situação do projeto">
          <select className={sel} value={filtros.situacao || ""} onChange={(e) => set("situacao", e.target.value)}>
            <option value="">Todas</option>
            {opcoes?.situacoes_projeto.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Campo>
      )}
      <button className="ml-auto text-xs text-gray-500 hover:text-primary hover:underline"
              onClick={() => setFiltros({ ini: filtros.ini, fim: filtros.fim })}>
        Limpar filtros
      </button>
    </div>
  );
}

export function Tabela({ cabecalho, children, vazio }: { cabecalho: React.ReactNode; children: React.ReactNode; vazio?: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">{cabecalho}</tr>
        </thead>
        <tbody className="divide-y">{children}</tbody>
      </table>
      {vazio}
    </div>
  );
}

export function BarraProgresso({ valor }: { valor: number | null | undefined }) {
  if (valor == null) return <span className="text-xs italic text-gray-400">progresso não definido</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-gray-200">
        <div className={cn("h-full rounded-full", valor >= 100 ? "bg-green-500" : "bg-primary")} style={{ width: `${Math.min(100, valor)}%` }} />
      </div>
      <span className="text-xs tabular-nums text-gray-600">{valor.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%</span>
    </div>
  );
}
