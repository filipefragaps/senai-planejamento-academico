"use client";
// Substitui o ./local.tsx da versão local da Gestão de Ponto (v1.6): em vez do armazenamento do
// navegador (IndexedDB), o "snapshot" fica no banco da plataforma (/gestao-ponto/painel) e é
// compartilhado por todo o RH. A tela (home.tsx) continua chamando os mesmos endereços
// "/api/point-data" e "/api/notifications", aqui atendidos por platformFetch.

import { useState } from "react";
import { api } from "@/lib/api";

type Settings = { rhEmail: string };
type ItemStatus = { status: string; notifiedAt?: string; notificationMethod?: string };
type Meta = { analysisVersion: number; updatedAt: string; updatedByEmail: string };

const settings: Settings = { rhEmail: "" };
let access: unknown = null;
// Último estado gravado/lido: impressão digital dos dados + status de cada ocorrência
let ultimo: { fp: string; itens: Map<string, ItemStatus>; meta: Meta | null } | null = null;

export function getSettings() { return settings; }

function hash(texto: string) {
  let h = 5381;
  for (let i = 0; i < texto.length; i += 1) h = ((h << 5) + h + texto.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const CAMPOS_DE_STATUS = new Set(["status", "notifiedAt", "notificationMethod"]);
const CAMPOS_DERIVADOS = new Set(["sourcePeriod", "monthlyBalances", "monthlyDays"]); // recalculados em salvar()

/** Identifica se a base/análise mudou (importação) ou se mudou só o status das ocorrências.
 *  Considera a versão de análise e todo o conteúdo (menos os campos de status): reimportar os
 *  mesmos TXT numa versão nova, com as mesmas quantidades, precisa gravar o snapshot inteiro. */
function impressaoDigital(data: any, versao: number | undefined) {
  const conteudo = JSON.stringify(data, function (this: any, chave, valor) {
    if (CAMPOS_DE_STATUS.has(chave)) return undefined;
    if (this === data && CAMPOS_DERIVADOS.has(chave)) return undefined;
    return valor;
  });
  return `${versao ?? ""}|${conteudo.length}|${hash(conteudo)}`;
}

function mapaStatus(items: any[]): Map<string, ItemStatus> {
  return new Map((items || []).map((i) => [i.id, { status: i.status, notifiedAt: i.notifiedAt, notificationMethod: i.notificationMethod }]));
}

function lembrar(data: any, meta: Meta | null, versao = meta?.analysisVersion) {
  ultimo = data ? { fp: impressaoDigital(data, versao), itens: mapaStatus(data.items), meta } : null;
}

async function carregar() {
  const { data } = await api.get("/gestao-ponto/painel");
  access = data.access;
  settings.rhEmail = data.rhEmail || "";
  const snap = data.snapshot;
  lembrar(snap?.data ?? null, snap ? { analysisVersion: snap.analysisVersion, updatedAt: snap.updatedAt, updatedByEmail: snap.updatedByEmail } : null);
  return data as { access: unknown; snapshot: unknown };
}

/** Carrega acesso e e-mail do RH antes de a tela ser importada (as constantes dela leem getSettings). */
export async function initialize() {
  await carregar();
}

async function compactar(texto: string): Promise<Blob | null> {
  if (typeof CompressionStream === "undefined") return null;
  const fluxo = new Blob([texto]).stream().pipeThrough(new CompressionStream("gzip"));
  return await new Response(fluxo).blob();
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function erro(e: any, padrao: string) {
  const detalhe = e?.response?.data?.detail;
  return json({ error: typeof detalhe === "string" ? detalhe : padrao }, e?.response?.status || 500);
}

async function salvar(payload: any) {
  const data = payload.data;
  // Campos que a versão local também calcula ao salvar (consulta mensal)
  data.sourcePeriod = data.result?.period || "";
  data.monthlyBalances = data.result?.monthlyBalances || [];
  data.monthlyDays = []; // só a tela de consulta (perfil sem gestão) usa; na plataforma o acesso é do RH

  const fp = impressaoDigital(data, payload.analysisVersion);
  if (ultimo && ultimo.fp === fp) {
    // Só mudaram status: envia apenas as ocorrências alteradas
    const changes = (data.items || []).flatMap((i: any) => {
      const antes = ultimo!.itens.get(i.id);
      if (antes && antes.status === i.status && antes.notifiedAt === i.notifiedAt && antes.notificationMethod === i.notificationMethod) return [];
      return [{ id: i.id, status: i.status, notifiedAt: i.notifiedAt ?? null, notificationMethod: i.notificationMethod ?? null }];
    });
    if (!changes.length && ultimo.meta) return { snapshot: ultimo.meta };
    const { data: r } = await api.patch("/gestao-ponto/painel/itens", { changes });
    lembrar(data, r.snapshot, payload.analysisVersion);
    return { snapshot: r.snapshot };
  }

  const texto = JSON.stringify({ analysisVersion: payload.analysisVersion, data });
  const gz = await compactar(texto);
  const { data: r } = gz
    ? await api.post("/gestao-ponto/painel", gz, { headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" } })
    : await api.post("/gestao-ponto/painel", texto, { headers: { "Content-Type": "application/json" } });
  lembrar(data, r.snapshot, payload.analysisVersion);
  if (r.statusAproveitados) {
    // Status vindos da versão anterior foram aplicados no servidor: recarrega para a tela mostrá-los
    setTimeout(() => window.location.reload(), 300);
  }
  return { snapshot: r.snapshot };
}

export async function platformFetch(url: string, options?: RequestInit): Promise<Response> {
  if (url === "/api/notifications") return json({ configured: false, sender: settings.rhEmail });
  if (url !== "/api/point-data") throw new Error("Endereço não disponível.");
  try {
    if (options?.method !== "POST") return json(await carregar());
    return json(await salvar(JSON.parse(String(options.body))));
  } catch (e) {
    return options?.method === "POST"
      ? erro(e, "Não foi possível salvar os dados no sistema.")
      : erro(e, "Não foi possível carregar os dados do sistema.");
  }
}

/** Faixa superior: no lugar de "Versão local / cópia de segurança", o e-mail do RH compartilhado. */
export function PlatformToolbar() {
  const [email, setEmail] = useState(settings.rhEmail);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setMessage("Informe um e-mail válido do RH."); return; }
    setBusy(true);
    try {
      await api.put("/gestao-ponto/painel/config", { rhEmail: email.trim().toLowerCase() });
      window.location.reload();
    } catch {
      setMessage("Não foi possível salvar a configuração.");
    } finally {
      setBusy(false);
    }
  }
  return <section className="border-b border-orange-200 bg-orange-50 px-5 py-3 text-sm">
    <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-3">
      <strong>Versão 1.6 · gráfico e cartão individual</strong>
      <label>E-mail do RH: <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="rh@suaunidade.com.br" className="rounded border bg-white px-2 py-1"/></label>
      <button disabled={busy} onClick={() => void save()} className="rounded border bg-white px-3 py-1">Salvar e-mail</button>
    </div>
    <p className="mx-auto mt-2 max-w-[1500px] text-xs">Os dados ficam salvos no sistema e são compartilhados por todo o RH: não é preciso fazer cópia de segurança.</p>
    {message && <p className="mx-auto mt-1 max-w-[1500px] text-xs font-bold text-red-700">{message}</p>}
    {!settings.rhEmail && <p className="mx-auto mt-1 max-w-[1500px] font-bold">Configure o e-mail do RH para preparar as notificações.</p>}
  </section>;
}
