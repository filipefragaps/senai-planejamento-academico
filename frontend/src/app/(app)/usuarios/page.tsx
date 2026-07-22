"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usuariosApi } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { useRouter } from "next/navigation";
import { UserPlus, Pencil, KeyRound, Power, Shield, Eye, BookOpen } from "lucide-react";

const PERFIS = [
  { value: "admin", label: "Administrador", icon: Shield, color: "text-red-600 bg-red-50" },
  { value: "coordenador", label: "Coordenador", icon: BookOpen, color: "text-blue-600 bg-blue-50" },
  { value: "visualizador", label: "Visualizador", icon: Eye, color: "text-gray-600 bg-gray-100" },
];

function PerfilBadge({ perfil }: { perfil: string }) {
  const p = PERFIS.find((x) => x.value === perfil);
  if (!p) return <span className="text-xs text-gray-400">{perfil}</span>;
  const Icon = p.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${p.color}`}>
      <Icon className="h-3 w-3" />
      {p.label}
    </span>
  );
}

interface Usuario {
  id: number;
  nome: string;
  email: string;
  perfil: string;
  ativo: boolean;
  criado_em?: string;
}

interface FormState {
  nome: string;
  email: string;
  senha: string;
  perfil: string;
}

const FORM_VAZIO: FormState = { nome: "", email: "", senha: "", perfil: "coordenador" };

export default function UsuariosPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const me = getCurrentUser();

  // Redireciona se não for admin
  if (typeof window !== "undefined" && me?.perfil !== "admin") {
    router.replace("/dashboard");
    return null;
  }

  const [modalAberto, setModalAberto] = useState<"criar" | "editar" | "senha" | null>(null);
  const [usuarioSelecionado, setUsuarioSelecionado] = useState<Usuario | null>(null);
  const [form, setForm] = useState<FormState>(FORM_VAZIO);
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmaSenha, setConfirmaSenha] = useState("");
  const [erro, setErro] = useState("");

  const { data: usuarios = [], isLoading } = useQuery<Usuario[]>({
    queryKey: ["usuarios"],
    queryFn: usuariosApi.listar,
  });

  const criarMutation = useMutation({
    mutationFn: () => usuariosApi.criar(form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["usuarios"] }); fecharModal(); },
    onError: (e: any) => setErro(e.response?.data?.detail || "Erro ao criar usuário"),
  });

  const editarMutation = useMutation({
    mutationFn: () => usuariosApi.atualizar(usuarioSelecionado!.id, {
      nome: form.nome,
      email: form.email,
      perfil: form.perfil,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["usuarios"] }); fecharModal(); },
    onError: (e: any) => setErro(e.response?.data?.detail || "Erro ao atualizar"),
  });

  const ativarMutation = useMutation({
    mutationFn: ({ id, ativo }: { id: number; ativo: boolean }) =>
      usuariosApi.atualizar(id, { ativo }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["usuarios"] }),
    onError: (e: any) => alert(e.response?.data?.detail || "Erro ao alterar status"),
  });

  const resetSenhaMutation = useMutation({
    mutationFn: () => usuariosApi.resetSenha(usuarioSelecionado!.id, novaSenha),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["usuarios"] }); fecharModal(); },
    onError: (e: any) => setErro(e.response?.data?.detail || "Erro ao redefinir senha"),
  });

  function abrirCriar() {
    setForm(FORM_VAZIO);
    setErro("");
    setModalAberto("criar");
  }

  function abrirEditar(u: Usuario) {
    setUsuarioSelecionado(u);
    setForm({ nome: u.nome, email: u.email, senha: "", perfil: u.perfil });
    setErro("");
    setModalAberto("editar");
  }

  function abrirSenha(u: Usuario) {
    setUsuarioSelecionado(u);
    setNovaSenha("");
    setConfirmaSenha("");
    setErro("");
    setModalAberto("senha");
  }

  function fecharModal() {
    setModalAberto(null);
    setUsuarioSelecionado(null);
    setErro("");
  }

  function salvar() {
    setErro("");
    if (modalAberto === "criar") criarMutation.mutate();
    else if (modalAberto === "editar") editarMutation.mutate();
    else if (modalAberto === "senha") {
      if (novaSenha.length < 6) { setErro("A senha deve ter pelo menos 6 caracteres"); return; }
      if (novaSenha !== confirmaSenha) { setErro("As senhas não conferem"); return; }
      resetSenhaMutation.mutate();
    }
  }

  const isPending =
    criarMutation.isPending || editarMutation.isPending || resetSenhaMutation.isPending;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Gerenciar Usuários</h1>
          <p className="text-sm text-gray-500 mt-0.5">Cadastre e gerencie os acessos à plataforma</p>
        </div>
        <button
          onClick={abrirCriar}
          className="flex items-center gap-2 rounded-lg bg-[#003B8E] px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 transition-colors"
        >
          <UserPlus className="h-4 w-4" />
          Novo Usuário
        </button>
      </div>

      {/* Tabela */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400">Carregando...</div>
        ) : usuarios.length === 0 ? (
          <div className="p-8 text-center text-gray-400">Nenhum usuário cadastrado</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left">Nome</th>
                <th className="px-4 py-3 text-left">E-mail</th>
                <th className="px-4 py-3 text-left">Perfil</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {usuarios.map((u) => (
                <tr key={u.id} className={`hover:bg-gray-50 transition-colors ${!u.ativo ? "opacity-50" : ""}`}>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {u.nome}
                    {u.id === me?.id && (
                      <span className="ml-2 text-[10px] bg-blue-100 text-blue-700 rounded-full px-1.5 py-0.5 font-semibold">
                        Você
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{u.email}</td>
                  <td className="px-4 py-3">
                    <PerfilBadge perfil={u.perfil} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${u.ativo ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                      {u.ativo ? "Ativo" : "Inativo"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => abrirEditar(u)}
                        title="Editar"
                        className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => abrirSenha(u)}
                        title="Redefinir senha"
                        className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                      </button>
                      {u.id !== me?.id && (
                        <button
                          onClick={() => ativarMutation.mutate({ id: u.id, ativo: !u.ativo })}
                          title={u.ativo ? "Desativar" : "Ativar"}
                          className={`rounded p-1.5 transition-colors ${u.ativo ? "text-gray-400 hover:bg-red-50 hover:text-red-600" : "text-gray-400 hover:bg-green-50 hover:text-green-600"}`}
                        >
                          <Power className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Legenda de perfis */}
      <div className="mt-4 flex gap-4">
        {PERFIS.map((p) => {
          const Icon = p.icon;
          return (
            <div key={p.value} className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${p.color}`}>
                <Icon className="h-3 w-3" />
                {p.label}
              </span>
              <span>
                {p.value === "admin" && "— acesso total"}
                {p.value === "coordenador" && "— cria e edita planejamentos"}
                {p.value === "visualizador" && "— somente leitura"}
              </span>
            </div>
          );
        })}
      </div>

      {/* Modal */}
      {modalAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">
              {modalAberto === "criar" && "Novo Usuário"}
              {modalAberto === "editar" && `Editar: ${usuarioSelecionado?.nome}`}
              {modalAberto === "senha" && `Redefinir Senha: ${usuarioSelecionado?.nome}`}
            </h2>

            {modalAberto !== "senha" ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Nome</label>
                  <input
                    className="input w-full"
                    value={form.nome}
                    onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
                    placeholder="Nome completo"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">E-mail</label>
                  <input
                    type="email"
                    className="input w-full"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="email@exemplo.com"
                  />
                </div>
                {modalAberto === "criar" && (
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Senha inicial</label>
                    <input
                      type="password"
                      className="input w-full"
                      value={form.senha}
                      onChange={(e) => setForm((f) => ({ ...f, senha: e.target.value }))}
                      placeholder="Mínimo 6 caracteres"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Perfil</label>
                  <select
                    className="input w-full"
                    value={form.perfil}
                    onChange={(e) => setForm((f) => ({ ...f, perfil: e.target.value }))}
                  >
                    {PERFIS.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Nova senha</label>
                  <input
                    type="password"
                    className="input w-full"
                    value={novaSenha}
                    onChange={(e) => setNovaSenha(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Confirmar senha</label>
                  <input
                    type="password"
                    className="input w-full"
                    value={confirmaSenha}
                    onChange={(e) => setConfirmaSenha(e.target.value)}
                    placeholder="Repita a nova senha"
                  />
                </div>
              </div>
            )}

            {erro && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{erro}</p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={fecharModal}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={salvar}
                disabled={isPending}
                className="rounded-lg bg-[#003B8E] px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60"
              >
                {isPending ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
